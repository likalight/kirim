/**
 * Terminal runner. `npm run trade PO-2026-0418`
 *
 * Same agent, same ledger, no browser — this is what you use at 3am when the
 * console is half-built, and what a judge runs from the README.
 */
import fs from 'node:fs';
import { runTrade } from './agent.mjs';

const TRADES = JSON.parse(fs.readFileSync('fixtures/trades.json', 'utf8'));
const id = process.argv[2] || TRADES[0].id;
const trade = TRADES.find((t) => t.id === id);

if (!trade) {
  console.error('No such trade: ' + id);
  console.error('Available:');
  for (const t of TRADES) console.error('  ' + t.id + '  ' + t.label);
  process.exit(1);
}

const width = 78;
const rule = (c) => c.repeat(width);
const stageColour = {
  need: '36', discovery: '36', purchase: '35', underwriting: '33',
  escrow: '34', presentation: '36', examination: '33', settlement: '32',
  fx: '35', outcome: '32',
};

console.log('\n' + rule('='));
console.log('  ' + trade.id + '  ' + trade.label);
console.log(rule('=') + '\n');

const hashes = [];

const { outcome } = await runTrade(trade, {
  emit: (e) => {
    const colour = stageColour[e.stage] || '37';
    console.log(`\x1b[${colour}m${e.stage.toUpperCase().padEnd(13)}\x1b[0m ${e.decision}`);
    for (const line of wrap(e.reason, width - 14)) console.log('              ' + line);
    if (e.txHash) {
      console.log('              \x1b[90m' + e.explorer + '\x1b[0m');
      hashes.push({ stage: e.stage, decision: e.decision, hash: e.txHash, explorer: e.explorer });
    }
    console.log();
  },
});

console.log(rule('-'));
console.log('  outcome: ' + outcome);
if (hashes.length) {
  console.log('  ' + hashes.length + ' XRPL transactions — append these to docs/transactions.md:\n');
  for (const h of hashes) console.log('  | ' + trade.id + ' | ' + h.stage + ' | ' + h.hash + ' | ' + h.explorer + ' |');
}
console.log(rule('-') + '\n');

function wrap(text, w) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > w) { lines.push(line.trim()); line = word; }
    else line += ' ' + word;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

process.exit(0);
