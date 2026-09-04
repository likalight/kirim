import http from 'node:http';
import { loadWallets } from './wallets.mjs';
import { SpendPolicy } from './policy.mjs';
import { toCents } from '@kirim/trade';
import {
  xrpl, settlementAsset, pay, escrowCreate, escrowFinish, escrowCancel,
  verifyTx, balances, trustSet, explorerTx, scalePrincipal,
} from './xrpl.mjs';

/**
 * The ledger service is the only process that holds a seed and the only one
 * that can move money. Everything else asks.
 */
const PORT = Number(process.env.LEDGER_PORT || 4010);
const wallets = loadWallets();
const policy = new SpendPolicy();
const asset = settlementAsset();

const routes = {
  'GET /health': async () => ({
    ok: true,
    settlement: asset === 'XRP' ? 'XRP' : 'RLUSD',
    accounts: Object.fromEntries(Object.entries(wallets).map(([k, w]) => [k, w.address])),
    policy: policy.snapshot(),
  }),

  'GET /balances': async (_b, url) => {
    const role = url.searchParams.get('role') || 'buyer';
    return { role, address: wallets[role].address, balances: await balances(wallets[role].address) };
  },

  'POST /trustline': async (b) => trustSet(wallets[b.role ?? 'buyer'], asset),

  // The agent's operating spend: x402 calls. Ceilings apply.
  'POST /pay': async (b) => {
    const cents = toCents(b.amount);
    const tradeId = b.tradeId ?? 'adhoc';
    const verdict = policy.check({ amountCents: cents, tradeId, kind: 'operating' });
    if (!verdict.ok) return { refused: true, ...verdict };
    const out = await pay({
      wallet: wallets[b.from ?? 'buyer'],
      to: wallets[b.to]?.address ?? b.to,
      value: b.amount,
      asset,
      memo: b.memo ?? tradeId,
    });
    policy.record({ amountCents: cents, tradeId, kind: 'operating' });
    return { refused: false, txHash: out.hash, explorer: out.explorer };
  },

  // The trade principal. Bounded by the approval threshold, not the per-call cap.
  'POST /escrow/create': async (b) => {
    const cents = toCents(b.amount);
    const verdict = policy.check({ amountCents: cents, tradeId: b.tradeId, kind: 'escrow' });
    if (!verdict.ok) return { refused: true, ...verdict };
    const wallet = wallets[b.from ?? 'buyer'];
    const principal = scalePrincipal(b.amount);
    const out = await escrowCreate({
      wallet,
      to: wallets[b.to]?.address ?? b.to,
      value: principal.value,
      asset,
      memo: b.memo ?? b.tradeId,
      cancelAfterSeconds: b.cancelAfterSeconds ?? 900,
    });
    return {
      refused: false, txHash: out.hash, explorer: out.explorer,
      offerSequence: out.offerSequence, condition: out.condition, fulfillment: out.fulfillment,
      owner: wallet.address,
      ledgerAmount: principal.value, scaled: principal.scaled, scalingNote: principal.note,
    };
  },

  'POST /escrow/finish': async (b) => {
    const out = await escrowFinish({
      wallet: wallets[b.by ?? 'platform'], owner: b.owner,
      offerSequence: b.offerSequence, condition: b.condition, fulfillment: b.fulfillment,
    });
    return { txHash: out.hash, explorer: out.explorer };
  },

  'POST /escrow/cancel': async (b) => {
    const out = await escrowCancel({
      wallet: wallets[b.by ?? 'platform'], owner: b.owner, offerSequence: b.offerSequence,
    });
    return { txHash: out.hash, explorer: out.explorer };
  },

  'GET /tx': async (_b, url) => verifyTx(url.searchParams.get('hash')),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const key = req.method + ' ' + url.pathname;
  const handler = routes[key];
  if (!handler) return json(res, 404, { error: 'not_found', key });

  let body = {};
  if (req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (chunks.length) {
      try { body = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { return json(res, 400, { error: 'bad_json' }); }
    }
  }
  try {
    json(res, 200, await handler(body, url));
  } catch (e) {
    console.error('[ledger] ' + key + ':', e.message);
    json(res, 500, {
      error: 'ledger_error', detail: e.message, result: e.result,
      explorer: e.hash ? explorerTx(e.hash) : undefined,
    });
  }
});

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

await xrpl();
server.listen(PORT, () => {
  console.log('[ledger] on :' + PORT + '  settlement=' + (asset === 'XRP' ? 'XRP' : 'RLUSD'));
  for (const [role, w] of Object.entries(wallets)) console.log('         ' + role.padEnd(9) + ' ' + w.address);
});
