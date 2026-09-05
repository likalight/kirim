/**
 * Sign a client release authorisation.  `npm run authorise M5`
 *
 * This is what Crossmark or GemWallet does in the console — an ordinary XRPL
 * Payment from the client's own account to Kirim, carrying a memo that names
 * one milestone. Nothing here is privileged: the same transaction sent from
 * any wallet authorises the same release, and Kirim verifies it on the ledger
 * before a cent moves.
 *
 * Keep it for demo day. A judge's laptop may not have a wallet extension, and
 * "the signature never happened" is a bad thing to discover on stage.
 */
import { Client, Wallet, xrpToDrops, convertStringToHex } from 'xrpl';
import fs from 'node:fs';

const CONSOLE = 'http://localhost:' + (process.env.ORCHESTRATOR_PORT || 4000);
const want = process.argv[2];

const { pending } = await fetch(CONSOLE + '/api/pending').then((r) => r.json());
if (!pending.length) {
  console.error('Nothing is waiting on a client signature.');
  process.exit(1);
}
const item = want ? pending.find((p) => p.milestone === want) : pending[0];
if (!item) {
  console.error('No pending authorisation for ' + want);
  for (const p of pending) console.error('  ' + p.milestone + '  ' + p.name);
  process.exit(1);
}

const a = item.authorisation;
console.log('\nAuthorising ' + item.milestone + ' — ' + item.name);
console.log('  from   ' + a.from);
console.log('  to     ' + a.to);
console.log('  memo   ' + a.memo + '\n');

const wallets = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
const client = Wallet.fromSeed(wallets.buyer.seed);
if (client.address !== a.from) {
  console.error('The client wallet in wallets.json is not the account this release expects.');
  process.exit(1);
}

const c = new Client(process.env.XRPL_ENDPOINT || 'wss://s.altnet.rippletest.net:51233',
  { connectionTimeout: 20000 });
await c.connect();

const prepared = await c.autofill({
  TransactionType: 'Payment',
  Account: client.address,
  Destination: a.to,
  Amount: xrpToDrops(a.amountXrp),
  Memos: [{
    Memo: {
      MemoType: convertStringToHex('kirim/authorise'),
      MemoData: convertStringToHex(a.memo),
    },
  }],
});
const signed = client.sign(prepared);
const submitted = await c.submitAndWait(signed.tx_blob);
const result = submitted.result.meta?.TransactionResult;
const hash = submitted.result.hash;

console.log('  signature ' + result + '  ' + hash);
console.log('  ' + (process.env.XRPL_EXPLORER || 'https://testnet.xrpl.org') + '/transactions/' + hash);
await c.disconnect();

if (result !== 'tesSUCCESS') process.exit(1);

const res = await fetch(CONSOLE + '/api/authorise?key=' + encodeURIComponent(item.key), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ txHash: hash }),
});
console.log('\n  submitted to Kirim: ' + res.status + ' ' + JSON.stringify(await res.json()));
console.log('  watch the console at ' + CONSOLE + ' for the release.\n');
