/**
 * Hour zero, step three: four funded testnet wallets, trustlines set.
 *
 *   buyer     the importer whose agent runs the trade
 *   supplier  the exporter who gets paid on conforming documents
 *   inspector a paid third party (x402 provider payee)
 *   platform  Kirim itself: holds the fulfillment, releases the escrow
 */
import { Client } from 'xrpl';
import fs from 'node:fs';
import path from 'node:path';
import { settlementAsset, trustSet } from '../services/ledger/src/xrpl.mjs';

const ROLES = ['buyer', 'supplier', 'inspector', 'platform'];
const FILE = path.join(process.cwd(), 'wallets.json');
const ENDPOINT = process.env.XRPL_ENDPOINT || 'wss://s.altnet.rippletest.net:51233';

const client = new Client(ENDPOINT);
await client.connect();
console.log('connected to ' + ENDPOINT);

const existing = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
const out = { ...existing };

for (const role of ROLES) {
  if (out[role]) { console.log(role.padEnd(9) + ' already funded  ' + out[role].address); continue; }
  const { wallet, balance } = await client.fundWallet();
  out[role] = { address: wallet.address, seed: wallet.seed };
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2));
  console.log(role.padEnd(9) + ' funded  ' + wallet.address + '  ' + balance + ' XRP');
}

const asset = settlementAsset();
if (typeof asset === 'object') {
  console.log('\nsetting RLUSD trustlines against issuer ' + asset.issuer);
  const { Wallet } = await import('xrpl');
  for (const role of ROLES) {
    try {
      const r = await trustSet(Wallet.fromSeed(out[role].seed), asset);
      console.log('  ' + role.padEnd(9) + ' ' + (r.hash || r.skipped));
    } catch (e) {
      console.log('  ' + role.padEnd(9) + ' FAILED: ' + e.message);
    }
  }
  console.log('\nNow fund the buyer with RLUSD from https://tryrlusd.com');
  console.log('  buyer: ' + out.buyer.address);
} else {
  console.log('\nSETTLEMENT is XRP (no RLUSD_ISSUER set) — the fallback path.');
  console.log('Set RLUSD_ISSUER in .env once you have it from https://tryrlusd.com');
}

console.log('\nwallets.json written. It is gitignored. Never commit it.');
await client.disconnect();
