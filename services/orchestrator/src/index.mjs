import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  runMilestone, authoriseRelease, pendingReleases, refreshOpen, closeProject,
  reviews, confirmRejection,
} from './works.mjs';
import { runTrade } from './agent.mjs';
import { summarise } from '@kirim/works';
import { reasonerProvider } from './reasoner.mjs';

/**
 * Orchestrator + console host.
 *
 * The console is a static page fed by server-sent events. Every entry the
 * agent appends to its decision log is pushed to the browser as it happens —
 * so what the judges watch is the log itself, not a replay of it.
 */
const PORT = Number(process.env.ORCHESTRATOR_PORT || 4000);
const LEDGER = 'http://localhost:' + (process.env.LEDGER_PORT || 4010);
const MARKET = 'http://localhost:' + (process.env.MARKET_PORT || 4020);
const PROJECT = JSON.parse(fs.readFileSync('fixtures/project.json', 'utf8'));
const TRADES = JSON.parse(fs.readFileSync('fixtures/trades.json', 'utf8'));
const FLOWS = JSON.parse(fs.readFileSync('fixtures/flows.json', 'utf8'));
const CONSOLE_DIR = path.resolve('apps/console/public');

const clients = new Set();
const broadcast = (event) => {
  const line = 'data: ' + JSON.stringify(event) + '\n\n';
  for (const res of clients) res.write(line);
};

// Milestones run in order within a session so the sequence rule and the
// recycled-photograph check have the state they need.
const seenPhotoHashes = new Set();
const priorReleased = [];
let busy = false;

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

/**
 * One handler, one guard. An unhandled rejection inside an async request
 * handler takes the whole process down with it — which is how a console that
 * merely asks the ledger a question ends up killing itself when the ledger is
 * still connecting to XRPL.
 */
