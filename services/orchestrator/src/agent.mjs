import { purchaseOrder, billOfLading, packingList, examine, DecisionLog, toCents, fmt } from '@kirim/trade';
import { explainUnderwriting, explainDiscrepancies } from './reasoner.mjs';

const LEDGER = () => 'http://localhost:' + (process.env.LEDGER_PORT || 4010);
const MARKET = () => 'http://localhost:' + (process.env.MARKET_PORT || 4020);

/**
 * Talk to the ledger service. A ledger error is never swallowed: if the money
 * did not move, the trade must stop here rather than carry on narrating a
 * settlement that never happened.
 */
async function ledgerPost(path, body) {
  const res = await fetch(LEDGER() + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + (process.env.LEDGER_TOKEN ?? ''),
    },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (!res.ok || out.error) {
    const e = new Error(`ledger ${path} failed: ${out.detail || out.error || res.status}${out.result ? ' (' + out.result + ')' : ''}`);
    e.ledger = out;
    throw e;
  }
  return out;
}

/**
 * The agent.
 *
 * It never holds a seed. Every movement of money is a request to the ledger
 * service, which may refuse it — and a refusal is a decision that gets logged
 * with its reason, not an error that gets swallowed.
 *
 * need -> discovery -> decision -> transaction -> outcome, run twice: once for
 * the inputs the agent buys in order to underwrite, once for the trade itself.
 */
