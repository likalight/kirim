/**
 * THE GATE. Hour zero, step four.
 *
 * Escrow create, escrow finish against a crypto-condition, and escrow cancel
 * after timeout. All three, before any product code is trusted. A CancelAfter
 * you first test at hour thirty is a lost demo.
 *
 * Every hash printed here belongs in docs/transactions.md.
 */
import { Wallet } from 'xrpl';
import fs from 'node:fs';
import {
  xrpl, disconnect, settlementAsset, escrowCreate, escrowFinish, escrowCancel, balances,
} from '../services/ledger/src/xrpl.mjs';

const w = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
const buyer = Wallet.fromSeed(w.buyer.seed);
const supplier = Wallet.fromSeed(w.supplier.seed);
const platform = Wallet.fromSeed(w.platform.seed);
const asset = settlementAsset();
const AMOUNT = typeof asset === 'object' ? '10' : '2';
const label = typeof asset === 'object' ? 'RLUSD (TokenEscrow)' : 'XRP';

const hashes = [];
const record = (what, r) => {
  hashes.push({ what, hash: r.hash, explorer: r.explorer });
  console.log('  ' + what.padEnd(28) + r.hash);
  console.log('  ' + ''.padEnd(28) + r.explorer);
};

await xrpl();
console.log('settlement asset: ' + label + '\n');

// ---- 1. the happy path: create, then release against the fulfillment --------
console.log('1. create escrow  ' + AMOUNT + ' ' + label);
const created = await escrowCreate({
  wallet: buyer, to: supplier.address, value: AMOUNT, asset,
  memo: 'SMOKE-1', cancelAfterSeconds: 600, finishAfterSeconds: 2,
});
record('EscrowCreate', created);

console.log('\n2. finish escrow (platform holds the fulfillment)');
await new Promise((r) => setTimeout(r, 5000)); // FinishAfter must have passed
const finished = await escrowFinish({
  wallet: platform, owner: buyer.address,
  offerSequence: created.offerSequence,
  condition: created.condition, fulfillment: created.fulfillment,
});
record('EscrowFinish', finished);

// ---- 2. the unhappy path: nobody performs, funds return --------------------
console.log('\n3. create a second escrow with a 25s CancelAfter');
const doomed = await escrowCreate({
  wallet: buyer, to: supplier.address, value: AMOUNT, asset,
  memo: 'SMOKE-2-TIMEOUT', cancelAfterSeconds: 25, finishAfterSeconds: 2,
});
record('EscrowCreate (to expire)', doomed);

console.log('\n4. waiting out the CancelAfter, then clawing the funds back');
await new Promise((r) => setTimeout(r, 30000));
const cancelled = await escrowCancel({
  wallet: platform, owner: buyer.address, offerSequence: doomed.offerSequence,
});
record('EscrowCancel', cancelled);

console.log('\nbuyer balances after:');
console.log(await balances(buyer.address));

fs.writeFileSync('docs/smoke-hashes.json', JSON.stringify(hashes, null, 2));
console.log('\nGATE PASSED — create, finish and cancel all work on ' + label + '.');
console.log('Hashes written to docs/smoke-hashes.json. Paste them into docs/transactions.md.');
await disconnect();
