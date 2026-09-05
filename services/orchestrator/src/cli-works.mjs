/**
 * Milestone runner.  `npm run milestone M1`   `npm run milestone all`
 *
 * Runs milestones in order so the sequence rule and the photo-reuse check have
 * the state they need — a recycled photograph is only detectable across
 * milestones.
 */
import fs from 'node:fs';
import { runMilestone, closeProject, stageStatuses } from './works.mjs';
import { summarise } from '@kirim/works';

const project = JSON.parse(fs.readFileSync('fixtures/project.json', 'utf8'));
const arg = process.argv[2] || 'all';
const wanted = arg === 'all'
  ? project.milestones
  : project.milestones.filter((m) => m.id === arg);

if (!wanted.length) {
  console.error('No such milestone: ' + arg);
  for (const m of project.milestones) console.error('  ' + m.id + '  ' + m.name + ' — ' + m.scenario);
  process.exit(1);
}

const W = 78;
const rule = (c) => c.repeat(W);
const colour = {
  milestone: '36', escrow: '34', submission: '36', discovery: '36',
  purchase: '35', examination: '33', settlement: '32', record: '32',
};

async function trackRecord() {
  const r = await fetch('http://localhost:' + (process.env.LEDGER_PORT || 4010) + '/credentials?role=supplier')
    .then((x) => x.json());
  return { ...summarise(r.credentials), address: r.address };
}

const before = await trackRecord();
console.log('\n' + rule('='));
console.log('  ' + project.name + '  —  ' + project.client + ' / ' + project.contractor);
console.log('  site: ' + project.site.address);
console.log(rule('='));
console.log('  track record before: ' + before.milestonesCompleted + ' milestones on-ledger  (' + before.address + ')');
console.log(rule('=') + '\n');

const seenPhotoHashes = new Set();
const priorReleased = [];
const hashes = [];
const outcomes = [];

for (const m of wanted) {
  console.log(rule('-'));
  console.log('  ' + m.id + '  ' + m.name);
  console.log('  scenario: ' + m.scenario);
  console.log(rule('-') + '\n');

  const { outcome } = await runMilestone(project, m, {
    seenPhotoHashes, priorReleased,
    emit: (e) => {
      console.log(`\x1b[${colour[e.stage] || '37'}m${e.stage.toUpperCase().padEnd(13)}\x1b[0m ${e.decision.replace(/_/g, ' ')}`);
      for (const line of wrap(e.reason, W - 14)) console.log('              ' + line);
      if (e.txHash) {
        console.log('              \x1b[90m' + e.explorer + '\x1b[0m');
        hashes.push({ milestone: m.id, stage: e.stage, hash: e.txHash, explorer: e.explorer });
      }
      console.log();
    },
  });

  if (outcome === 'released') priorReleased.push(m.id);
  outcomes.push({ id: m.id, name: m.name, outcome });
  console.log('  → ' + outcome.replace(/_/g, ' ') + '\n');
}

// The job closes wherever the last stage happened to be run, not only from the
// console. A milestone product that never ends is a to-do list.
await closeProject(project, stageStatuses(), {
  emit: (e) => {
    console.log(`[36m${e.stage.toUpperCase().padEnd(13)}[0m ${e.decision.replace(/_/g, ' ')}`);
    for (const line of wrap(e.reason, W - 14)) console.log('              ' + line);
    if (e.txHash) console.log('              [90m' + e.explorer + '[0m');
    console.log();
  },
}).catch((e) => console.error('[close] ' + e.message));

const after = await trackRecord();
console.log(rule('='));
for (const o of outcomes) console.log('  ' + o.id.padEnd(4) + o.name.padEnd(38) + o.outcome.replace(/_/g, ' '));
console.log(rule('-'));
console.log('  track record: ' + before.milestonesCompleted + ' → ' + after.milestonesCompleted +
  ' milestones on-ledger' + (after.onTimeRate != null ? ', ' + after.onTimeRate + '% on time' : ''));
console.log('  ' + hashes.length + ' XRPL transactions this run');
console.log(rule('=') + '\n');

for (const h of hashes) console.log('| ' + h.milestone + ' | ' + h.stage + ' | ' + h.hash + ' |');

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
