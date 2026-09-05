import { DecisionLog, toCents, fmt } from '@kirim/trade';
import { milestone, submission, examineMilestone, credentialUri } from '@kirim/works';
import { explainMilestone } from './reasoner.mjs';

const LEDGER = () => 'http://localhost:' + (process.env.LEDGER_PORT || 4010);
const MARKET = () => 'http://localhost:' + (process.env.MARKET_PORT || 4020);

async function ledgerPost(path, body) {
  const res = await fetch(LEDGER() + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
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
 * The milestone agent.
 *
 * Client funds an escrow at the start of each milestone. The contractor
 * submits evidence. The agent buys what it needs to check that evidence,
 * examines it against the agreed scope, and releases — autonomously below the
 * client's ceiling, and asking above it.
 *
 * Kirim does not claim to verify construction. It reconciles evidence against
 * an agreed scope and says plainly where the two disagree. The rules in
 * @kirim/works decide; the model writes the advice.
 */
export async function runMilestone(project, ms0, {
  emit = () => {}, seenPhotoHashes = new Set(), priorReleased = [],
} = {}) {
  const ms = milestone({ ...ms0, projectId: project.id, site: project.site });
  const log = new DecisionLog(`${project.id}/${ms.id}`, emit);
  const amountUsd = (ms.amountCents / 100).toFixed(2);

  log.add('milestone', 'opened',
    `${ms.name} — ${fmt(ms.amountCents)} of ${project.name}. Agreed ${ms.startsOn} to ${ms.dueOn}, ` +
    `site ${project.site.address}, ${ms.requiredPhotos} photographs required` +
    (ms.requiresPermit ? `, ${ms.requiresPermit} permit required.` : '.'),
    { amountCents: ms.amountCents });

  // --- fund the escrow ------------------------------------------------------
  const escrow = await ledgerPost('/escrow/create', {
    from: 'buyer', to: 'supplier', amount: amountUsd, tradeId: `${project.id}/${ms.id}`,
    memo: `${project.id}/${ms.id}`, cancelAfterSeconds: ms0.cancelAfterSeconds ?? 900,
  });
  if (escrow.refused) {
    log.add('escrow', 'refused', escrow.reason, { amountCents: ms.amountCents });
    return { log, outcome: 'refused' };
  }

  log.add('escrow', 'funded',
    `${fmt(ms.amountCents)} committed by ${project.client} and locked to ${project.contractor}. ` +
    `Released only against conforming evidence; returns to ${project.client} automatically if ` +
    `nothing is presented before the cancel time.`,
    { txHash: escrow.txHash, explorer: escrow.explorer, amountCents: ms.amountCents });
  if (escrow.scaled) log.add('escrow', 'note', escrow.scalingNote, {});

  // --- the contractor performs, or does not --------------------------------
  if (ms0.noSubmission) {
    const wait = (ms0.cancelAfterSeconds ?? 30) + 5;
    log.add('submission', 'none',
      `Nothing presented against ${ms.name}. Waiting out the cancel window before returning the funds.`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    const cancelled = await ledgerPost('/escrow/cancel', {
      by: 'platform', owner: escrow.owner, offerSequence: escrow.offerSequence,
    });
    log.add('settlement', 'returned',
      `Escrow cancelled. ${fmt(ms.amountCents)} returned to ${project.client}. No dispute, no lawyer, no chasing.`,
      { txHash: cancelled.txHash, explorer: cancelled.explorer });
    return { log, outcome: 'timed_out_and_returned' };
  }

  const sub = submission({ ...ms0.submission, milestoneId: ms.id });
  log.add('submission', 'received',
    `${project.contractor} submitted ${sub.photos.length} photograph(s), ` +
    `${sub.deliveries.length} delivery note(s)` +
    (sub.permitRef ? `, permit ${sub.permitRef}` : ', no permit reference') +
    `. "${sub.note}"`);

  // --- buy what is needed to check it --------------------------------------
  // The agent never signs. It asks the ledger service to buy a URL over MPP;
  // that service holds the seed, enforces the ceiling, and can refuse.
  const catalog = await fetch(MARKET() + '/v1/catalog').then((r) => r.json());

  const buy = async (id, query, why) => {
    const p = catalog.providers.find((x) => x.id === id);
    const url = MARKET() + p.path + (query ? '?' + new URLSearchParams(query) : '');

    const out = await ledgerPost('/buy', {
      url, priceUsd: p.price, from: 'buyer',
      tradeId: `${project.id}/${ms.id}`, mode: 'push',
    });

    if (out.refused) {
      log.add('purchase', 'declined',
        `${p.name} quoted US$${p.price}. ${out.reason} Proceeding without it.`,
        { provider: id, quotedUsd: p.price });
      return null;
    }
    log.add('purchase', 'bought',
      `${p.name} — US$${p.price} over MPP. ${why}`, {
        provider: id, costCents: toCents(p.price),
        txHash: out.txHash, explorer: out.explorer,
      });
    return out.data;
  };

  log.add('discovery', 'surveyed',
    `Evidence checks available: ` +
    catalog.providers.filter((p) => ['photo-forensics', 'materials-registry', 'site-inspection', 'credit-report'].includes(p.id))
      .map((p) => `${p.name} US$${p.price}`).join(', ') + '.');

  const photoForensics = sub.photos.length
    ? await buy('photo-forensics', { files: sub.photos.map((p) => p.file).join(',') },
      'Confirming the photographs are original captures before their timestamps and GPS are relied on.')
    : null;

  const materials = sub.deliveries.length
    ? await buy('materials-registry', { refs: sub.deliveries.map((d) => `${d.ref}|${d.supplier}`).join(',') },
      'Checking the delivery notes exist in the suppliers’ own records.')
    : null;

  const inspection = await buy('site-inspection', { milestone: ms.id },
    'An independent inspection costs thirty cents here; a scheduled site visit costs a day.');

  // The expensive one, over the ceiling. The agent must be seen to refuse it.
  await buy('credit-report', { name: project.contractor }, 'Considered for a deeper contractor file.');

  // --- examination ----------------------------------------------------------
  const result = examineMilestone({
    ms, sub, inspection, photoForensics, materials, priorReleased, seenPhotoHashes,
  });
  for (const p of sub.photos) if (p.sha256) seenPhotoHashes.add(p.sha256);

  const advice = await explainMilestone({ project, ms, sub, result });
  log.add('examination', result.state, advice, {
    findings: result.all, verdict: result.verdict, state: result.state,
  });

  if (result.state === 'more_info') {
    log.add('settlement', 'held',
      `${fmt(ms.amountCents)} stays in escrow. Nothing submitted contradicts the scope — the ` +
      `submission is simply incomplete, and ${project.contractor} can complete it before the cancel time. ` +
      `No mark is recorded against their track record.`);
    return { log, outcome: 'more_information_needed', escrow };
  }

  if (result.state === 'flagged') {
    log.add('settlement', 'withheld',
      `${fmt(ms.amountCents)} stays in escrow pending ${project.client}'s review. ` +
      `The contractor may present corrected evidence, or the funds return automatically.`);
    return { log, outcome: 'flagged_for_review', escrow };
  }

  // --- release --------------------------------------------------------------
  const finished = await ledgerPost('/escrow/finish', {
    by: 'platform', owner: escrow.owner, offerSequence: escrow.offerSequence,
    condition: escrow.condition, fulfillment: escrow.fulfillment,
    amount: amountUsd,
  });

  if (finished.refused) {
    log.add('settlement', 'awaiting_client', finished.reason, { amountCents: ms.amountCents });
    return { log, outcome: 'awaiting_client_authorisation', escrow };
  }

  log.add('settlement', 'released',
    `Evidence conforms. ${fmt(ms.amountCents)} released to ${project.contractor} — paid on ` +
    `evidence, not on a promise and not in ninety days.`,
    { txHash: finished.txHash, explorer: finished.explorer });

  // --- the track record -----------------------------------------------------
  const onTime = sub.submittedAt.slice(0, 10) <= ms.dueOn;
  const cred = await ledgerPost('/credential/issue', {
    by: 'platform', subject: 'supplier',
    // A credential is keyed by (issuer, subject, type), so the type carries the
    // milestone. One ledger object per completed milestone, enumerable forever.
    credentialType: `KIRIM:${project.id}:${ms.id}`,
    uri: credentialUri({ projectId: project.id, milestoneId: ms.id, name: ms.name, onTime }),
  });

  log.add('record', cred.alreadyIssued ? 'already_recorded' : 'credentialed',
    cred.alreadyIssued
      ? `This milestone is already on ${project.contractor}'s ledger record from an earlier run. ` +
        `A milestone credential is unique by construction, so it cannot be double-counted.`
      :
    `Milestone credential issued to ${project.contractor} and accepted by their account. ` +
    `It lives on their XRPL account, not in Kirim's database — any future client can verify it ` +
    `without asking us.`,
    { txHash: cred.issueTxHash, explorer: cred.issueExplorer, acceptTxHash: cred.acceptTxHash });

  return { log, outcome: 'released', escrow, credential: cred };
}
