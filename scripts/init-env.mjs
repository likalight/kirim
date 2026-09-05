/**
 * Make `.env` real before anything reads it.
 *
 * Two secrets cannot ship in a repository — the token that guards every route
 * that moves money, and the key that binds MPP challenges to their contents.
 * A placeholder in `.env.example` is the honest way to carry them, and a
 * placeholder that a new clone copies verbatim is a broken setup.
 *
 * So this generates them. Run by `npm run setup` before the wallets are
 * created; safe to run again, and it never overwrites a value you have set.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const secret = () => crypto.randomBytes(32).toString('hex');
const GENERATED = {
  LEDGER_TOKEN: secret,
  MPP_SECRET_KEY: secret,
};

if (!fs.existsSync('.env')) {
  fs.copyFileSync('.env.example', '.env');
  console.log('.env created from .env.example');
}

let env = fs.readFileSync('.env', 'utf8');
let changed = [];

for (const [key, make] of Object.entries(GENERATED)) {
  const line = new RegExp(`^${key}=(.*)$`, 'm');
  const match = env.match(line);
  const value = match?.[1]?.trim() ?? '';

  // Empty, missing, or still carrying the angle-bracket placeholder.
  if (!match) {
    env += `\n${key}=${make()}\n`;
    changed.push(key + ' (added)');
  } else if (value === '' || value.startsWith('<')) {
    env = env.replace(line, `${key}=${make()}`);
    changed.push(key + ' (generated)');
  }
}

if (changed.length) {
  fs.writeFileSync('.env', env);
  console.log('secrets: ' + changed.join(', '));
} else {
  console.log('secrets: already set, left alone');
}

const settlement = env.match(/^SETTLEMENT=(.*)$/m)?.[1]?.trim();
const issuer = env.match(/^RLUSD_ISSUER=(.*)$/m)?.[1]?.trim();
if (settlement === 'RLUSD' && issuer) {
  console.log('settlement: RLUSD — the client wallet must hold RLUSD (https://tryrlusd.com),');
  console.log('            or set SETTLEMENT=XRP to run the same flow without it.');
} else {
  console.log('settlement: XRP — set SETTLEMENT=RLUSD once the client wallet holds RLUSD.');
}
