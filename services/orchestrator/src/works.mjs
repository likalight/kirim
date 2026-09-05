import { DecisionLog, toCents, fmt } from '@kirim/trade';
import {
  milestone, submission, examineMilestone, credentialUri, requirements, validatePlan,
  verifyAttestation,
} from '@kirim/works';
import { explainMilestone, planEvidence } from './reasoner.mjs';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Persist the decision log. "Can agent decisions be inspected?" is only true
 * if they outlive the process that made them — a run that scrolled past in a
 * terminal is not an audit trail.
 */
function persist(log, key) {
  try {
    const dir = path.resolve('docs/runs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, key.replace(/[^A-Za-z0-9._-]/g, '_') + '.jsonl');
    fs.writeFileSync(file, log.entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return file;
  } catch {
    return null; // never let bookkeeping break a settlement
  }
}

const LEDGER = () => 'http://localhost:' + (process.env.LEDGER_PORT || 4010);
const MARKET = () => 'http://localhost:' + (process.env.MARKET_PORT || 4020);

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
 * Releases waiting on a client signature, keyed by project/milestone. Above the
 * ceiling the agent has done its work and stops; the money moves only once the
 * client's own wallet has authorised it on the ledger.
 *
 * This survives a restart. A pending release holds the escrow's fulfillment —
 * the only thing that can unlock the principal — so losing it to a process
 * restart would strand the client's money until CancelAfter expired, and their
 * signature would arrive to find nothing waiting for it.
 */
const PENDING_FILE = path.resolve('.pending-releases.json');
export const pendingReleases = new Map();

function loadPending() {
  try {
    const raw = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    for (const [k, v] of Object.entries(raw)) pendingReleases.set(k, v);
    if (pendingReleases.size) {
      console.log(`[agent] recovered ${pendingReleases.size} release(s) awaiting a client signature`);
    }
  } catch { /* nothing pending, or first run */ }
}

function savePending() {
  try {
    fs.writeFileSync(PENDING_FILE, JSON.stringify(Object.fromEntries(pendingReleases), null, 2));
  } catch { /* never let bookkeeping break a settlement */ }
}

loadPending();

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
  const startedAt = Date.now();
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
    persist(log, log.tradeId);
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
    persist(log, log.tradeId);
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
  const providerKey = await fetch(MARKET() + '/v1/pubkey')
    .then((r) => r.json()).then((k) => k.publicKey).catch(() => null);

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
    // Verify what was bought. The provider signs its attestation; a signature
    // nobody checks is decoration, and the release decision rests on these.
    const check = verifyAttestation(out.data, providerKey);
    if (!check.ok) {
      log.add('purchase', 'unverified',
        `${p.name} was paid for, but its attestation failed verification: ${check.reason} ` +
        `Treating it as not received — Kirim does not release against evidence it cannot check.`,
        { provider: id, costCents: toCents(p.price), txHash: out.txHash, explorer: out.explorer });
      return null;
    }

    log.add('purchase', 'bought',
      `${p.name} — US$${p.price} over MPP, signature verified. ${why}`, {
        provider: id, costCents: toCents(p.price),
        txHash: out.txHash, explorer: out.explorer,
      });
    return out.data;
  };

  log.add('discovery', 'surveyed',
    `${catalog.providers.length} providers in the market: ` +
    catalog.providers.map((p) => `${p.name} US$${p.price}`).join(', ') + '.');

  // --- plan ------------------------------------------------------------------
  // What has to be established before this milestone can be released, given its
  // own terms and what was actually presented? The agent decides what to buy;
  // the validator holds it to providers that exist, a budget it can afford, and
  // requirements the release rules will block without.
  const daysLate = Math.round(
    (Date.parse(sub.submittedAt) - Date.parse(ms.dueOn + 'T23:59:59+08:00')) / 86400000,
  );
  // The client's own terms. Kirim's platform ceilings still apply — the buyer may
  // be stricter than the platform, never looser.
  const prefs = { ...(project.preferences ?? {}), clientName: project.client };
  const reqs = requirements({ ms, sub, daysLate, prefs });
  const budgetUsd = Math.min(
    Number(process.env.MAX_PER_TRADE_USD ?? 5),
    Number(prefs.evidenceBudgetUsd ?? Infinity),
  );

  // Availability, before anything is planned around a provider that is down.
  const health = await fetch(MARKET() + '/v1/health').then((r) => r.json()).catch(() => null);
  const availability = new Map((health?.providers ?? []).map((p) => [p.id, p]));
  for (const p of catalog.providers) {
    const h = availability.get(p.id);
    if (h) { p.available = h.available; p.reliability = h.reliability; }
  }
  const down = catalog.providers.filter((p) => p.available === false);
  if (down.length) {
    log.add('discovery', 'unavailable',
      `${down.map((p) => p.name).join(', ')} ${down.length === 1 ? 'is' : 'are'} not accepting ` +
      `requests. The plan routes around ${down.length === 1 ? 'it' : 'them'}.`,
      { unavailable: down.map((p) => p.id) });
  }

  const proposed = await planEvidence({
    project, ms, sub, reqs, catalog: catalog.providers, budgetUsd, daysLate,
  });
  const plan = validatePlan({ proposed, reqs, catalog: catalog.providers, budgetUsd });

  log.add('planning', proposed ? 'planned' : 'planned_by_rule',
    `${plan.steps.length} check(s) to buy for US$${plan.estimatedUsd} of ${project.client}'s ` +
    `US$${budgetUsd.toFixed(2)} evidence budget: ` +
    plan.steps.map((st) => `${st.provider} — ${st.why}`).join(' ') +
    (plan.skipped.length
      ? ' Skipped: ' + plan.skipped.map((sk) => `${sk.requirement} — ${sk.why}`).join(' ')
      : '') +
    (proposed ? '' : ' The model did not return a usable plan, so the requirements were taken as written.'),
    { plan: plan.steps, skipped: plan.skipped, estimatedUsd: plan.estimatedUsd });

  for (const c of plan.corrections) {
    log.add('planning', 'corrected', c);
  }

  // --- execute the plan ------------------------------------------------------
  const bought = {};
  for (const step of plan.steps) {
    const query = step.provider.startsWith('site-inspection')
      ? { milestone: ms.id }
      : step.provider === 'photo-forensics'
        ? { files: sub.photos.map((p) => p.file).join(',') }
        : { refs: sub.deliveries.map((d) => `${d.ref}|${d.supplier}`).join(',') };
    bought[step.requirement] = await buy(step.provider, query, step.why);
  }

  // Deliberately over the per-call ceiling, and offered on every milestone. The
  // agent has to be seen refusing something it could buy.
  await buy('credit-report', { name: project.contractor }, 'Considered for a deeper contractor file.');

  const photoForensics = bought['photo-integrity'] ?? null;
  const materials = bought['materials-delivered'] ?? null;
  const inspection = bought['completion'] ?? null;

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
    persist(log, log.tradeId);
  return { log, outcome: 'more_information_needed', escrow };
  }

  if (result.state === 'flagged') {
    log.add('settlement', 'withheld',
      `${fmt(ms.amountCents)} stays in escrow pending ${project.client}'s review. ` +
      `The contractor may present corrected evidence, or the funds return automatically.`);
    persist(log, log.tradeId);
  return { log, outcome: 'flagged_for_review', escrow };
  }

  // --- release --------------------------------------------------------------
  return release({ project, ms, sub, escrow, amountUsd, log, startedAt });
}

