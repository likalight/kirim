/**
 * Runs the three services together. `npm run dev`, then open the console.
 * Ledger first — market and orchestrator both call it.
 */
import { spawn } from 'node:child_process';

const SERVICES = [
  ['ledger', 'services/ledger/src/index.mjs', '36'],
  ['market', 'services/market/src/index.mjs', '35'],
  ['console', 'services/orchestrator/src/index.mjs', '32'],
];

const children = [];

function start([name, entry, colour]) {
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', entry], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const prefix = `\x1b[${colour}m${name.padEnd(8)}\x1b[0m`;
  const pipe = (stream) => stream.on('data', (d) => {
    for (const line of String(d).trimEnd().split('\n')) console.log(prefix + ' ' + line);
  });
  pipe(child.stdout); pipe(child.stderr);
  child.on('exit', (code) => console.log(prefix + ' exited with ' + code));
  children.push(child);
}

start(SERVICES[0]);
// give the ledger service a moment to connect to XRPL before the others call it
setTimeout(() => { start(SERVICES[1]); start(SERVICES[2]); }, 2500);

const stop = () => { for (const c of children) c.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
