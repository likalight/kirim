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
 * Releases waiting on a client signature, keyed by project/milestone. Above the
 * ceiling the agent has done its work and stops; the money moves only once the
 * client's own wallet has authorised it on the ledger.
 */
export const pendingReleases = new Map();

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

  // --- compare, then choose ------------------------------------------------
  // Two providers sell the same inspection at different prices and turnarounds.
  // The agent picks on the milestone's own deadline pressure rather than always
  // taking the cheapest, and records why — this is the decision the brief means
  // by "compare".
  const inspectors = catalog.providers
    .filter((p) => p.id.startsWith('site-inspection'))
    .sort((a, b) => Number(a.price) - Number(b.price));

  const daysLate = Math.round(
    (Date.parse(sub.submittedAt) - Date.parse(ms.dueOn + 'T23:59:59+08:00')) / 86400000,
  );
  const urgent = daysLate >= 0;
  const cheapest = inspectors[0];
  const fastest = inspectors.reduce((a, b) => (a.turnaroundHours <= b.turnaroundHours ? a : b));
  const chosen = urgent ? fastest : cheapest;
  const rejected = inspectors.find((p) => p.id !== chosen.id);

  log.add('comparison', 'chose', rejected
    ? `Two providers sell this inspection: ${cheapest.name} at US$${cheapest.price} in ` +
      `${cheapest.turnaroundHours}h, and ${fastest.name} at US$${fastest.price} in ` +
      `${fastest.turnaroundHours}h. ` +
      (urgent
        ? `This milestone was due ${ms.dueOn} and the submission is ${daysLate} day(s) past it, so the ` +
          `extra US$${(Number(fastest.price) - Number(cheapest.price)).toFixed(2)} buys back ` +
          `${cheapest.turnaroundHours - fastest.turnaroundHours} hours. Taking the express survey.`
        : `The milestone is inside its agreed date, so the wait costs nothing. Taking the cheaper survey ` +
          `and keeping US$${(Number(fastest.price) - Number(cheapest.price)).toFixed(2)}.`)
    : `Only ${chosen.name} offers this inspection.`,
    { chose: chosen.id, rejected: rejected?.id, urgent, daysLate });

  const inspection = await buy(chosen.id, { milestone: ms.id },
    urgent
      ? 'The milestone is already past its date; the express survey is worth the difference.'
      : 'An independent inspection costs thirty cents here; a scheduled site visit costs a day.');

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
  return release({ project, ms, sub, escrow, amountUsd, log });
}

/**
 * Finish the escrow and write the track record. Split out because a release
 * above the ceiling happens later, after the client has signed.
 */
async function release({ project, ms, sub, escrow, amountUsd, log, authorisationTxHash }) {
  const memo = `${project.id}/${ms.id}`;
  const finished = await ledgerPost('/escrow/finish', {
    by: 'platform', owner: escrow.owner, offerSequence: escrow.offerSequence,
    condition: escrow.condition, fulfillment: escrow.fulfillment,
    amount: amountUsd, memo, authorisationTxHash,
  });

  if (finished.refused) {
    pendingReleases.set(memo, { project, ms, sub, escrow, amountUsd });
    log.add('settlement', 'awaiting_client', finished.reason, {
      amountCents: ms.amountCents,
      authorisation: finished.authorisation
        ? { ...finished.authorisation, memo }
        : undefined,
    });
    return { log, outcome: 'awaiting_client_authorisation', escrow };
  }

  pendingReleases.delete(memo);

  if (authorisationTxHash) {
    log.add('authorisation', 'verified',
      `${project.client} authorised the release from their own wallet. The signature ` +
      `is on the ledger, names this milestone, and was checked before a cent moved.`,
      { txHash: authorisationTxHash,
        explorer: `${process.env.XRPL_EXPLORER || 'https://testnet.xrpl.org'}/transactions/${authorisationTxHash}` });
  }

  log.add('settlement', 'released',
    `Evidence conforms. ${fmt(ms.amountCents)} released to ${project.contractor} — paid on ` +
    `evidence, not on a promise and not in ninety days.`,
    { txHash: finished.txHash, explorer: finished.explorer });

  if (finished.fee && !finished.fee.failed) {
    log.add('revenue', 'charged',
      `Kirim charged US$${finished.fee.amountUsd} — ${finished.fee.bps / 100}% of the milestone, ` +
      `taken at the moment of release. An escrow agent charges 3–5% and takes days.`,
      { txHash: finished.fee.txHash, explorer: finished.fee.explorer,
        feeCents: Math.round(Number(finished.fee.amountUsd) * 100) });
  } else if (finished.fee?.failed) {
    log.add('revenue', 'uncollected',
      `The release stands; the ${finished.fee.bps / 100}% fee could not be collected: ${finished.fee.failed}`);
  }

  const onTime = sub.submittedAt.slice(0, 10) <= ms.dueOn;
  const cred = await ledgerPost('/credential/issue', {
    by: 'platform', subject: 'supplier',
    credentialType: `KIRIM:${project.id}:${ms.id}`,
    uri: credentialUri({ projectId: project.id, milestoneId: ms.id, name: ms.name, onTime }),
  });

  log.add('record', cred.alreadyIssued ? 'already_recorded' : 'credentialed',
    cred.alreadyIssued
      ? `This milestone is already on ${project.contractor}'s ledger record from an earlier run. ` +
        `A milestone credential is unique by construction, so it cannot be double-counted.`
      : `Milestone credential issued to ${project.contractor} and accepted by their account. ` +
        `It lives on their XRPL account, not in Kirim's database — any future client can verify it ` +
        `without asking us.`,
    { txHash: cred.issueTxHash, explorer: cred.issueExplorer, acceptTxHash: cred.acceptTxHash });

  return { log, outcome: 'released', escrow, credential: cred };
}

/**
 * Complete a release the client has now signed for.
 */
export async function authoriseRelease(key, authorisationTxHash, { emit = () => {} } = {}) {
  const p = pendingReleases.get(key);
  if (!p) throw new Error(`No release is waiting on authorisation for ${key}`);
  const log = new DecisionLog(key, emit);
  return release({ ...p, log, authorisationTxHash });
}
