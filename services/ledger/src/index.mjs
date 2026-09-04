import http from 'node:http';
import { loadWallets } from './wallets.mjs';
import { SpendPolicy } from './policy.mjs';
import { toCents } from '@kirim/trade';
import {
  xrpl, settlementAsset, pay, escrowCreate, escrowFinish, escrowCancel,
  verifyTx, balances, trustSet, explorerTx, scalePrincipal,
  credentialCreate, credentialAccept, readCredentials,
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
  // Funding only moves money into protection, so no approval ceiling applies
  // here. The ceiling lives on /escrow/finish, where the act is irreversible.
  'POST /escrow/create': async (b) => {
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

  // Release is where the human ceiling applies: funding an escrow only moves
  // money into protection, releasing it is the irreversible act.
  'POST /escrow/finish': async (b) => {
    if (b.amount !== undefined) {
      const cents = toCents(b.amount);
      if (cents > policy.approvalAbove && !b.authorisedBy) {
        return {
          refused: true, needsApproval: true,
          reason: `Release of ${b.amount} exceeds the autonomous ceiling. `
            + `The evidence is in order; the client must authorise the payment.`,
        };
      }
    }
    const out = await escrowFinish({
      wallet: wallets[b.by ?? 'platform'], owner: b.owner,
      offerSequence: b.offerSequence, condition: b.condition, fulfillment: b.fulfillment,
    });
    return { refused: false, txHash: out.hash, explorer: out.explorer };
  },

  'POST /escrow/cancel': async (b) => {
    const out = await escrowCancel({
      wallet: wallets[b.by ?? 'platform'], owner: b.owner, offerSequence: b.offerSequence,
    });
    return { txHash: out.hash, explorer: out.explorer };
  },

  // --- XLS-70 credentials: the contractor's track record, on the ledger ----
  'POST /credential/issue': async (b) => {
    const issuer = wallets[b.by ?? 'platform'];
    const subjectAddr = wallets[b.subject]?.address ?? b.subject;

    // A credential is keyed by (issuer, subject, type) and the type carries the
    // milestone, so issuing is idempotent by construction. tecDUPLICATE means
    // this milestone is already on the contractor's record — the right outcome,
    // not a failure. Re-running the demo must never break on it.
    let created;
    try {
      created = await credentialCreate({
        wallet: issuer, subject: subjectAddr,
        credentialType: b.credentialType, uri: b.uri,
      });
    } catch (e) {
      if (e.result === 'tecDUPLICATE') {
        return {
          alreadyIssued: true, issuer: issuer.address, subject: subjectAddr,
          note: 'This milestone is already recorded on the contractor account.',
        };
      }
      throw e;
    }
    // The subject must accept, or the credential sits unaccepted and proves
    // nothing. In production that is the contractor's own wallet doing it.
    let accepted = null;
    if (wallets[b.subject]) {
      try {
        accepted = await credentialAccept({
          wallet: wallets[b.subject], issuer: issuer.address, credentialType: b.credentialType,
        });
      } catch (e) {
        if (e.result !== 'tecDUPLICATE') throw e;
      }
    }
    return {
      issueTxHash: created.hash, issueExplorer: created.explorer,
      acceptTxHash: accepted?.hash, acceptExplorer: accepted?.explorer,
      issuer: issuer.address, subject: subjectAddr,
    };
  },

  'GET /credentials': async (_b, url) => {
    const role = url.searchParams.get('role');
    const address = wallets[role]?.address ?? url.searchParams.get('address');
    return { address, credentials: await readCredentials(address) };
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
