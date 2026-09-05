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
    const body = log.entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    // A second attempt continues the first one's story rather than erasing it.
    // Overwriting is how a stage that was rejected, corrected and then paid ends
    // up reading as though it sailed through first time.
    const reopened = log.entries[0]?.decision === 'reopened';
    if (reopened) fs.appendFileSync(file, body);
    else fs.writeFileSync(file, body);
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
 * Escrows that are funded and still open because the evidence did not conform.
 * A held milestone is not a finished one — the money is still locked, the
 * contractor still has until `CancelAfter`, and a corrected submission has to
 * be examined against the *same* escrow rather than a second one.
 *
 * Without this the loop the product describes does not exist: the agent would
 * say "the contractor may present corrected evidence" and then have nowhere
 * for that evidence to go.
 */
const OPEN_FILE = path.resolve('.open-escrows.json');
export const openEscrows = new Map();

function loadOpen(quiet = false) {
  try {
    const raw = JSON.parse(fs.readFileSync(OPEN_FILE, 'utf8'));
    openEscrows.clear();
    for (const [k, v] of Object.entries(raw)) openEscrows.set(k, v);
    if (openEscrows.size && !quiet) {
      console.log(`[agent] recovered ${openEscrows.size} escrow(s) still open on held milestones`);
    }
  } catch {
    if (quiet) openEscrows.clear(); // the file is gone: nothing is held
  }
}

/**
 * `npm run milestone` and the console are separate processes writing the same
 * held-escrow file. Whoever reads it second has to read it from disk, or the
 * console will offer to fund an escrow that is already open.
 */
export function refreshOpen() {
  loadOpen(true);
  return openEscrows;
}

function saveOpen() {
  try {
    fs.writeFileSync(OPEN_FILE, JSON.stringify(Object.fromEntries(openEscrows), null, 2));
  } catch { /* never let bookkeeping break a settlement */ }
}

loadOpen();

/**
 * Rejections waiting for the owner to confirm.
 *
 * When the agent refuses a claim it does not simply go quiet. It puts the
 * refusal in front of the person whose money it is, with the reasons, and waits
 * to be told to proceed. That is a different act from approving a payment: the
 * owner is confirming a *no*, which is the decision they actually care about
 * and the one the agent should never make alone in front of a counterparty.
 *
 * Note what they cannot do here — overrule the agent into paying. If a human
 * could wave a failed claim through, none of the guarantees above it mean
 * anything.
 */
const REVIEWS_FILE = path.resolve('.reviews.json');

export function reviews() {
  try {
    return JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveReviews(all) {
  try {
    fs.writeFileSync(REVIEWS_FILE, JSON.stringify(all, null, 2));
  } catch { /* never let bookkeeping break a settlement */ }
}

function openReview(key, body) {
  const all = reviews();
  all[key] = { ...body, raisedAt: new Date().toISOString(), state: 'waiting' };
  saveReviews(all);
}

/**
 * The owner has read the refusal and agreed with it. Nothing about the money
 * changes — it was never going to move — but the decision is now a joint one,
 * and it is on the record as such.
 */
export async function confirmRejection(key, { emit = () => {}, by = 'the owner' } = {}) {
  const all = reviews();
  const r = all[key];
  if (!r) throw new Error('no review is waiting for ' + key);
  if (r.state !== 'waiting') return { already: true, review: r };

  const log = new DecisionLog(key, emit);
  log.add('review', 'confirmed',
    `${by} read the agent's reasons and agreed with the refusal. ${fmt(r.amountCents)} stays `
    + `locked. This is a joint decision now — the agent found the problems, and the person whose `
    + `money it is has said so out loud.`,
    { confirmedBy: by, findings: r.findings });
  persist(log, key + '/review');

  all[key] = { ...r, state: 'confirmed', confirmedAt: new Date().toISOString(), confirmedBy: by };
  saveReviews(all);
  return { review: all[key] };
}

/**
 * Photographs that have already been paid against.
 *
 * The recycled-photograph rule is only as good as its memory. Held in a Set on
 * one process it fires when the whole demo runs in one go and silently does not
 * when the stages are run separately — which is exactly the shape of a check
 * that looks like it works right up until it matters.
 *
 * A photograph is spent when money moved against it, and that is a durable
 * fact, so it is kept the way every other durable fact here is kept.
 */
const PHOTOS_FILE = path.resolve('.paid-photos.json');

/**
 * Stages that have actually been paid for, read off the persisted logs.
 *
 * The sequence rule ("you cannot certify the frame before the foundations")
 * needs to know what has been released. Held in memory it answers differently
 * depending on whether the demo ran in one process or several — which is not a
 * rule, it is a coincidence.
 */
/**
 * How each stage stands, read off the persisted logs. Both the console and the
 * CLI need this to know whether the job is finished, and neither should be
 * asking the other process what it remembers.
 */
export function stageStatuses() {
  const byStage = new Map();
  try {
    const dir = path.resolve('docs/runs');
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').trim().split(/\r?\n/);
      const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (!entries.length) continue;
      const id = entries[0].tradeId.split('/')[1];
      if (id === 'CLOSE') continue;
      if (!byStage.has(id)) byStage.set(id, []);
      byStage.get(id).push(...entries);
    }
  } catch { /* nothing has run */ }

  const out = {};
  for (const [id, all] of byStage) {
    const has = (stage, decision) => all.some((e) => e.stage === stage && e.decision === decision);
    out[id] = {
      status: has('settlement', 'released') ? 'released'
        : has('settlement', 'returned') ? 'returned'
          : has('settlement', 'awaiting_client') ? 'awaiting_client'
            : has('examination', 'flagged') ? 'flagged'
              : has('examination', 'more_info') ? 'more_info'
                : has('escrow', 'funded') ? 'in_progress' : 'unknown',
    };
  }
  return out;
}

export function releasedStages() {
  const out = [];
  try {
    const dir = path.resolve('docs/runs');
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n');
      const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (!entries.length) continue;
      const id = entries[0].tradeId.split('/')[1];
      if (entries.some((e) => e.stage === 'settlement' && e.decision === 'released')) out.push(id);
    }
  } catch { /* nothing has run */ }
  return out;
}