/**
 * Finish the escrow and write the track record. Split out because a release
 * above the ceiling happens later, after the client has signed.
 */
async function release({ project, ms, sub, escrow, amountUsd, log, authorisationTxHash, startedAt = Date.now() }) {
  const memo = `${project.id}/${ms.id}`;
  const finished = await ledgerPost('/escrow/finish', {
    by: 'platform', owner: escrow.owner, offerSequence: escrow.offerSequence,
    condition: escrow.condition, fulfillment: escrow.fulfillment,
    amount: amountUsd, memo, authorisationTxHash,
    clientCeilingUsd: project.preferences?.autoReleaseCeilingUsd,
  });

  if (finished.refused) {
    pendingReleases.set(memo, { project, ms, sub, escrow, amountUsd, startedAt });
    savePending();
    log.add('settlement', 'awaiting_client', finished.reason, {
      amountCents: ms.amountCents,
      authorisation: finished.authorisation
        ? { ...finished.authorisation, memo }
        : undefined,
    });
    persist(log, log.tradeId);
  return { log, outcome: 'awaiting_client_authorisation', escrow };
  }

  pendingReleases.delete(memo);
  savePending();

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

  const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(0);
  const spentCents = log.spentCents();
  log.add('outcome', 'complete',
    `${ms.name} settled in ${elapsedS}s. Evidence cost ${fmt(spentCents)} and Kirim charged ` +
    `${finished.fee && !finished.fee.failed ? 'US$' + finished.fee.amountUsd : 'nothing'}. ` +
    `The same assurance conventionally means a site visit and an escrow agent at 3–5% — ` +
    `days, not seconds, and roughly ${fmt(Math.round(ms.amountCents * 0.04))} on this milestone. ` +
    `${project.contractor} was paid on presentation rather than on 30–60 day terms.`,
    { elapsedSeconds: Number(elapsedS), evidenceCents: spentCents,
      feeUsd: finished.fee?.amountUsd, principalCents: ms.amountCents });

  persist(log, log.tradeId);
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
