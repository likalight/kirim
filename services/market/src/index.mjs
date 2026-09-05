import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { send } from '@kirim/x402';
import { MppServer } from '@kirim/mpp';

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

// The MPP handler verifies settlement on-ledger itself, so the market no
// longer needs its own verification hop into the ledger service.
const mppGate = MppServer.createMarket({
  recipient: PAY_TO,
  secretKey: process.env.MPP_SECRET_KEY
    || 'kirim-dev-secret-key-at-least-32-bytes-long',
});

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
    id: 'site-inspection',
    path: '/v1/site-inspection',
    name: 'Independent site inspection',
    description: 'Automated inspection of a construction milestone: percent complete and defects.',
    price: '0.30',
    turnaroundHours: 48,
  },
  {
    id: 'site-inspection-express',
    path: '/v1/site-inspection-express',
    name: 'Independent site inspection (express)',
    description: 'The same inspection, surveyed within the hour. Priced for deadline pressure.',
    price: '0.55',
    turnaroundHours: 1,
  },
  {
    id: 'photo-forensics',
    path: '/v1/photo-forensics',
    name: 'Photo forensics',
    description: 'EXIF integrity and re-encoding check on submitted site photographs.',
    price: '0.08',
  },
  {
    id: 'materials-registry',
    path: '/v1/materials-registry',
    name: 'Materials delivery verification',
    description: 'Confirms delivery notes exist in the supplier registry with matching quantities.',
    price: '0.10',
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
const PROJECT = JSON.parse(fs.readFileSync('fixtures/project.json', 'utf8'));
const SUPPLIERS = JSON.parse(fs.readFileSync('fixtures/supplier-registry.json', 'utf8'));
const FORENSICS = JSON.parse(fs.readFileSync('fixtures/photo-forensics.json', 'utf8'));

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
  'site-inspection': (q) => {
    const ms = PROJECT.milestones.find((m) => m.id === q.get('milestone'));
    const i = ms?.inspection;
    return attest({
      claim: 'site_inspection',
      projectId: PROJECT.id,
      milestoneId: q.get('milestone'),
      percentComplete: i ? i.percentComplete : null,
      defects: i ? i.defects : [],
      inspectedAt: new Date().toISOString(),
      method: 'automated survey, unattended',
    });
  },

  'site-inspection-express': (q) => {
    const ms = PROJECT.milestones.find((m) => m.id === q.get('milestone'));
    const i = ms?.inspection;
    return attest({
      claim: 'site_inspection',
      projectId: PROJECT.id,
      milestoneId: q.get('milestone'),
      percentComplete: i ? i.percentComplete : null,
      defects: i ? i.defects : [],
      inspectedAt: new Date().toISOString(),
      method: 'automated survey, express',
      turnaroundHours: 1,
    });
  },

  'photo-forensics': (q) => {
    const files = (q.get('files') || '').split(',').filter(Boolean);
    const tampered = files
      .filter((f) => FORENSICS[f])
      .map((f) => ({ file: f, reason: FORENSICS[f].reason }));
    return attest({ claim: 'photo_forensics', checked: files.length, tampered });
  },

  'materials-registry': (q) => {
    const refs = (q.get('refs') || '').split(',').filter(Boolean);
    const unverified = [];
    const verified = [];
    for (const r of refs) {
      const [ref, supplier] = r.split('|');
      const rec = SUPPLIERS[ref];
      if (!rec) unverified.push({ ref, supplier: supplier || 'unknown' });
      else verified.push({ ref, ...rec });
    }
    return attest({ claim: 'materials_delivery', verified, unverified });
  },

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

  const paid = await mppGate(req, res, { priceUsd: entry.price, resource: entry.id });
  if (!paid) return; // MPP wrote the 402 challenge (or an error) already
  send(res, 200, HANDLERS[entry.id](url.searchParams));
});

server.listen(PORT, () => {
  console.log('[market] on :' + PORT + '  payTo=' + PAY_TO + '  (MPP / xrpl-mpp-sdk)');
  for (const c of CATALOG) console.log('         ' + c.price.padStart(5) + '  ' + c.path);
});
