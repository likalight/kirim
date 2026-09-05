import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { runMilestone, authoriseRelease, pendingReleases } from './works.mjs';
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
const PROJECT = JSON.parse(fs.readFileSync('fixtures/project.json', 'utf8'));
const TRADES = JSON.parse(fs.readFileSync('fixtures/trades.json', 'utf8'));
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
      id: PROJECT.id, name: PROJECT.name, client: PROJECT.client,
      contractor: PROJECT.contractor, site: PROJECT.site,
      totalCents: PROJECT.totalCents,
      milestones: PROJECT.milestones.map((m) => ({
        id: m.id, name: m.name, amountCents: m.amountCents,
        dueOn: m.dueOn, scenario: m.scenario,
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

  // Per-milestone state, rebuilt from the persisted decision logs so both
  // views mean something on a cold page load rather than only during a run.
  if (url.pathname === '/api/state') {
    const dir = path.resolve('docs/runs');
    const state = {};
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        const lines = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n');
        const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        if (!entries.length) continue;
        const id = entries[0].tradeId.split('/')[1];
        const last = entries[entries.length - 1];
        const find = (stage, decision) => entries.find((e) => e.stage === stage && (!decision || e.decision === decision));
        const released = find('settlement', 'released');
        const returned = find('settlement', 'returned');
        const examined = find('examination');
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
          spentCents: entries.filter((e) => e.costCents).reduce((a, e) => a + e.costCents, 0),
          feeUsd: fee?.feeCents != null ? (fee.feeCents / 100).toFixed(2) : null,
          elapsedSeconds: outcome?.elapsedSeconds ?? null,
          at: last.at,
          hashes: entries.filter((e) => e.txHash)
            .map((e) => ({ stage: e.stage, decision: e.decision, txHash: e.txHash, explorer: e.explorer })),
        };
      }
    } catch { /* no runs yet */ }
    return json(res, 200, { milestones: state });
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

  if (url.pathname === '/api/run' && req.method === 'POST') {
    if (busy) return json(res, 409, { error: 'a milestone is already running' });
    const id = url.searchParams.get('id');
    const ms = PROJECT.milestones.find((m) => m.id === id);
    const trade = TRADES.find((t) => t.id === id);
    if (!ms && !trade) return json(res, 404, { error: 'no_such_item' });

    busy = true;
    json(res, 202, { started: id });
    broadcast({ type: 'run_started', id, label: ms ? ms.name : trade.label });
    try {
      if (ms) {
        const { outcome } = await runMilestone(PROJECT, ms, {
          seenPhotoHashes, priorReleased,
          emit: (e) => broadcast({ type: 'decision', ...e }),
        });
        if (outcome === 'released' && !priorReleased.includes(ms.id)) priorReleased.push(ms.id);
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