export async function runTrade(trade, { emit = () => {} } = {}) {
  const log = new DecisionLog(trade.id, emit);
  const po = purchaseOrder(trade.po);
  const principalUsd = (po.totalCents / 100).toFixed(2);

  log.add('need', 'accepted',
    `${po.buyer} is buying ${fmt(po.totalCents)} of goods from ${po.supplier}, ` +
    `${po.portOfLoading} to ${po.portOfDischarge}, latest shipment ${po.latestShipmentDate}.`,
    { principalCents: po.totalCents });

  // --- buying evidence -----------------------------------------------------
  // Same path as the construction vertical: the agent asks the ledger service
  // to buy a URL over MPP, and that service holds the seed and the ceilings.
  const buy = async (providerId, query, why) => {
    const cat = await fetch(MARKET() + '/v1/catalog').then((r) => r.json());
    const p = cat.providers.find((x) => x.id === providerId);
    const url = MARKET() + p.path + (query ? '?' + new URLSearchParams(query) : '');

    const out = await ledgerPost('/buy', {
      url, priceUsd: p.price, from: 'buyer', tradeId: trade.id, mode: 'push',
    });

    if (out.refused) {
      log.add('purchase', 'declined',
        `${p.name} quoted US$${p.price}. ${out.reason} Proceeding without it.`,
        { provider: p.id, quotedUsd: p.price });
      return null;
    }
    log.add('purchase', 'bought', `${p.name} — US$${p.price} over MPP. ${why}`, {
      provider: p.id, costCents: toCents(p.price),
      txHash: out.txHash, explorer: out.explorer,
    });
    return out.data;
  };

  // --- discovery ------------------------------------------------------------
  const catalog = await fetch(MARKET() + '/v1/catalog').then((r) => r.json());
  log.add('discovery', 'surveyed',
    `${catalog.providers.length} providers available: ` +
    catalog.providers.map((p) => `${p.name} US$${p.price}`).join(', ') + '.');

  // --- underwriting inputs, bought one at a time ---------------------------
  const screening = await buy('screening', { name: po.supplier },
    'Counterparty is new to this buyer; screening is required before funds are committed.');

  // Deliberately over the per-call ceiling. The agent must be seen to refuse.
  await buy('credit-report', { name: po.supplier },
    'Considered for a deeper counterparty file.');

  // --- the underwriting decision -------------------------------------------
  const sanctionsHit = screening && !screening.clear;
  if (sanctionsHit) {
    const reason = await explainUnderwriting({ po, screening, outcome: 'declined' });
    log.add('underwriting', 'declined', reason, { principalCents: po.totalCents });
    return { log, outcome: 'declined_before_funding' };
  }

  const reason = await explainUnderwriting({ po, screening, outcome: 'approved' });
  log.add('underwriting', 'approved', reason, { principalCents: po.totalCents });

  // --- fund the escrow ------------------------------------------------------
  const escrow = await ledgerPost('/escrow/create', {
    from: 'buyer', to: 'supplier', amount: principalUsd, tradeId: trade.id,
    memo: trade.id, cancelAfterSeconds: trade.cancelAfterSeconds ?? 900,
  });

  if (escrow.refused) {
    log.add('escrow', escrow.needsApproval ? 'awaiting_human' : 'refused', escrow.reason,
      { principalCents: po.totalCents });
    return { log, outcome: escrow.needsApproval ? 'awaiting_human_authorisation' : 'refused' };
  }

  log.add('escrow', 'funded',
    `${fmt(po.totalCents)} locked to ${po.supplier}. Released only against conforming documents; ` +
    `returns to ${po.buyer} automatically if nothing is presented before the cancel time.`,
    { txHash: escrow.txHash, explorer: escrow.explorer, principalCents: po.totalCents,
      ledgerAmount: escrow.ledgerAmount, scaled: escrow.scaled });

  if (escrow.scaled) {
    log.add('escrow', 'note', escrow.scalingNote, { ledgerAmount: escrow.ledgerAmount });
  }

  // --- the supplier performs, or does not ----------------------------------
  if (trade.noDocuments) {
    const wait = (trade.cancelAfterSeconds ?? 30) + 5;
    log.add('presentation', 'none',
      `No documents presented. Waiting out the ${trade.cancelAfterSeconds ?? 30}s cancel window before clawing the funds back.`);
    await new Promise((r) => setTimeout(r, wait * 1000));

    const cancelled = await ledgerPost('/escrow/cancel', {
      by: 'platform', owner: escrow.owner, offerSequence: escrow.offerSequence,
    });

    log.add('settlement', 'returned',
      `Escrow cancelled. ${fmt(po.totalCents)} returned to ${po.buyer}. No dispute, no lawyer, no email.`,
      { txHash: cancelled.txHash, explorer: cancelled.explorer });
    return { log, outcome: 'timed_out_and_returned', escrow };
  }

  const bl = billOfLading(trade.bl);
  const packing = packingList(trade.packing);
  log.add('presentation', 'received',
    `Bill of lading ${bl.blNumber} and packing list presented against ${po.poNumber}.`);

  // Verify the bill of lading actually exists before examining it.
  const carrier = await buy('document-verify', { bl: bl.blNumber },
    'Confirming the bill of lading exists in the carrier registry before examination.');
  if (carrier && !carrier.found) {
    log.add('examination', 'rejected',
      `Bill of lading ${bl.blNumber} does not appear in the carrier registry. Funds retained.`);
    return { log, outcome: 'documents_rejected', escrow };
  }

  // --- examination ----------------------------------------------------------
  const result = examine({ po, bl, packing });
  const advice = await explainDiscrepancies({ po, bl, result });
  log.add('examination', result.clean ? 'conforming' : 'rejected', advice,
    { discrepancies: result.all, verdict: result.verdict });

  if (!result.clean) {
    log.add('settlement', 'withheld',
      `${fmt(po.totalCents)} remains in escrow. The supplier may present corrected documents ` +
      `before the cancel time, or the funds return to ${po.buyer}.`);
    return { log, outcome: 'documents_rejected', escrow };
  }

  // --- release --------------------------------------------------------------
  const finished = await ledgerPost('/escrow/finish', {
    by: 'platform', owner: escrow.owner, offerSequence: escrow.offerSequence,
    condition: escrow.condition, fulfillment: escrow.fulfillment,
  });

  log.add('settlement', 'released',
    `Documents conform. ${fmt(po.totalCents)} released to ${po.supplier} — paid on presentation, ` +
    `not on 60-day terms.`,
    { txHash: finished.txHash, explorer: finished.explorer });

  const fx = await buy('fx-quote', { to: 'VND' },
    'Supplier settles locally; quoting the conversion so the rate is visible rather than buried in a spread.');
  if (fx) {
    log.add('fx', 'quoted',
      `${fx.pair} at ${fx.rate}, ${fx.spreadBps}bps. Shown to both sides — a bank spread on ` +
      `${fmt(po.totalCents)} would not be.`);
  }

  log.add('outcome', 'complete',
    `Trade settled. Principal ${fmt(po.totalCents)}, agent operating spend ${fmt(log.spentCents())}, ` +
    `supplier paid on presentation.`,
    { operatingCents: log.spentCents() });

  return { log, outcome: 'settled', escrow };
}
