/**
 * Put the money back on the client's side of the table.
 *
 * Every demo run moves XRP from the owner to the builder and never back, so
 * after a few rehearsals the builder's balance is larger than the owner's and
 * the screen tells the opposite of the story. This sweeps the working accounts
 * back to the owner and leaves each of the others on a small float, so a demo
 * opens with the owner holding the contract and the builder holding almost
 * nothing.
 *
 *     npm run demo:rebalance
 *
 * Testnet only, and it touches nothing the agent decides. It is the equivalent
 * of resetting the pieces on a board.
 */
import { Client, Wallet } from 'xrpl';
import fs from 'node:fs';

const KEEP = 12;        // XRP left behind: account reserve plus fees
const FROM = ['supplier', 'inspector', 'platform'];

const w = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
const c = new Client(process.env.XRPL_ENDPOINT || 'wss://s.altnet.rippletest.net:51233',
  { connectionTimeout: 20000 });
await c.connect();

const buyer = Wallet.fromSeed(w.buyer.seed);
const before = Number(await c.getXrpBalance(buyer.address));

for (const role of FROM) {
  if (!w[role]) continue;
  const from = Wallet.fromSeed(w[role].seed);
  const held = Number(await c.getXrpBalance(from.address));
  const send = Math.floor((held - KEEP) * 100) / 100;
  if (send < 1) {
    console.log(`${role.padEnd(10)} ${held.toFixed(2)} XRP — nothing to sweep`);
    continue;
  }
  const prepared = await c.autofill({
    TransactionType: 'Payment',
    Account: from.address,
    Destination: buyer.address,
    Amount: String(Math.round(send * 1_000_000)),
  });
  const res = await c.submitAndWait(from.sign(prepared).tx_blob);
  const ok = res.result.meta?.TransactionResult === 'tesSUCCESS';
  console.log(`${role.padEnd(10)} ${held.toFixed(2)} -> ${KEEP} XRP  ` +
    (ok ? `swept ${send.toFixed(2)} to the owner` : `FAILED ${res.result.meta?.TransactionResult}`));
}

const after = Number(await c.getXrpBalance(buyer.address));
console.log('');
console.log(`owner      ${before.toFixed(2)} -> ${after.toFixed(2)} XRP`);
console.log(`           enough for ${Math.floor(after / 8)} stages at 8 XRP each`);
console.log('');
console.log('The board now opens with the owner holding the money and the builder holding a float.');

await c.disconnect();