const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('[console] ' + req.method + ' ' + req.url + ': ' + e.message);
    if (!res.headersSent) {
      json(res, 503, { error: 'upstream_unavailable', detail: e.message });
    }
  });
});

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost:' + PORT);

  if (url.pathname === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/api/project') {
    return json(res, 200, {
      id: PROJECT.id, name: PROJECT.name, kind: PROJECT.kind,
      currency: PROJECT.currency, narrative: PROJECT.narrative,
      what: PROJECT.what, narrative: PROJECT.narrative,
      client: PROJECT.client, clientRole: PROJECT.clientRole,
      clientContact: PROJECT.clientContact,
      contractor: PROJECT.contractor, contractorRole: PROJECT.contractorRole,
      site: PROJECT.site, totalCents: PROJECT.totalCents,
      preferences: PROJECT.preferences, model: PROJECT.model,
      milestones: PROJECT.milestones.map((m) => ({
        id: m.id, name: m.name, plain: m.plain, amountCents: m.amountCents,
        dueOn: m.dueOn, startsOn: m.startsOn, scenario: m.scenario,
        requiredPhotos: m.requiredPhotos, minInspectionPercent: m.minInspectionPercent,
        requiresPermit: m.requiresPermit ?? null, boq: m.boq ?? [],
        hasRework: Boolean(m.resubmission),
        released: priorReleased.includes(m.id),
      })),
      trades: TRADES.map((t) => ({ id: t.id, label: t.label })),
    });
  }

  // What the client's wallet must sign, if anything is waiting.
  if (url.pathname === '/api/pending') {
    const out = [];
    for (const [key, p] of pendingReleases) {
      out.push({
        key, milestone: p.ms.id, name: p.ms.name, amountCents: p.ms.amountCents,
        authorisation: {
          from: p.escrow.owner,
          to: null,          // filled by the ledger service below
          amountXrp: '0.000001',
          memo: key,
        },
      });
    }
    const health = await fetch(LEDGER + '/health').then((r) => r.json()).catch(() => null);
    if (!health) {
      return json(res, 200, { pending: [], accounts: null, ledger: 'unreachable' });
    }
    for (const o of out) o.authorisation.to = health.accounts.platform;
    return json(res, 200, { pending: out, accounts: health.accounts });
  }

  // The client has signed. Verify it and finish the release.
  if (url.pathname === '/api/authorise' && req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
    catch { return json(res, 400, { error: 'bad_json' }); }
    const key = url.searchParams.get('key');
    if (!key || !body.txHash) return json(res, 400, { error: 'key and txHash are required' });

    json(res, 202, { authorising: key });
    broadcast({ type: 'run_started', id: key, label: 'client authorisation' });
    try {
      const { outcome } = await authoriseRelease(key, body.txHash, {
        emit: (e) => broadcast({ type: 'decision', ...e }),
      });
      if (outcome === 'released') {
        const msId = key.split('/')[1];
        if (!priorReleased.includes(msId)) priorReleased.push(msId);
      }
      broadcast({ type: 'run_finished', id: key, outcome });
    } catch (e) {
      broadcast({ type: 'run_failed', id: key, error: e.message });
    }
    return;
  }

  if (url.pathname === '/api/reasoner') return json(res, 200, reasonerProvider());

  // The before/after the whole product argues with.
  if (url.pathname === '/api/flows') return json(res, 200, FLOWS);

  if (url.pathname === '/api/state') {
    const milestones = milestoneState();
    return json(res, 200, { milestones, project: projectSummary(milestones) });
  }

  // Proxies so the console can render the whole system from one origin.
  if (url.pathname === '/api/providers') {
    const [cat, health] = await Promise.all([
      fetch(MARKET + '/v1/catalog').then((r) => r.json()).catch(() => null),
      fetch(MARKET + '/v1/health').then((r) => r.json()).catch(() => null),
    ]);
    if (!cat) return json(res, 200, { providers: [], market: 'unreachable' });
    const avail = new Map((health?.providers ?? []).map((p) => [p.id, p]));
    return json(res, 200, {
      payTo: cat.payTo,
      providers: cat.providers.map((p) => ({ ...p, ...(avail.get(p.id) ?? {}) })),
    });
  }

  if (url.pathname === '/api/wallets') {
    const h = await fetch(LEDGER + '/health').then((r) => r.json()).catch(() => null);
    if (!h) return json(res, 200, { wallets: [], ledger: 'unreachable' });
    const roles = Object.keys(h.accounts);
    const wallets = await Promise.all(roles.map(async (role) => {
      const b = await fetch(LEDGER + '/balances?role=' + role).then((r) => r.json()).catch(() => null);
      const xrp = b?.balances?.find((x) => x.currency === 'XRP');
      const rl = b?.balances?.find((x) => x.currency?.startsWith('524C555344'));
      return {
        role, address: h.accounts[role],
        xrp: xrp?.value ?? null, rlusd: rl?.value ?? null,
        who: { buyer: 'Client', supplier: 'Contractor', inspector: 'Evidence providers', platform: 'Kirim' }[role] ?? role,
      };
    }));
    return json(res, 200, {
      wallets, payments: h.payments, escrow: h.escrow, escrowNote: h.escrowNote,
      policy: h.policy,
    });
  }

  if (url.pathname === '/api/record') {
    const r = await fetch(LEDGER + '/credentials?role=supplier')
      .then((x) => x.json()).catch(() => null);
    if (!r) {
      return json(res, 200, {
        address: null, milestonesCompleted: 0, projectsCompleted: 0,
        onTimeRate: null, latest: [], ledger: 'unreachable',
      });
    }
    return json(res, 200, { address: r.address, ...summarise(r.credentials) });
  }

  // Milestones held for rework: the escrow is still funded and still open.
  if (url.pathname === '/api/held') {
    const out = [];
    for (const [key, h] of refreshOpen()) {
      const id = key.split('/')[1];
      const ms = PROJECT.milestones.find((m) => m.id === id);
      out.push({
        key, milestone: id, name: ms?.name ?? id,
        amountCents: h.amountCents, attempt: h.attempt,
        canResubmit: Boolean(ms?.resubmission),
        heldAt: h.at,
      });
    }
    return json(res, 200, { held: out });
  }

  /**
   * What a stage requires, and what turned up against it.
   *
   * The left-hand side is computed from the contract — the same fields the
   * rules read — so the checklist cannot drift from what is actually enforced.
   * Ask "is that really what it checks?" and the answer is yes by construction.
   */
  if (url.pathname === '/api/evidence') {
    const id = url.searchParams.get('id');
    const ms = PROJECT.milestones.find((m) => m.id === id);
    if (!ms) return json(res, 404, { error: 'no_such_stage' });

    const state = milestoneState()[id];
    const attempt = state?.attempts > 1 && ms.resubmission ? 2 : 1;
    const sub = attempt > 1 ? ms.resubmission : ms.submission;
    const elements = PROJECT.model?.elements?.[id] ?? [];

    const required = [];
    required.push({
      id: 'photos', need: `${ms.requiredPhotos} photographs, geotagged`,
      detail: elements.length
        ? 'one for each part of the building this stage covers'
        : 'taken on site, within the dates of this stage',
      parts: elements.map((e) => e.label),
    });
    for (const line of ms.boq ?? []) {
      required.push({
        id: 'boq:' + line.sku, need: 'Delivery note from the supplier',
        detail: `${line.qty.toLocaleString('en-US')} ${line.description}`,
      });
    }
    required.push({
      id: 'invoice', need: 'A bill for the agreed amount',
      detail: 'US$' + (ms.amountCents / 100).toLocaleString('en-US'),
    });
    if (ms.requiresPermit) {
      required.push({ id: 'permit', need: 'Permit reference', detail: ms.requiresPermit });
    }
    required.push({
      id: 'survey', need: 'Independent survey',
      detail: `at least ${ms.minInspectionPercent}% of what this stage covers, actually built`,
    });

    return json(res, 200, {
      milestone: { id: ms.id, name: ms.name, plain: ms.plain, amountCents: ms.amountCents,
                   startsOn: ms.startsOn, dueOn: ms.dueOn },
      attempt, required, elements,
      submitted: sub ? {
        submittedAt: sub.submittedAt, note: sub.note,
        permitRef: sub.permitRef ?? null, invoice: sub.invoice ?? null,
        photos: (sub.photos ?? []).map((x) => ({
          file: x.file, takenAt: x.takenAt, evidences: x.evidences ?? null,
          metresFromSite: metres(PROJECT.site, x),
        })),
        deliveries: sub.deliveries ?? [],
      } : null,
      site: PROJECT.site,
      findings: state?.findings ?? [],
      model: state?.model ?? null,
      status: state?.status ?? 'unknown',
    });
  }

  // Refusals the owner has been asked to confirm.
  if (url.pathname === '/api/reviews') {
    const all = reviews();
    return json(res, 200, {
      reviews: Object.entries(all).map(([key, r]) => ({ key, ...r })),
    });
  }

  if (url.pathname === '/api/review/confirm' && req.method === 'POST') {
    const key = url.searchParams.get('key');
    if (!key) return json(res, 400, { error: 'key is required' });
    try {
      const out = await confirmRejection(key, {
        by: PROJECT.clientContact ? `${PROJECT.clientContact} of ${PROJECT.client}` : PROJECT.client,
        emit: (e) => broadcast({ type: 'decision', ...e }),
      });
      broadcast({ type: 'review_confirmed', key });
      return json(res, 200, out);
    } catch (e) {
      return json(res, 404, { error: e.message });
    }
  }

  if (url.pathname === '/api/run' && req.method === 'POST') {
    if (busy) return json(res, 409, { error: 'a milestone is already running' });
    const id = url.searchParams.get('id');
    const ms = PROJECT.milestones.find((m) => m.id === id);
    const trade = TRADES.find((t) => t.id === id);
    if (!ms && !trade) return json(res, 404, { error: 'no_such_item' });

    busy = true;
    json(res, 202, { started: id });
    const again = ms ? refreshOpen().has(PROJECT.id + '/' + ms.id) : false;
    broadcast({
      type: 'run_started', id,
      label: (ms ? ms.name : trade.label) + (again ? ' — corrected evidence' : ''),
    });
    try {
      if (ms) {
        const { outcome } = await runMilestone(PROJECT, ms, {
          seenPhotoHashes, priorReleased,
          emit: (e) => broadcast({ type: 'decision', ...e }),
        });
        if (outcome === 'released' && !priorReleased.includes(ms.id)) priorReleased.push(ms.id);
        // A milestone product that never ends is a to-do list.
        await closeProject(PROJECT, milestoneState(), {
          emit: (e) => broadcast({ type: 'decision', ...e }),
        }).catch((e) => console.error('[close]', e.message));
        broadcast({ type: 'run_finished', id, outcome });
      } else {
        const { outcome } = await runTrade(trade, {
          emit: (e) => broadcast({ type: 'decision', ...e }),
        });
        broadcast({ type: 'run_finished', id, outcome });
      }
    } catch (e) {
      console.error('[orchestrator]', e.message);
      broadcast({ type: 'run_failed', id, error: e.message });
    } finally {
      busy = false;
    }
    return;
  }

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(CONSOLE_DIR, rel);
  if (!file.startsWith(CONSOLE_DIR) || !fs.existsSync(file)) return json(res, 404, { error: 'not_found' });
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

