import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { gate, send } from '@kirim/x402';

/**
 * The provider side of the market.
 *
 * Four x402-gated services the agent may buy while underwriting a trade, plus
 * a free catalogue so it can discover them. Supply is simulated — no Da Nang
 * exporter has an x402 endpoint this weekend — but every payment is real and
 * is verified on-ledger before a byte is served.
 *
 * One provider is deliberately priced above the agent's per-call ceiling. The
 * agent must be seen to refuse it.
 */

const PORT = Number(process.env.MARKET_PORT || 4020);
const LEDGER = 'http://localhost:' + (process.env.LEDGER_PORT || 4010);

const wallets = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
const PAY_TO = wallets.inspector.address;

// Attestations are signed. An unverified attestation is a bought lie.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' });

function attest(claim) {
  const body = { ...claim, issuer: 'kirim-market', issuedAt: new Date().toISOString() };
  const sig = crypto.sign(null, Buffer.from(JSON.stringify(body)), privateKey);
  return { ...body, signature: sig.toString('base64') };
}

async function verifyOnLedger(hash) {
  const r = await fetch(LEDGER + '/tx?hash=' + encodeURIComponent(hash));
  if (!r.ok) throw new Error('ledger service returned ' + r.status);
  return r.json();
}

const CATALOG = [
  {
    id: 'screening',
    path: '/v1/screening',
    name: 'Sanctions & PEP screening',
    description: 'Screens a counterparty against consolidated sanctions and PEP lists.',
    price: '0.05',
  },
  {
    id: 'document-verify',
    path: '/v1/document-verify',
    name: 'Bill of lading verification',
    description: 'Confirms the bill of lading exists in the carrier registry and the vessel sailed.',
    price: '0.12',
  },
  {
    id: 'fx-quote',
    path: '/v1/fx-quote',
    name: 'FX quote',
    description: 'Indicative RLUSD to local-currency rate for the discharge port.',
    price: '0.02',
  },
  {
    id: 'credit-report',
    path: '/v1/credit-report',
    name: 'Full commercial credit report',
    description: 'Deep credit file. Priced for annual subscribers, not per trade.',
    price: '4.50',
  },
];

// --- the data behind the paywalls (fixtures) --------------------------------
const SCREENING = JSON.parse(fs.readFileSync('fixtures/screening.json', 'utf8'));
const CARRIERS = JSON.parse(fs.readFileSync('fixtures/carrier-registry.json', 'utf8'));

const HANDLERS = {
  'screening': (q) => {
    const hit = SCREENING[q.get('name')] ?? { matches: [], listsChecked: ['UN', 'OFAC', 'EU', 'MAS'] };
    return attest({
      claim: 'sanctions_screening',
      subject: q.get('name'),
      matches: hit.matches,
      listsChecked: hit.listsChecked ?? ['UN', 'OFAC', 'EU', 'MAS'],
      clear: (hit.matches ?? []).length === 0,
    });
  },
  'document-verify': (q) => {
    const bl = q.get('bl');
    const rec = CARRIERS[bl];
    return attest({
      claim: 'bill_of_lading_verification',
      blNumber: bl,
      found: !!rec,
      vessel: rec?.vessel ?? null,
      sailedOn: rec?.sailedOn ?? null,
      carrier: rec?.carrier ?? null,
    });
  },
  'fx-quote': (q) => attest({
    claim: 'fx_indicative',
    pair: 'RLUSD/' + (q.get('to') || 'VND'),
    rate: q.get('to') === 'IDR' ? 16210 : 25430,
    spreadBps: 12,
    note: 'Indicative. Executable size on the XRPL DEX at time of settlement.',
  }),
  'credit-report': () => attest({ claim: 'credit_report', note: 'full file' }),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);

  if (url.pathname === '/v1/catalog') {
    return send(res, 200, { payTo: PAY_TO, network: 'xrpl-testnet', providers: CATALOG });
  }
  if (url.pathname === '/v1/pubkey') {
    return send(res, 200, { algorithm: 'ed25519', publicKey: PUBLIC_PEM });
  }

  const entry = CATALOG.find((c) => c.path === url.pathname);
  if (!entry) return send(res, 404, { error: 'no_such_provider' });

  const paid = await gate({
    price: entry.price,
    payTo: PAY_TO,
    asset: 'settlement',
    resource: entry.id,
    description: entry.name,
    verifyOnLedger,
  })(req, res);

  if (!paid) return; // 402 (or a refusal) already written
  send(res, 200, HANDLERS[entry.id](url.searchParams));
});

server.listen(PORT, () => {
  console.log('[market] on :' + PORT + '  payTo=' + PAY_TO);
  for (const c of CATALOG) console.log('         ' + c.price.padStart(5) + '  ' + c.path);
});
