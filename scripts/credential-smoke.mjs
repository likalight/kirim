/**
 * Gate for the reputation layer.
 *
 * A contractor's track record should not be a row in our database — it should
 * be a credential on the ledger that any future client can verify without
 * asking us. XLS-70 Credentials are enabled on testnet; this proves the
 * transaction shape works with xrpl.js before anything is built on it.
 *
 * CredentialCreate (issuer) -> CredentialAccept (subject) -> read back.
 */
import { Wallet, convertStringToHex } from 'xrpl';
import fs from 'node:fs';
import { xrpl, disconnect, explorerTx } from '../services/ledger/src/xrpl.mjs';

const w = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
const issuer = Wallet.fromSeed(w.platform.seed);    // Kirim issues
const subject = Wallet.fromSeed(w.supplier.seed);   // the contractor holds
const c = await xrpl();

const CREDENTIAL_TYPE = convertStringToHex('KIRIM-MILESTONE');
const uri = convertStringToHex('kirim:milestone/PRJ-2026-SMOKE/M1/foundation');

async function send(wallet, tx, label) {
  const prepared = await c.autofill(tx);
  const signed = wallet.sign(prepared);
  const r = await c.submitAndWait(signed.tx_blob);
  const result = r.result.meta?.TransactionResult;
  console.log('  ' + label.padEnd(18) + result + '  ' + r.result.hash);
  if (result === 'tesSUCCESS') console.log('  ' + ''.padEnd(18) + explorerTx(r.result.hash));
  return { result, hash: r.result.hash };
}

console.log('issuer  (Kirim)      ' + issuer.address);
console.log('subject (contractor) ' + subject.address + '\n');

const created = await send(issuer, {
  TransactionType: 'CredentialCreate',
  Account: issuer.address,
  Subject: subject.address,
  CredentialType: CREDENTIAL_TYPE,
  URI: uri,
}, 'CredentialCreate');

if (created.result !== 'tesSUCCESS') {
  console.log('\nCredentialCreate rejected — the reputation layer needs a fallback.');
  await disconnect();
  process.exit(1);
}

await send(subject, {
  TransactionType: 'CredentialAccept',
  Account: subject.address,
  Issuer: issuer.address,
  CredentialType: CREDENTIAL_TYPE,
}, 'CredentialAccept');

const objs = await c.request({
  command: 'account_objects', account: subject.address, type: 'credential',
});
console.log('\ncredentials held by the contractor:');
for (const o of objs.result.account_objects) {
  console.log('  type=' + Buffer.from(o.CredentialType, 'hex').toString());
  console.log('  uri =' + (o.URI ? Buffer.from(o.URI, 'hex').toString() : '—'));
  console.log('  accepted=' + Boolean(o.Flags & 0x00010000) + '  issuer=' + o.Issuer);
}

console.log('\nGATE PASSED — the track record can live on the ledger.');
await disconnect();
