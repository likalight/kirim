/**
 * Put the demo back to its opening position.
 *
 * The three acts on the Demo screen read their state from the decision logs and
 * the held-escrow file. Once a stage has released, its button says "done" and
 * the story does not tell itself any more. This clears that local state so the
 * next run starts from a clean board.
 *
 *     npm run demo:reset
 *
 * It touches nothing on the ledger. Credentials already written to the
 * builder's account stay written — they are keyed to the project and stage and
 * cannot be issued twice, which is the point of them. The track record on the
 * System screen will keep whatever it has honestly earned.
 */
import fs from 'node:fs';
import path from 'node:path';

const runs = path.resolve('docs/runs');
const files = [path.resolve('.open-escrows.json'), path.resolve('.pending-releases.json'),
  path.resolve('.paid-photos.json'), path.resolve('.reviews.json')];

let cleared = 0;
try {
  for (const f of fs.readdirSync(runs)) {
    if (!f.endsWith('.jsonl')) continue;          // leave archive-renovation/ alone
    fs.unlinkSync(path.join(runs, f));
    cleared++;
  }
} catch { /* no runs yet */ }

let dropped = 0;
for (const f of files) {
  try { fs.unlinkSync(f); dropped++; } catch { /* not there */ }
}

console.log(`[reset] cleared ${cleared} decision log(s), ${dropped} state file(s)`);
console.log('[reset] the ledger is untouched — restart the services and the board is clean:');
console.log('');
console.log('           npm run dev        then open http://localhost:4000');
console.log('');
console.log('        Run act 1 before act 2. Act 2 only catches the recycled photograph');
console.log('        if act 1 has already paid for the original.');