/**
 * Per-stage state, rebuilt from the persisted decision logs so the console
 * means something on a cold page load rather than only during a run.
 */
function milestoneState() {
  const dir = path.resolve('docs/runs');
  // A stage can have more than one log file — the run itself, and the owner's
  // confirmation of a refusal. They are one story, so they are read as one.
  const byStage = new Map();
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const lines = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n');
      const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (!entries.length) continue;
      const id = entries[0].tradeId.split('/')[1];
      if (id === 'CLOSE') continue;
      if (!byStage.has(id)) byStage.set(id, []);
      byStage.get(id).push(...entries);
    }
  } catch { /* no runs yet */ }

  const state = {};
  for (const [id, all] of byStage) {
    const entries = all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const last = entries[entries.length - 1];
    const find = (stage, decision) => entries.find((e) => e.stage === stage && (!decision || e.decision === decision));
    const released = find('settlement', 'released');
    const returned = find('settlement', 'returned');
    const examined = [...entries].reverse().find((e) => e.stage === 'examination');
    const funded = find('escrow', 'funded');
    const fee = find('revenue', 'charged');
    const outcome = find('outcome', 'complete');
    state[id] = {
      status: released ? 'released'
        : returned ? 'returned'
          : find('settlement', 'awaiting_client') ? 'awaiting_client'
            : examined?.decision === 'more_info' ? 'more_info'
              : examined?.decision === 'flagged' ? 'flagged'
                : funded ? 'in_progress' : 'unknown',
      note: examined?.reason ?? last.reason,
      findings: examined?.findings ?? [],
      questions: examined?.questions ?? null,
      model: examined?.model ?? null,
      reviewConfirmed: Boolean(find('review', 'confirmed')),
      attempts: entries.filter((e) => e.stage === 'submission').length,
      spentCents: entries.filter((e) => e.costCents).reduce((a, e) => a + e.costCents, 0),
      feeUsd: fee?.feeCents != null ? (fee.feeCents / 100).toFixed(2) : null,
      elapsedSeconds: outcome?.elapsedSeconds ?? null,
      at: last.at,
      hashes: entries.filter((e) => e.txHash)
        .map((e) => ({ stage: e.stage, decision: e.decision, txHash: e.txHash, explorer: e.explorer })),
    };
  }
  return state;
}

