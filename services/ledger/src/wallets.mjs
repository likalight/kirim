import fs from 'node:fs';
import path from 'node:path';
import { Wallet } from 'xrpl';

const FILE = path.join(process.cwd(), 'wallets.json');

export function loadWallets() {
  if (!fs.existsSync(FILE)) {
    throw new Error('wallets.json not found — run: npm run setup');
  }
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const out = {};
  for (const [role, w] of Object.entries(raw)) out[role] = Wallet.fromSeed(w.seed);
  return out;
}

export function saveWallets(map) {
  fs.writeFileSync(FILE, JSON.stringify(map, null, 2));
}

export function walletsFile() { return FILE; }
