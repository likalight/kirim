import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { runTrade } from './agent.mjs';

/**
 * Orchestrator + console host.
 *
 * The console is a static page fed by server-sent events. Every entry the
 * agent appends to its decision log is pushed to the browser as it happens —
 * so what the judges watch is the log itself, not a replay of it.
 */
const PORT = Number(process.env.ORCHESTRATOR_PORT || 4000);
const TRADES = JSON.parse(fs.readFileSync('fixtures/trades.json', 'utf8'));
const CONSOLE_DIR = path.resolve('apps/console/public');

const clients = new Set();
const broadcast = (event) => {
  const line = 'data: ' + JSON.stringify(event) + '\n\n';
  for (const res of clients) res.write(line);
};

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
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

  if (url.pathname === '/api/trades') {
    return json(res, 200, TRADES.map((t) => ({ id: t.id, label: t.label, supplier: t.po.supplier })));
  }

  if (url.pathname === '/api/run' && req.method === 'POST') {
    const id = url.searchParams.get('id');
    const trade = TRADES.find((t) => t.id === id);
    if (!trade) return json(res, 404, { error: 'no_such_trade' });

    json(res, 202, { started: trade.id });
    broadcast({ type: 'run_started', tradeId: trade.id, label: trade.label });
    try {
      const { outcome } = await runTrade(trade, { emit: (e) => broadcast({ type: 'decision', ...e }) });
      broadcast({ type: 'run_finished', tradeId: trade.id, outcome });
    } catch (e) {
      console.error('[orchestrator]', e);
      broadcast({ type: 'run_failed', tradeId: trade.id, error: e.message });
    }
    return;
  }

  // static console
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(CONSOLE_DIR, rel);
  if (!file.startsWith(CONSOLE_DIR) || !fs.existsSync(file)) return json(res, 404, { error: 'not_found' });
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

server.listen(PORT, () => {
  console.log('[orchestrator] console on http://localhost:' + PORT);
  for (const t of TRADES) console.log('              ' + t.id + '  ' + t.label);
});