/** Where the project as a whole stands, and whether it is finished. */
function projectSummary(state) {
  const RESOLVED = new Set(['released', 'returned']);
  const ms = PROJECT.milestones;
  const sum = (pred) => ms.filter(pred).reduce((a, m) => a + m.amountCents, 0);
  const is = (id, st) => state[id]?.status === st;
  const resolved = ms.filter((m) => RESOLVED.has(state[m.id]?.status)).length;
  return {
    stages: ms.length,
    resolved,
    closed: resolved === ms.length,
    paidCents: sum((m) => is(m.id, 'released')),
    returnedCents: sum((m) => is(m.id, 'returned')),
    openCents: sum((m) => !RESOLVED.has(state[m.id]?.status)),
    closedAt: closedAt(),
  };
}

function closedAt() {
  try {
    const f = path.resolve('docs/runs', PROJECT.id.replace(/[^A-Za-z0-9._-]/g, '_') + '_CLOSE.jsonl');
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    return last.at;
  } catch { return null; }
}

/** Metres between the site and a photograph, so the console can say how far. */
function metres(site, p) {
  if (p.lat == null || p.lng == null) return null;
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(p.lat - site.lat);
  const dLng = rad(p.lng - site.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(site.lat)) * Math.cos(rad(p.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

server.listen(PORT, () => {
  const r = reasonerProvider();
  console.log('[console] on http://localhost:' + PORT);
  console.log('          review notes: ' + r.provider + (r.model ? ' / ' + r.model : '') +
    (r.provider === 'none' ? '  (composed text — set a key to enable the model)' : ''));
  console.log('          ' + PROJECT.name + ' — ' + PROJECT.client + ' / ' + PROJECT.contractor);
  for (const m of PROJECT.milestones) console.log('          ' + m.id + '  ' + m.name);
});
