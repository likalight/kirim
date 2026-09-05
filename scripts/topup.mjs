/**
 * Top the demo wallets back up before a run.
 *
 * Two things drain across repeated demos and they drain differently:
 *
 *   XRP    every escrow locks it and every release sends it to the developer,
 *          so the buyer empties. The testnet faucet refills this.
 *
 *   RLUSD  the buyer pays the evidence providers about 48 cents a stage, and it
 *          accumulates in the inspector wallet. There is no RLUSD faucet we can
 *          call — it is wallet-connect only, capped at 10 a day — so the float
 *          is recycled back from the inspector instead. It is the same money
 *          going round the same four wallets, which is all a demo needs.
 *
 * A demo that dies on an unfunded wallet in front of judges is an avoidable way
 * to lose, so this errs towards topping up more than is strictly needed.
 *
 *     npm run topup              buyer XRP + recycle the RLUSD float
 *     npm run topup buyer platform
 */
import { Client, Wallet, getBalanceChanges } from 'xrpl';
import fs from 'node:fs';

const RLUSD = process.env.RLUSD_ISSUER;
const CURRENCY = '524C555344000000000000000000000000000000';   // "RLUSD", hex, 40 chars
const FLOAT_TARGET = 8;      // RLUSD in the buyer wallet: enough for a full demo and then some

const roles = process.argv.slice(2);
const want = roles.length ? roles : ['buyer'];
const w = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
const c = new Client(process.env.XRPL_ENDPOINT || 'wss://s.altnet.rippletest.net:51233',
  { connectionTimeout: 20000 });
await c.connect();

async function rlusd(address) {
  if (!RLUSD) return null;
  const r = await c.request({ command: 'account_lines', account: address, peer: RLUSD });
  const line = r.result.lines.find((l) => l.currency === CURRENCY || l.currency === 'RLUSD');
  return line ? Number(line.balance) : 0;
}

for (const role of want) {
  if (!w[role]) { console.log(role + ': no such wallet'); continue; }
  const wallet = Wallet.fromSeed(w[role].seed);
  const before = await c.getXrpBalance(wallet.address);
  try {
    await c.fundWallet(wallet);
  } catch (e) {
    console.log(role.padEnd(10) + 'faucet declined: ' + e.message);
  }
  const after = await c.getXrpBalance(wallet.address);
  console.log(role.padEnd(10) + before + ' -> ' + after + ' XRP  (' + wallet.address + ')');
}

// --- recycle the evidence float -------------------------------------------
if (RLUSD && w.buyer && w.inspector) {
  const buyer = Wallet.fromSeed(w.buyer.seed);
  const inspector = Wallet.fromSeed(w.inspector.seed);
  const held = await rlusd(buyer.address);
  const pool = await rlusd(inspector.address);
  const need = Math.max(0, FLOAT_TARGET - held);
  const send = Math.min(need, Math.max(0, pool - 0.5));

  if (send < 0.1) {
    console.log(`float     buyer holds ${held} RLUSD — enough for ~${Math.floor(held / 0.48)} more stage(s)`);
  } else {
    const prepared = await c.autofill({
      TransactionType: 'Payment',
      Account: inspector.address,
      Destination: buyer.address,
      Amount: { currency: CURRENCY, issuer: RLUSD, value: String(send.toFixed(2)) },
    });
    const res = await c.submitAndWait(inspector.sign(prepared).tx_blob);
    const ok = res.result.meta?.TransactionResult === 'tesSUCCESS';
    console.log(`float     inspector -> buyer ${send.toFixed(2)} RLUSD  ` +
      (ok ? `(${held} -> ${(held + send).toFixed(2)}, ~${Math.floor((held + send) / 0.48)} stages)`
          : `FAILED ${res.result.meta?.TransactionResult}`));
  }
}

await c.disconnect();
