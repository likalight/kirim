/**
 * Top the demo wallets back up from the XRPL testnet faucet.
 *
 * Every escrow locks XRP and every release sends it to the contractor, so the
 * client wallet drains across repeated demo runs. Run this before a rehearsal;
 * a demo that dies on tecUNFUNDED in front of judges is an avoidable way to lose.
 */
import { Client, Wallet } from 'xrpl';
import fs from 'node:fs';

const roles = process.argv.slice(2);
const want = roles.length ? roles : ['buyer'];
const w = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
const c = new Client(process.env.XRPL_ENDPOINT || 'wss://s.altnet.rippletest.net:51233');
await c.connect();

for (const role of want) {
  if (!w[role]) { console.log(role + ': no such wallet'); continue; }
  const wallet = Wallet.fromSeed(w[role].seed);
  const before = await c.getXrpBalance(wallet.address);
  await c.fundWallet(wallet);
  const after = await c.getXrpBalance(wallet.address);
  console.log(role.padEnd(10) + before + ' -> ' + after + ' XRP  (' + wallet.address + ')');
}
await c.disconnect();
