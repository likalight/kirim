/**
 * Set the board up before anyone is watching.
 *
 * Every stage takes about a minute of real ledger time, so running all six live
 * is four minutes of loading and one minute of talking. This runs the stages
 * that are only there to make the board look like a job in progress, and leaves
 * the interesting one untouched for the live demo.
 *
 *     npm run demo:preload            runs M1, M2 and M3
 *     npm run demo:preload M1 M2      runs only those
 *
 * What it leaves on screen:
 *
 *     M1  Foundations        paid
 *     M2  Frame and floors   waiting on the owner's signature (over their limit)
 *     M3  Roof and walls     not enough evidence sent yet
 *     M4  Plumbing…          untouched — this is the one you demo
 *
 * Run `npm run demo:reset` first, and make sure the services are up.
 */
import { spawn } from 'node:child_process';

const stages = process.argv.slice(2);
const want = stages.length ? stages : ['M1', 'M2', 'M3'];

console.log(`[preload] running ${want.join(', ')} — about a minute each, nothing to watch`);

for (const id of want) {
  process.stdout.write(`[preload] ${id} … `);
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath,
      ['--env-file-if-exists=.env', 'services/orchestrator/src/cli-works.mjs', id],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    p.stdout.on('data', (b) => { tail += b.toString(); });
    p.stderr.on('data', (b) => { tail += b.toString(); });
    p.on('close', (c) => {
      const m = tail.match(/→ ([a-z_ ]+)/g);
      process.stdout.write((m ? m[m.length - 1].replace('→ ', '') : 'done') + '\n');
      if (c !== 0) console.log(tail.split('\n').slice(-6).join('\n'));
      resolve(c);
    });
  });
  if (code !== 0) {
    console.log('[preload] stopped. If it ran out of funds: npm run topup, then try again.');
    process.exit(1);
  }
}

console.log('[preload] board is set. Open http://localhost:4000 and demo the stage you left alone.');