export function paidPhotos() {
  try {
    const raw = JSON.parse(fs.readFileSync(PHOTOS_FILE, 'utf8'));
    // An older build stored a bare list, before it mattered which stage paid.
    if (Array.isArray(raw)) return Object.fromEntries(raw.map((h) => [h, '?']));
    return raw;
  } catch {
    return {};
  }
}

function recordPaidPhotos(hashes, milestoneId) {
  if (!hashes.length) return;
  const all = paidPhotos();
  for (const h of hashes) all[h] = milestoneId;
  try {
    fs.writeFileSync(PHOTOS_FILE, JSON.stringify(all, null, 2));
  } catch { /* never let bookkeeping break a settlement */ }
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
  emit = () => {}, seenPhotoHashes = new Set(), priorReleased = [], resubmit = false,
} = {}) {
  const ms = milestone({ ...ms0, projectId: project.id, site: project.site });
  const key = `${project.id}/${ms.id}`;
  const log = new DecisionLog(key, emit);
  const startedAt = Date.now();
  const amountUsd = (ms.amountCents / 100).toFixed(2);

  // A held milestone still has its escrow. Coming back to it is a second
  // attempt at the same money, not a second commitment of it.
  refreshOpen();
  const held = openEscrows.get(key);
  const attempt = (held?.attempt ?? 0) + 1;

  log.add('milestone', attempt > 1 ? 'reopened' : 'opened',
    attempt > 1
      ? `${ms.name} — attempt ${attempt}. ${fmt(ms.amountCents)} is still escrowed from the `
        + `first submission; ${project.contractor} has presented corrected evidence against `
        + `the same escrow.`
      : `${ms.name} — ${fmt(ms.amountCents)} of ${project.name}. Agreed ${ms.startsOn} to ${ms.dueOn}, `
        + `site ${project.site.address}, ${ms.requiredPhotos} photographs required`
        + (ms.requiresPermit ? `, ${ms.requiresPermit} permit required.` : '.'),
    { amountCents: ms.amountCents, attempt });

  // --- fund the escrow, or pick up the one already funded -------------------
  let escrow;
  if (held) {
    escrow = held.escrow;
    log.add('escrow', 'reused',
      `No second payment. ${fmt(ms.amountCents)} has been locked under the same `
      + `crypto-condition since attempt 1 — a rejected milestone never returned the `
      + `money to ${project.client}, and never released it to ${project.contractor} either.`,
      { txHash: escrow.txHash, explorer: escrow.explorer, amountCents: ms.amountCents });
  } else {
    escrow = await ledgerPost('/escrow/create', {
      from: 'buyer', to: 'supplier', amount: amountUsd, tradeId: key,
      memo: key, cancelAfterSeconds: ms0.cancelAfterSeconds ?? 900,
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
  }

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

  // Attempt 2 is the corrected evidence, if the fixture carries any.
  const raw = attempt > 1 && ms0.resubmission ? ms0.resubmission : ms0.submission;
  const sub = submission({ ...raw, milestoneId: ms.id });
  log.add('submission', attempt > 1 ? 'resubmitted' : 'received',
    `${project.contractor} ${attempt > 1 ? 'resubmitted' : 'submitted'} ` +
    `${sub.photos.length} photograph(s), ` +
    `${sub.deliveries.length} delivery note(s)` +
    (sub.permitRef ? `, permit ${sub.permitRef}` : ', no permit reference') +
    (sub.invoice ? `, invoice ${sub.invoice.ref} for ${fmt(sub.invoice.amountCents)}` : ', no invoice') +
    `. "${sub.note}"`, { attempt });

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
  // If a check cannot be bought the agent stops rather than deciding on
  // evidence it never got. The money stays escrowed, which is the safe side of
  // that failure — and it is a logged decision, not a stack trace.
  const bought = {};
  for (const step of plan.steps) {
    const query = step.provider.startsWith('site-inspection')
      ? { milestone: ms.id, attempt: String(attempt) }
      : step.provider === 'photo-forensics'
        ? { files: sub.photos.map((p) => p.file).join(',') }
        : { refs: sub.deliveries.map((d) => `${d.ref}|${d.supplier}`).join(',') };
    try {
      bought[step.requirement] = await buy(step.provider, query, step.why);
    } catch (e) {
      const outOfFunds = /PATH_FAILED|UNFUNDED|insufficient/i.test(e.message);
      log.add('purchase', 'unavailable',
        `Could not buy ${step.provider}: ${outOfFunds
          ? 'the wallet paying for checks has run out. Run `npm run topup` and try again.'
          : e.message}`);
      log.add('settlement', 'held',
        `${fmt(ms.amountCents)} stays in escrow. The agent could not obtain the evidence it needs `
        + `to decide, and it will not release money on evidence it does not have.`);
      // The builder did nothing wrong here, so this does not burn an attempt.
      // Recording it as one would mean the next run reads their corrected
      // evidence in answer to a claim they were never told had failed.
      openEscrows.set(key, {
        escrow, attempt: attempt - 1, amountCents: ms.amountCents,
        at: new Date().toISOString(), infrastructural: true,
      });
      saveOpen();
      persist(log, log.tradeId);
      return { log, outcome: 'checks_unavailable', escrow, reworkable: true };
    }
  }

  // Deliberately over the per-call ceiling, and offered on every milestone. The
  // agent has to be seen refusing something it could buy.
  await buy('credit-report', { name: project.contractor }, 'Considered for a deeper contractor file.');

  const photoForensics = bought['photo-integrity'] ?? null;
  const materials = bought['materials-delivered'] ?? null;
  const inspection = bought['completion'] ?? null;

  // --- examination ----------------------------------------------------------
  // Whatever this process has seen, plus everything an earlier run paid for —
  // but only against a *different* stage. A photograph of the foundations is
  // evidence for the foundations no matter how many times that stage is run;
  // it is only recycled when it turns up somewhere it does not belong.
  for (const [h, paidFor] of Object.entries(paidPhotos())) {
    if (paidFor !== ms.id) seenPhotoHashes.add(h);
  }
  const released = [...new Set([...priorReleased, ...releasedStages()])];

  const result = examineMilestone({
    ms, sub, inspection, photoForensics, materials, seenPhotoHashes,
    priorReleased: released,
    elements: project.model?.elements?.[ms.id] ?? null,
  });

  const advice = await explainMilestone({ project, ms, sub, result });
  log.add('examination', result.state, advice, {
    findings: result.all, verdict: result.verdict, state: result.state,
    questions: result.questions, model: result.model,
  });

  // Held, not finished. The escrow stays open and is handed back to the
  // contractor, so a corrected submission has the same money to release.
  const hold = (decision, reason, outcome) => {
    log.add('settlement', decision, reason, { attempt });
    openEscrows.set(key, { escrow, attempt, amountCents: ms.amountCents, at: new Date().toISOString() });
    saveOpen();

    // A contradiction gets put in front of the owner. Missing paperwork does
    // not — nobody needs to be interrupted because a photograph is late.
    if (result.state === 'flagged') {
      openReview(key, {
        milestone: ms.id, name: ms.name, amountCents: ms.amountCents, attempt,
        findings: result.blocking.map((f) => ({ code: f.code, text: f.text })),
        verdict: result.verdict,
      });
      log.add('review', 'requested',
        `${project.client} has been asked to confirm the refusal. The agent will not pay this `
        + `claim; the owner is being told why, and is being asked to say whether they agree.`,
        { attempt });
    }

    log.add('rework', 'requested',
      `${project.contractor} has been notified and can present corrected evidence against `
      + `this same escrow. Nothing is final until it either conforms or the cancel time passes.`,
      { attempt });
    persist(log, log.tradeId);
    return { log, outcome, escrow, reworkable: true };
  };

  if (result.state === 'more_info') {
    return hold('held',
      `${fmt(ms.amountCents)} stays in escrow. Nothing submitted contradicts the scope — the `
      + `submission is simply incomplete, and ${project.contractor} can complete it before the `
      + `cancel time. No mark is recorded against their track record.`,
      'more_information_needed');
  }

  if (result.state === 'flagged') {
    return hold('withheld',
      `${fmt(ms.amountCents)} stays in escrow pending ${project.client}'s review. `
      + `${project.contractor} may present corrected evidence, or the funds return automatically.`,
      'flagged_for_review');
  }

  // --- release --------------------------------------------------------------
  return release({ project, ms, sub, escrow, amountUsd, log, startedAt, attempt, seenPhotoHashes });
}

/**
 * Finish the escrow and write the track record. Split out because a release
 * above the ceiling happens later, after the client has signed.
 */
async function release({ project, ms, sub, escrow, amountUsd, log, authorisationTxHash,
                         startedAt = Date.now(), attempt = 1, seenPhotoHashes = new Set() }) {
  const memo = `${project.id}/${ms.id}`;

  // A photograph is spent at the moment it is paid against, not the moment it
  // is shown. Recording it any earlier would reject a contractor's own
  // untouched photographs the second they corrected the one that was wrong.
  const spent = (sub.photos ?? []).map((x) => x.sha256).filter(Boolean);
  for (const h of spent) seenPhotoHashes.add(h);
  recordPaidPhotos(spent, ms.id);
  const finished = await ledgerPost('/escrow/finish', {
    by: 'platform', owner: escrow.owner, offerSequence: escrow.offerSequence,
    condition: escrow.condition, fulfillment: escrow.fulfillment,
    amount: amountUsd, memo, authorisationTxHash,
    clientCeilingUsd: project.preferences?.autoReleaseCeilingUsd,
  });

  if (finished.refused) {
    pendingReleases.set(memo, { project, ms, sub, escrow, amountUsd, startedAt });
    savePending();
    openEscrows.delete(memo);
    saveOpen();
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
  openEscrows.delete(memo);
  saveOpen();
  const rs = reviews();
  if (rs[memo]) { delete rs[memo]; saveReviews(rs); }

  if (attempt > 1) {
    log.add('rework', 'accepted',
      `Corrected on attempt ${attempt}. The money never left ${project.client}'s escrow while `
      + `the work was being put right, and ${project.contractor} was not made to wait for a `
      + `dispute to resolve before being paid for work that now conforms.`,
      { attempt });
  }

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


/**
 * Close the project once every stage has come to rest.
 *
 * A milestone product that never ends is a to-do list. The closing credential
 * is written to the builder's own account like every other one, and is keyed to
 * the project so it cannot be issued twice — the same reason a stage credential
 * cannot be.
 */
export async function closeProject(project, statuses, { emit = () => {} } = {}) {
  const RESOLVED = new Set(['released', 'returned']);
  const stages = project.milestones.map((m) => statuses[m.id]?.status);
  if (stages.length !== project.milestones.length) return null;
  if (!stages.every((st) => RESOLVED.has(st))) return null;

  const paid = project.milestones
    .filter((m) => statuses[m.id]?.status === 'released')
    .reduce((a, m) => a + m.amountCents, 0);
  const returned = project.milestones
    .filter((m) => statuses[m.id]?.status === 'returned')
    .reduce((a, m) => a + m.amountCents, 0);

  const log = new DecisionLog(`${project.id}/CLOSE`, emit);
  log.add('project', 'closing',
    `Every stage of ${project.name} has come to rest. ${fmt(paid)} was released against evidence `
    + `and ${fmt(returned)} went back to ${project.client} because the work was never presented.`,
    { paidCents: paid, returnedCents: returned });

  let cred = null;
  try {
    cred = await ledgerPost('/credential/issue', {
      by: 'platform', subject: 'supplier',
      credentialType: `KIRIM:${project.id}:PROJECT`,
      uri: `kirim:project/${project.id}/closed?paid=${paid}&returned=${returned}`,
      accept: true,
    });
    log.add('project', cred.alreadyIssued ? 'already_closed' : 'closed',
      cred.alreadyIssued
        ? `${project.name} was already closed on ${project.contractor}'s ledger record.`
        : `${project.name} is closed. The completed project is written to ${project.contractor}'s own `
          + `XRPL account — they keep it, and they can show it to their next client without asking us.`,
      { txHash: cred.txHash, explorer: cred.explorer });
  } catch (e) {
    log.add('project', 'close_failed',
      `Every stage is resolved, but the closing credential could not be written: ${e.message}. `
      + `The settlements stand; only the record is incomplete.`);
  }
  persist(log, log.tradeId);
  return { log, paid, returned, credential: cred };
}
