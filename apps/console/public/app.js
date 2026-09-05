/**
 * KIRIM console.
 *
 * Seven modules over one live event stream. Two people use this — the client
 * whose money is escrowed and the contractor waiting to be paid — so the same
 * data is worded differently depending on who is looking.
 */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cur = () => state.project?.currency || 'US$';
const money = (c) => cur() + (c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
const money2 = (c) => cur() + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The two sides are named by the project, not by this file. A renovation has a
// client and a contractor; a pre-sale apartment has a buyer and a developer.
// One point of view: the owner's. A demo that asks somebody to first pick who
// they are has spent its opening on a question nobody came to answer.
const THEM = () => state.project?.contractorRole || 'the builder';

const state = {
  view: 'milestones',
  project: null,
  milestones: {},
  record: null,
  pending: [],
  providers: [],
  wallets: null,
  wallets0: null,
  held: [],
  projectState: null,
  lastRun: null,
  // Set when you arrive from a stage; cleared when you pick a tab yourself.
  // One stage in view, or all of them.
  focus: null,
  evidence: null,
  reviews: [],
  reasoner: null,
  running: null,
  stage: null,
  feed: [],
};

/**
 * The decision log in words rather than codes.
 *
 * Every line the agent writes already carries a full sentence of reasoning.
 * What it did not carry was a headline anyone could read — `PURCHASE bought`
 * and `SETTLEMENT withheld` are fine in a JSONL file and hopeless on a screen
 * somebody is seeing for the first time.
 */
const LOG_WORDS = {
  'milestone/opened': 'Stage opened',
  'milestone/reopened': 'Stage reopened',
  'escrow/funded': 'Money locked',
  'escrow/reused': 'Same money, still locked',
  'escrow/note': 'About the amounts',
  'escrow/refused': 'Refused to lock the money',
  'submission/received': 'Evidence received',
  'submission/resubmitted': 'New evidence received',
  'submission/none': 'Nothing was sent',
  'discovery/surveyed': 'Looked for checkers',
  'planning/planned': 'Decided what to check',
  'purchase/bought': 'Bought a check',
  'purchase/declined': 'Turned a check down',
  'examination/ready': 'Verdict — everything checks out',
  'examination/flagged': 'Verdict — rejected',
  'examination/more_info': 'Verdict — not enough sent yet',
  'settlement/released': 'Money released',
  'settlement/withheld': 'Money stays locked',
  'settlement/held': 'Money stays locked',
  'settlement/returned': 'Money returned to the owner',
  'settlement/awaiting_client': 'Waiting for the owner to sign',
  'authorisation/verified': 'The owner signed',
  'review/requested': 'Asked the owner to confirm',
  'review/confirmed': 'The owner agreed with the refusal',
  'rework/requested': 'Sent back to the builder',
  'rework/accepted': 'The builder put it right',
  'revenue/charged': 'Our fee',
  'revenue/uncollected': 'Our fee could not be taken',
  'record/credentialed': "Written to the builder's record",
  'record/already_recorded': 'Already on the builder\u2019s record',
  'project/closing': 'Closing the job',
  'project/closed': 'Job closed',
  'project/already_closed': 'Job already closed',
  'outcome/complete': 'Done',
};

const logWords = (e) => LOG_WORDS[e.stage + '/' + e.decision]
  || LOG_WORDS[e.stage + '/' + e.decision.replace(/_/g, '')]
  || (e.stage.charAt(0).toUpperCase() + e.stage.slice(1) + ' — ' + e.decision.replace(/_/g, ' '));

const STATUS_WORDS = {
  released: 'paid', flagged: 'rejected', more_info: 'not enough sent',
  awaiting_client: 'needs your signature', returned: 'refunded',
  in_progress: 'running', unknown: 'not started',
};

// The pipeline every milestone walks. The console lights these as the agent
// moves, which is the clearest way to show an autonomous process to someone
// who has never seen one.
const PIPELINE = [
  { key: 'milestone', label: 'Agreed', hint: 'scope, amount, date' },
  { key: 'escrow', label: 'Escrowed', hint: 'locked on XRPL' },
  { key: 'submission', label: 'Submitted', hint: 'evidence presented' },
  { key: 'planning', label: 'Planned', hint: 'what to verify' },
  { key: 'purchase', label: 'Verified', hint: 'checks bought over MPP' },
  { key: 'examination', label: 'Examined', hint: 'against agreed scope' },
  { key: 'settlement', label: 'Settled', hint: 'released, held or returned' },
  { key: 'record', label: 'Recorded', hint: 'credential on-ledger' },
];

const ICONS = {
  demo: 'M3 2 l10 6 l-10 6 z',
  milestones: 'M2 3 h12 M2 8 h12 M2 13 h7',
  evidence: 'M2 4 h12 v9 H2 z M5 4 l1-2 h4 l1 2 M8 11 a2.2 2.2 0 1 0 0-4.4 a2.2 2.2 0 0 0 0 4.4',
  system: 'M8 5.2 a2.8 2.8 0 1 0 0 5.6 a2.8 2.8 0 0 0 0-5.6 M8 1.5 v2 M8 12.5 v2 M1.5 8 h2 M12.5 8 h2',
};

const VIEWS = [
  ['milestones', 'Milestones', 'the job, stage by stage'],
  ['demo', 'Demo', 'watch the money move'],
  ['evidence', 'Evidence', 'what was asked for, what arrived'],
  ['system', 'How it is built', 'wallets, limits, transactions'],
];

// ---------------------------------------------------------------- data
async function load() {
  const [project, st, record, pending, providers, wallets, reasoner, held, rv] = await Promise.all([
    fetch('/api/project').then((r) => r.json()),
    fetch('/api/state').then((r) => r.json()).catch(() => ({ milestones: {} })),
    fetch('/api/record').then((r) => r.json()).catch(() => null),
    fetch('/api/pending').then((r) => r.json()).catch(() => ({ pending: [] })),
    fetch('/api/providers').then((r) => r.json()).catch(() => ({ providers: [] })),
    fetch('/api/wallets').then((r) => r.json()).catch(() => null),
    fetch('/api/reasoner').then((r) => r.json()).catch(() => null),
    fetch('/api/held').then((r) => r.json()).catch(() => ({ held: [] })),
    fetch('/api/reviews').then((r) => r.json()).catch(() => ({ reviews: [] })),
  ]);
  Object.assign(state, {
    project, milestones: st.milestones || {}, record,
    pending: pending.pending || [], providers: providers.providers || [],
    wallets, reasoner, held: held.held || [],
    projectState: st.project || null, reviews: rv.reviews || [],
  });
  render();
}

function totals() {
  let paid = 0, held = 0, committed = 0, fees = 0, evidence = 0, tx = 0;
  for (const m of state.project.milestones) {
    const s = state.milestones[m.id];
    if (!s) continue;
    evidence += s.spentCents || 0;
    tx += (s.hashes || []).length;
    if (s.status === 'released') {
      paid += m.amountCents;
      if (s.feeUsd) fees += Math.round(Number(s.feeUsd) * 100);
    } else if (['flagged', 'more_info', 'awaiting_client'].includes(s.status)) held += m.amountCents;
    if (s.status !== 'unknown' && s.status !== 'returned') committed += m.amountCents;
  }
  return { paid, held, committed, fees, evidence, tx };
}

// ---------------------------------------------------------------- shell
function renderNav() {
  $('nav-list').innerHTML = VIEWS.map(([k, label, hint]) => `
    <li><button data-view="${k}" aria-current="${state.view === k}">
      <svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor"
           stroke-width="1.3" stroke-linecap="square"><path d="${ICONS[k]}"/></svg>
      <span class="lab">${label}<span class="hint">${hint}</span></span></button></li>`).join('');
  for (const b of document.querySelectorAll('[data-view]')) {
    b.onclick = () => {
      // Choosing a tab means "show me everything"; only arriving from a stage
      // narrows the view to that stage.
      if (b.dataset.view !== 'evidence') state.focus = null;
      state.view = b.dataset.view;
      render();
      if (b.dataset.view === 'evidence') loadEvidence();
    };
  }

}

function head(title, sub, meta) {
  return `<div class="head"><div><h2>${esc(title)}</h2>
    <div class="sub">${sub}</div></div>
    <div class="meta">${meta || ''}</div></div>`;
}

function render() {
  renderNav();
  const fn = {
    milestones: viewMilestones, demo: viewDemo, evidence: viewEvidence, system: viewSystem,
  }[state.view] || viewMilestones;
  $('main').innerHTML = fn();
  wire();
}

// ---------------------------------------------------------------- pipeline
function pipelineHtml() {
  const s = state.stage;
  const seen = state.feed.map((e) => e.stage);
  const idx = (k) => PIPELINE.findIndex((p) => p.key === k);
  const cur = s ? idx(s) : -1;

  return `<div class="flow"><div class="track">` + PIPELINE.map((p, i) => {
    let cls = '';
    if (state.running) {
      if (i < cur) cls = 'done';
      else if (i === cur) cls = 'active';
    } else if (seen.includes(p.key)) cls = 'done';

    const last = state.feed.filter((e) => e.stage === p.key).slice(-1)[0];
    if (last && ['flagged', 'withheld', 'unverified', 'refused'].includes(last.decision)) cls = 'blocked';
    if (last && ['more_info', 'held', 'awaiting_client'].includes(last.decision)) cls = 'wait';

    return `<div class="node ${cls}"><div class="bar"></div><div class="dot"></div>
      <div class="lbl">${p.label}</div>
      <div class="val">${esc(last ? last.decision.replace(/_/g, ' ') : p.hint)}</div></div>`;
  }).join('') + `</div></div>`;
}

// ---------------------------------------------------------------- views

/**
 * The argument, in one screen. The left lane is the mainland pre-sale model as
 * it runs today; the right lane is the same sale with Kirim between the bank
 * and the developer. Only the steps that actually change are marked — claiming
 * to change the parts that work would make the rest less believable.
 */
/**
 * Three screens, in the order a stranger needs them.
 *
 *   Demo       what this is, the building, and the money moving while you watch
 *   Milestones every stage, and why each one passed or failed
 *   System     the wallets, the providers, the limits, the proof
 *
 * There were eight. Everything the other five held is still here, folded into
 * the screen it belonged to. Somebody seeing this for the first time should not
 * have to learn a navigation bar before they can see what the product does.
 */
/**
 * The refusal put in front of the person whose money it is.
 *
 * They are not being asked to approve a payment — the agent has already decided
 * not to make one. They are being asked whether they agree, which is the
 * decision an owner actually wants and the one an agent should never take
 * alone in front of a counterparty.
 */
function reviewHtml() {
  const waiting = state.reviews.filter((r) => r.state === 'waiting'
    && (!state.focus || r.milestone === state.focus));
  if (!waiting.length) return '';

  return waiting.map((r) => `<div class="review">
    <div class="rh">The agent is refusing to pay this — do you agree?</div>
    <h4>${esc(r.name)} · ${money(r.amountCents)}</h4>
    <p>${esc(state.project.contractor)} claimed this stage was finished. The agent found
      ${r.findings.length} thing${r.findings.length === 1 ? '' : 's'} wrong with the claim and will
      not release your money. Nothing has moved. Read the reasons and confirm.</p>
    <ol class="rf">${r.findings.map((f) => `<li>${esc(f.text)}<span>${esc(f.code)}</span></li>`).join('')}</ol>
    <button class="btn" data-confirm="${esc(r.key)}">I agree — do not pay this</button>
    <p class="rn">Confirming does not move any money; it records that you and the agent reached the
      same conclusion. ${esc(state.project.contractor)} keeps the right to fix the work and send new
      evidence, and the money stays locked either way.</p>
  </div>`).join('');
}

/**
 * One stage, or all of them.
 *
 * Arriving from the stage list narrows this to a single stage — its own money,
 * its own evidence, its own verdict. Choosing the Demo tab shows the whole job.
 */
function stageCardHtml(m) {
  const st = state.milestones[m.id] || { status: 'unknown' };
  const held = state.held.some((h) => h.milestone === m.id);
  const ran = st.status && st.status !== 'unknown';
  const label = held ? 'Send corrected evidence'
    : ran ? 'Run it again'
      : m.noSubmission ? 'Wait for the deadline' : 'Submit the evidence';

  return `<div class="stagehead">
    <div><div class="lbl">Stage ${m.id.slice(1)} of ${state.project.milestones.length}</div>
      <h3>${esc(m.name)}</h3>
      <p>${esc(m.plain || '')}</p></div>
    <div class="right">
      <div class="amt">${money(m.amountCents)}</div>
      <button class="btn" data-run="${m.id}" ${state.running ? 'disabled' : ''}>
        ${state.running === m.id ? 'Running…' : esc(label)}</button>
    </div>
  </div>
  <p class="cap">${esc(held ? (m.reworkScenario || '') : (m.scenario || ''))}</p>`;
}

function walletCard(role, label, sub) {
  const w = (state.wallets?.wallets ?? []).find((x) => x.role === role);
  const before = (state.wallets0?.wallets ?? []).find((x) => x.role === role);
  const now = w?.xrp != null ? Number(w.xrp) : null;
  const was = before?.xrp != null ? Number(before.xrp) : null;
  const d = now != null && was != null ? now - was : 0;
  const moved = Math.abs(d) > 0.000001;

  return `<div class="wc ${moved ? (d > 0 ? 'up' : 'down') : ''}">
    <div class="lbl">${esc(label)}</div>
    <div class="bal">${now != null ? now.toFixed(2) : '—'}<span class="ccy">XRP</span></div>
    ${moved ? `<div class="delta">${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}</div>`
      : `<div class="sub">${esc(sub)}</div>`}
    ${w ? `<a class="addr" href="https://testnet.xrpl.org/accounts/${esc(w.address)}"
      target="_blank" rel="noopener">${esc(w.address.slice(0, 14))}… ↗</a>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- the model
/**
 * The building both sides agreed to, drawn as a cutaway.
 *
 * This is the point of the model: a stage is a defined piece of a thing both
 * parties signed, so "done" is measured rather than argued about. Each band
 * takes its state from the agent's actual decision, so the drawing is a view of
 * the ledger and not an illustration of it.
 */
const BAND_STATE = {
  released: { fill: 'built', mark: '✓', say: 'verified and paid' },
  awaiting_client: { fill: 'part', mark: '!', say: 'checked out — waiting on her signature' },
  flagged: { fill: 'bad', mark: '✗', say: 'evidence did not add up' },
  more_info: { fill: 'part', mark: '…', say: 'waiting on more evidence' },
  in_progress: { fill: 'part', mark: '•', say: 'being checked now' },
  returned: { fill: 'none', mark: '○', say: 'never built — money returned' },
  unknown: { fill: 'none', mark: '', say: 'not started' },
};

function elevationHtml() {
  const model = state.project.model;
  if (!model) return '';
  const byId = new Map(state.project.milestones.map((m) => [m.id, m]));

  const bands = model.bands;
  const units = bands.reduce((a, b) => a + b.height, 0);
  const W = 300, H = 320, GROUND = 292, TOP = 16;
  const per = (GROUND - TOP) / units;

  let y = GROUND;
  const rows = [];
  for (const b of bands) {                        // drawn bottom-up
    const h = b.height * per;
    y -= h;
    rows.push({ b, y, h });
  }

  const draw = ({ b, y, h }) => {
    const m = byId.get(b.id);
    const st = state.milestones[b.id]?.status || 'unknown';
    const k = BAND_STATE[st] || BAND_STATE.unknown;
    const live = state.running === b.id;
    const mid = y + h / 2;
    return `<g class="band ${k.fill} ${live ? 'live' : ''} ${b.hers ? 'hers' : ''}" data-stage="${b.id}">
      <rect x="20" y="${y.toFixed(1)}" width="152" height="${(h - 2).toFixed(1)}"/>
      <text class="bl" x="29" y="${(mid + 3.6).toFixed(1)}">${b.id.slice(1)} ${esc(b.label)}</text>
      <text class="bm" x="164" y="${(mid + 4).toFixed(1)}">${k.mark}</text>
      <text class="bt" x="182" y="${(mid + 1).toFixed(1)}">${m ? money(m.amountCents) : ''}</text>
      <text class="bs" x="182" y="${(mid + 10).toFixed(1)}">${esc(k.say)}</text>
      ${b.hers ? `<text class="bh" x="182" y="${(mid - 8).toFixed(1)}">her floor</text>` : ''}
      <title>${esc(m ? m.name : b.label)} — ${esc(k.say)}</title>
    </g>`;
  };

  return `<div class="model">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="The agreed tower, stage by stage">
      <line class="ground" x1="8" y1="${GROUND + 3}" x2="176" y2="${GROUND + 3}"/>
      ${rows.map(draw).join('')}
    </svg>
    <div class="mcap"><strong>${esc(model.ref)}</strong>
      <span>${model.storeys} storeys · ${model.units} units · agreed ${esc(model.agreedOn)}</span></div>
  </div>`;
}

/**
 * The survey against the model, element by element.
 *
 * This is the centre of the whole product. "72% complete" is worth nothing if
 * it arrives as an assertion; it is worth a great deal when you can see the
 * four rows it was added up from and point at the two that are short.
 */
function reconcileHtml(model) {
  if (!model?.rows?.length) return '';
  return `<table class="recon">
    <tr><th>Element of the agreed model</th><th class="num">agreed</th><th class="num">found</th>
      <th>evidence</th></tr>` +
    model.rows.map((r) => `<tr class="${r.short > 0 ? 'short' : ''}">
      <td>${esc(r.label)}</td>
      <td class="num">${r.agreed}</td>
      <td class="num"><strong>${r.found}</strong></td>
      <td class="mono">${r.photos.length ? esc(r.photos.join(', ')) : '<span class="none">no photograph</span>'}</td>
    </tr>`).join('') +
    `<tr class="tot"><td>${model.found} of ${model.agreed} elements built</td>
      <td class="num"></td><td class="num"><strong>${model.percent}%</strong></td>
      <td>of the agreed scope</td></tr></table>`;
}

// ---------------------------------------------------------------- the checks
/**
 * Four questions instead of thirteen rule codes.
 *
 * Every rule the engine runs answers one of these, and the engine now says
 * which. A person watching wants to know what was asked and what came back —
 * the codes are for the audit trail, which is one click away.
 */
function questionsHtml() {
  const id = state.running || state.lastRun;
  const st = id ? state.milestones[id] : null;
  const qs = st?.questions;
  const ms = state.project.milestones.find((m) => m.id === id);
  if (!id || !ms) return '';

  const ANSWER = {
    clear: { mark: '✓', word: 'yes', cls: 'ok' },
    advisory: { mark: '✓', word: 'yes, with a note', cls: 'ok' },
    missing: { mark: '?', word: 'cannot tell yet', cls: 'wait' },
    blocking: { mark: '✗', word: 'no', cls: 'bad' },
  };

  const body = qs ? qs.map((q) => {
    const a = ANSWER[q.answer] || ANSWER.clear;
    return `<div class="q ${a.cls}">
      <span class="qn">${q.n}</span>
      <div class="qb">
        <div class="qa">${esc(q.ask)}</div>
        ${q.findings.length
          ? q.findings.map((f) => `<div class="qf">${esc(f.text)}</div>`).join('')
          : `<div class="qd">${esc(q.detail)}</div>`}
      </div>
      <span class="qm">${a.mark} ${a.word}</span>
    </div>`;
  }).join('') : `<div class="empty">Checking…</div>`;

  const outcome = st && !state.running ? {
    released: ['ok', `Released. ${money(ms.amountCents)} paid to ${state.project.contractor}.`],
    flagged: ['bad', `Held. ${money(ms.amountCents)} stays locked, and ${state.project.contractor} has been told exactly what to fix.`],
    more_info: ['wait', `Held. Nothing is wrong — the submission is just incomplete, and nothing is marked against ${state.project.contractor}.`],
    awaiting_client: ['wait', `Everything checks out, but this is above the limit ${state.project.client} set. It waits for her signature.`],
    returned: ['bad', `Nothing was ever presented. ${money(ms.amountCents)} went back to ${state.project.client} on its own.`],
  }[st.status] : null;

  return (st?.model ? `<h3 class="sec">What was agreed, and what is actually there</h3>`
      + reconcileHtml(st.model) : '')
    + `<h3 class="sec">What the agent asked about ${esc(ms.name)}</h3>
    <div class="quest">${body}
      ${outcome ? `<div class="verdict ${outcome[0]}">${esc(outcome[1])}</div>` : ''}
    </div>`;
}

// ---------------------------------------------------------------- her inbox
/**
 * She is told what happened, every time — she is simply not asked to approve
 * it. Being in the loop and being a bottleneck are different things, and only
 * one of them is worth a person's afternoon.
 */
function notificationsHtml() {
  const out = [];
  for (const m of state.project.milestones) {
    const st = state.milestones[m.id];
    if (!st) continue;
    const line = {
      released: `${m.name} was verified and paid. ${money(m.amountCents)} released.`,
      flagged: `${m.name} was rejected. Your ${money(m.amountCents)} is still locked, and ${state.project.contractor} has been asked to put it right.`,
      more_info: `${m.name} is waiting on more evidence from ${state.project.contractor}. Nothing is wrong.`,
      awaiting_client: `${m.name} checked out, but it is above the limit you set. It needs your signature.`,
      returned: `${m.name} was never presented. Your ${money(m.amountCents)} came back automatically.`,
    }[st.status];
    if (line) out.push({ at: st.at, line, status: st.status, id: m.id });
  }
  if (!out.length) return '';
  out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const show = out.slice(0, 4);
  return `<div class="inbox"><div class="ihead">What you have been told</div>` +
    show.map((n) => `<div class="i ${n.status}"><span class="id">${n.id}</span>
      <span>${esc(n.line)}</span></div>`).join('') +
    (out.length > show.length ? `<div class="imore">${out.length - show.length} earlier</div>` : '') +
    `</div>`;
}

function closedHtml() {
  const p = state.projectState;
  if (!p?.closed) return '';
  return `<div class="closed">
    <div class="ch">Project closed</div>
    <p>Every stage of ${esc(state.project.name)} has come to rest.
      <strong>${money(p.paidCents)}</strong> was released against evidence, and
      <strong>${money(p.returnedCents)}</strong> went back to ${esc(state.project.client)}
      because the work was never presented. The completed project is written to
      ${esc(state.project.contractor)}'s own XRPL account.</p>
  </div>`;
}

function viewDemo() {
  const p = state.project;
  const focused = state.focus ? p.milestones.find((m) => m.id === state.focus) : null;
  const lockedCents = state.held.reduce((a, h) => a + (h.amountCents || 0), 0);

  const head1 = focused
    ? `<div class="crumb"><button data-view="milestones">← all stages</button></div>`
      + stageCardHtml(focused)
    : `<div class="explain">
        <h2>Watch the money move.</h2>
        <p class="big">${esc(p.client)} is paying ${esc(p.contractor)} ${money(p.totalCents)} to
          build ${esc(p.what || 'a building')} in ${esc(p.site.address.split(',').slice(-1)[0].trim())}.
          Every figure below is live on the XRP Ledger — click a name and check it yourself.</p>
      </div>`;

  return head1
    + closedHtml()
    + reviewHtml()
    + `<h3 class="sec">${focused ? 'The money for this stage' : 'The money'}</h3>`
    + `<div class="wallets">
        ${walletCard('buyer', p.client, 'the owner — pays for the building')}
        <div class="wc lock"><div class="lbl">Locked, going nowhere</div>
          <div class="bal">${(lockedCents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}<span class="ccy">${esc(cur())}</span></div>
          <div class="sub">${state.held.length
            ? state.held.length + ' stage(s) held back'
            : 'nothing held right now'}</div>
          <div class="addr">nobody can move this — not them, not us</div></div>
        ${walletCard('supplier', p.contractor, 'the builder — paid when a stage checks out')}
      </div>`
    + `<p class="cap">Click either name to check the balance on the public explorer.</p>`
    + (state.pending.length ? actionHtml() : '')
    + (focused ? '' : `<h3 class="sec">Every stage</h3>` + milestoneListHtml())
    + `<h3 class="sec">What the agent did${state.running ? ' — running now' : ''}</h3>`
    + pipelineHtml()
    + questionsHtml()
    + `<details class="rawlog"${state.running ? ' open' : ''}>
        <summary>Every step the agent took, with the transaction hashes</summary>
        <div class="feed" id="feed">${feedHtml()}</div>
      </details>`;
}

function milestoneListHtml() {
  const heldIds = new Set(state.held.map((h) => h.milestone));
  const inReview = new Set(state.reviews.filter((r) => r.state === 'waiting').map((r) => r.milestone));

  return state.project.milestones.map((m) => {
    const st = state.milestones[m.id] || { status: 'unknown' };
    const canRedo = heldIds.has(m.id);
    const line = {
      released: 'Checked and paid.',
      flagged: 'Rejected. The money is still locked.',
      more_info: 'Waiting on more from the builder. Nothing is wrong.',
      awaiting_client: 'Everything checks out — but it is over the limit, so it needs a signature.',
      returned: 'Never delivered. The money came back on its own.',
    }[st.status] || m.plain || '';

    return `<button class="ms ${st.status}" data-open="${m.id}">
      <span class="bar"></span>
      <span class="body"><span class="top"><span class="id">${m.id.slice(1)}</span>
        <span class="nm">${esc(m.name)}</span></span>
        <div class="sc">${esc(line)}</div>
        ${inReview.has(m.id) ? '<div class="redo">needs you to confirm the refusal</div>'
          : canRedo ? '<div class="redo">money still locked — the builder can send corrected evidence</div>' : ''}</span>
      <span class="right"><div class="amt">${money(m.amountCents)}</div>
        <div class="pill ${st.status}">${esc(STATUS_WORDS[st.status] || st.status)}</div></span>
    </button>`;
  }).join('');
}

function viewMilestones() {
  const p = state.project;
  const ps = state.projectState;
  const done = ps ? ps.resolved : 0;

  return `<div class="explain">
      <h2>${esc(p.client)} is paying ${esc(p.contractor)} ${money(p.totalCents)} to build ${esc(p.what || 'a building')}.</h2>
      <p>Like every building job anywhere, it is paid in stages as the work gets done — and like
        every building job anywhere, the argument is always whether the stage was really finished.
        Normally that is settled by a site visit, a surveyor, and sixty days of waiting.</p>
      <p class="big"><strong>Here the money for each stage is locked on a public ledger up front,
        and an agent releases it only when the evidence proves the work was done.</strong>
        Pick a stage below to see how.</p>
    </div>`
    + head(esc(p.name),
      `${esc(p.site.address)} · ${p.milestones.length} stages · ${done} of ${p.milestones.length} settled`,
      `${money(p.totalCents)} contract`)
    + milestoneListHtml()
    + `<p class="cap">Click any stage to open it.</p>`;
}

// ---------------------------------------------------------------- evidence
/**
 * What was asked for, and what turned up.
 *
 * The left column is computed from the contract — the same fields the rules
 * read — so it can never claim to check something it does not. On a stage that
 * has not run, the left column is simply the builder's to-do list.
 */
function viewEvidence() {
  const id = state.focus || state.lastRun || state.project.milestones[0].id;
  const e = state.evidence && state.evidence.milestone.id === id ? state.evidence : null;
  const picker = `<div class="picker">` + state.project.milestones.map((m) =>
    `<button class="pk ${m.id === id ? 'on' : ''}" data-evidence="${m.id}">${m.id.slice(1)}</button>`).join('')
    + `<span>${esc(e ? e.milestone.name : '')}</span></div>`;

  if (!e) return head('Evidence', 'Loading…', '') + picker;

  const byCode = new Set(e.findings.map((f) => f.code));

  const photoRow = (ph) => {
    const bad = [];
    if (ph.metresFromSite != null && ph.metresFromSite > e.site.radiusM) {
      bad.push(`taken ${(ph.metresFromSite / 1000).toFixed(1)}km away, off site`);
    }
    for (const f of e.findings) {
      if (f.text.startsWith(ph.file)) {
        if (f.code === 'PHOTO-REUSED') bad.push('already used on an earlier stage');
        if (f.code === 'PHOTO-TAMPERED') bad.push('edited after it was taken');
        if (f.code === 'PHOTO-TIME') bad.push('dated outside this stage');
      }
    }
    const el = e.elements.find((x) => x.id === ph.evidences);
    return `<div class="ev ${bad.length ? 'bad' : 'ok'}">
      <span class="mk">${bad.length ? '✗' : '✓'}</span>
      <div><div class="f">${esc(ph.file)}</div>
        <div class="d">${el ? esc(el.label) : 'not tied to any part of this stage'}${
          ph.metresFromSite != null && !bad.length ? ` · on site, ${ph.metresFromSite}m` : ''}</div>
        ${bad.map((b) => `<div class="why">${esc(b)}</div>`).join('')}</div></div>`;
  };

  const missing = e.elements
    .filter((el) => !(e.submitted?.photos ?? []).some((ph) => ph.evidences === el.id))
    .map((el) => `<div class="ev miss"><span class="mk">—</span>
      <div><div class="f">${esc(el.label)}</div>
        <div class="d">nothing submitted for this</div></div></div>`).join('');

  const inv = e.submitted?.invoice;
  const invBad = inv && inv.amountCents !== e.milestone.amountCents;
  const delivered = (e.submitted?.deliveries ?? []).map((dv) => {
    const unverified = byCode.has('DELIVERY-UNVERIFIED')
      && e.findings.some((f) => f.code === 'DELIVERY-UNVERIFIED' && f.text.includes(dv.ref));
    return `<div class="ev ${unverified ? 'bad' : 'ok'}"><span class="mk">${unverified ? '✗' : '✓'}</span>
      <div><div class="f">${esc(dv.ref)} · ${esc(dv.supplier)}</div>
        <div class="d">${dv.qty.toLocaleString('en-US')} delivered ${esc(dv.deliveredAt)}</div>
        ${unverified ? `<div class="why">the supplier has no record of issuing this</div>` : ''}</div></div>`;
  }).join('');

  return head('Evidence',
    `${esc(e.milestone.name)} — ${esc(e.milestone.plain || '')}. What the agent needs before it will `
    + `release ${money(e.milestone.amountCents)}, and what ${esc(state.project.contractor)} actually sent.`,
    e.attempt > 1 ? 'second attempt' : (e.submitted ? 'first attempt' : 'nothing sent yet'))
  + picker
  + `<div class="evcols">
      <div><h3 class="sec">What is required</h3>` +
      e.required.map((r) => `<div class="req"><div class="n">${esc(r.need)}</div>
        <div class="d">${esc(r.detail)}</div>
        ${r.parts?.length ? `<ul>${r.parts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </div>`).join('') + `</div>
      <div><h3 class="sec">What was sent</h3>` +
      (e.submitted
        ? `<div class="note-quote">“${esc(e.submitted.note)}”<span>${esc(e.submitted.submittedAt.slice(0, 10))}</span></div>`
          + (e.submitted.photos.map(photoRow).join('') || '')
          + missing
          + delivered
          + (inv ? `<div class="ev ${invBad ? 'bad' : 'ok'}"><span class="mk">${invBad ? '✗' : '✓'}</span>
              <div><div class="f">${esc(inv.ref)}</div>
                <div class="d">bill for ${money(inv.amountCents)}</div>
                ${invBad ? `<div class="why">the agreed amount for this stage is ${money(e.milestone.amountCents)}</div>` : ''}</div></div>`
            : `<div class="ev miss"><span class="mk">—</span><div><div class="f">No bill</div>
                <div class="d">nothing submitted</div></div></div>`)
          + (e.model ? `<div class="ev ${e.model.percent < 95 ? 'bad' : 'ok'}">
              <span class="mk">${e.model.percent < 95 ? '✗' : '✓'}</span>
              <div><div class="f">Survey: ${e.model.percent}% built</div>
                <div class="d">${e.model.found} of ${e.model.agreed} things this stage covers</div></div></div>` : '')
        : `<div class="empty">Nothing has been sent for this stage yet. The list on the left is what
             ${esc(state.project.contractor)} has to provide.</div>`)
      + `</div></div>`
  + (e.model ? `<h3 class="sec">Counted against the drawings</h3>` + reconcileHtml(e.model) : '');
}

function viewSystem() {
  const w = state.wallets;
  const pol = w?.policy;
  const r = state.record;
  const rows = [];
  for (const m of state.project.milestones) {
    for (const h of (state.milestones[m.id]?.hashes || [])) rows.push({ m: m.id, ...h });
  }

  return head('How it is built',
    'Everything below is checkable. The wallets are real testnet accounts, every transaction resolves '
    + 'on the public explorer, and the limits are enforced inside the only process that holds a key.',
    state.reasoner ? esc(state.reasoner.provider + ' / ' + state.reasoner.model) : '')

  + `<h3 class="sec">The four wallets</h3><table>
      <tr><th>Who</th><th class="mono">Address</th><th class="num">XRP</th><th class="num">RLUSD</th></tr>` +
    (w?.wallets ?? []).map((x) => `<tr><td><strong>${esc(x.who)}</strong>
      <div class="cap">${esc(x.role)}</div></td>
      <td class="mono"><a href="https://testnet.xrpl.org/accounts/${esc(x.address)}"
        target="_blank" rel="noopener">${esc(x.address)}</a></td>
      <td class="num">${esc(x.xrp ?? '—')}</td>
      <td class="num">${esc(x.rlusd ?? '—')}</td></tr>`).join('') + '</table>'
  + (w?.escrowNote ? `<p class="note">${esc(w.escrowNote)}</p>` : '')

  + `<h3 class="sec">What the agent may do without asking</h3><table>
      <tr><th>Limit</th><th>Applies to</th><th class="num">Amount</th></tr>
      <tr><td>Per call</td><td>one evidence check</td><td class="num">${pol ? money2(pol.perCallCents) : '—'}</td></tr>
      <tr><td>Per stage</td><td>everything it buys to decide one stage</td><td class="num">${pol ? money2(pol.perTradeCents) : '—'}</td></tr>
      <tr><td>Per run</td><td>the process as a whole</td><td class="num">${pol ? money2(pol.perRunCents) : '—'}</td></tr>
      <tr><td><strong>Release ceiling</strong></td><td>above this the buyer signs from her own wallet</td>
        <td class="num"><strong>${pol ? money(pol.approvalAboveCents) : '—'}</strong></td></tr>
    </table>
    <p class="note">The agent holds no key and can only ask. A separate process holds the keys, checks
      every request against these limits, and refuses out loud — a refusal is a logged decision with a
      reason, never a silent no-op. The buyer may set a stricter limit than ours; she cannot set a
      looser one.</p>`

  + `<h3 class="sec">Who the agent buys evidence from</h3><table>
      <tr><th>Provider</th><th class="num">Price</th><th class="num">Speed</th>
      <th class="num">Reliability</th><th>Status</th></tr>` +
    state.providers.map((p) => `<tr>
      <td><strong>${esc(p.name)}</strong><div class="cap">${esc(p.description)}</div></td>
      <td class="num">US$${esc(p.price)}</td>
      <td class="num">${p.turnaroundHours ? p.turnaroundHours + 'h' : '—'}</td>
      <td class="num">${p.reliability != null ? Math.round(p.reliability * 100) + '%' : '—'}</td>
      <td><span class="pill ${p.available === false ? 'down' : 'available'}">${p.available === false ? 'unavailable' : 'available'}</span></td>
    </tr>`).join('') + '</table>'
  + `<p class="note">No contracts and no accounts — each provider answers with a price, waits for the
     payment to appear on the ledger, then serves the data. The US$4.50 credit report is deliberately
     priced above the per-call limit: the agent is offered it on every single stage and refuses it
     every single time. Two inspectors sell the same check at different prices, and the deadline
     decides which one is worth buying.</p>`

  + `<h3 class="sec">The builder's record, on the builder's own account</h3>
     <div class="split"><div>
      <div class="panel"><h4>${esc(state.project.contractor)}</h4>
        <div class="row"><span>stages completed</span><span>${r?.milestonesCompleted ?? 0}</span></div>
        <div class="row"><span>projects completed</span><span>${r?.projectsCompleted ?? 0}</span></div>
        <div class="row"><span>delivered on time</span><span>${r?.onTimeRate == null ? '—' : r.onTimeRate + '%'}</span></div>
        <div class="addr">${esc(r?.address || '')}</div></div>
      <p class="note">Written as XLS-70 credentials to the builder's <em>own</em> XRPL account, not to a
        database we control. They keep it, they can show it to their next client, and it survives us
        going out of business. A credential is keyed to the project and stage, so it cannot be issued
        twice — re-running this demo cannot inflate anyone's record.</p>
     </div><div>
      <h3 class="sec" style="margin-top:0">Every transaction on this project${rows.length ? ' — ' + rows.length : ''}</h3>` +
      (rows.length ? `<table><tr><th>Stage</th><th>What</th><th class="mono">Transaction</th></tr>` +
        rows.map((x) => `<tr><td class="mono">${x.m}</td>
          <td>${esc(x.stage)} · ${esc(String(x.decision || '').replace(/_/g, ' '))}</td>
          <td class="mono"><a href="${esc(x.explorer)}" target="_blank" rel="noopener">${esc(x.txHash.slice(0, 18))}… &#8599;</a></td></tr>`).join('')
        + '</table>'
        : '<div class="empty">Nothing has run yet. Start on the Demo screen.</div>')
     + '</div></div>'

  + `<h3 class="sec">The stack</h3><table>
      <tr><th>Layer</th><th>What we use</th></tr>
      <tr><td>Ledger</td><td>XRP Ledger testnet — Escrow with crypto-conditions, Payment, Credentials (XLS-70), TrustSet</td></tr>
      <tr><td>Agentic payments</td><td>Machine Payments Protocol via <span class="mono">xrpl-mpp-sdk</span>, an x402-style 402 challenge</td></tr>
      <tr><td>Starter Kit</td><td>agent-wallet and payments skills, XRPL Docs MCP, SourceTag 20260530, simulate before signing</td></tr>
      <tr><td>Model</td><td>${state.reasoner ? esc(state.reasoner.provider + ' / ' + state.reasoner.model) : 'composed text'} — writes the explanation, never the decision</td></tr>
      <tr><td>Agent credit</td><td>Claw Credit — written and gated, blocked on an invite code</td></tr>
    </table>`;
}

// ---------------------------------------------------------------- action
function actionHtml() {
  const p = state.pending[0];
  if (!p) return '';
  const a = p.authorisation;
  const wallets = [];
  if (window.crossmark) wallets.push('<button class="btn" id="w-crossmark">Approve with Crossmark</button>');
  if (window.gemWallet || window.GemWalletApi) wallets.push('<button class="btn" id="w-gem">Approve with GemWallet</button>');
  return `<div class="action"><h4>${esc(p.name)} is ready — it needs you</h4>
    <p>${money(p.amountCents)} is above the limit you set, so Kirim will not release it on its own.
       The evidence is in order. Approve from your own wallet and the ${esc(THEM())} is paid in seconds.</p>
    <dl><dt>to</dt><dd>${esc(a.to)}</dd><dt>reference</dt><dd>${esc(a.memo)}</dd></dl>
    ${wallets.length ? `<div class="row2">${wallets.join('')}</div>` : ''}
    <div class="row2" style="margin-top:10px">
      <input type="text" id="auth-hash" placeholder="…or paste the transaction hash from any wallet">
      <button class="btn ghost" id="auth-submit">Approve</button></div>
    <div id="auth-msg"></div></div>`;
}

function feedHtml() {
  if (!state.feed.length) return '<div class="empty">Press one of the buttons above. Every decision the agent makes appears here as it happens.</div>';
  return state.feed.map((e) => {
    const cost = e.costCents ? `<span class="cost">US$${(e.costCents / 100).toFixed(2)}</span>` : '';
    const link = e.explorer
      ? `<a href="${esc(e.explorer)}" target="_blank" rel="noopener">${esc(e.txHash.slice(0, 26))}…</a>` : '';
    return `<div class="row ${e.stage} ${e.decision}">
      <div>${cost}<div class="decision ${e.decision}">${esc(logWords(e))}</div>
      <div class="reason">${esc(e.reason)}</div>${link}</div></div>`;
  }).join('');
}

// ---------------------------------------------------------------- wiring
function wire() {
  for (const b of document.querySelectorAll('[data-run]')) {
    b.onclick = () => run(b.dataset.run);
  }
  // Clicking a stage opens it rather than running it. You look first.
  for (const b of document.querySelectorAll('[data-open]')) {
    b.onclick = () => openStage(b.dataset.open);
  }
  for (const b of document.querySelectorAll('[data-evidence]')) {
    b.onclick = () => { state.focus = b.dataset.evidence; loadEvidence(); };
  }
  for (const b of document.querySelectorAll('[data-confirm]')) {
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = 'Confirming…';
      await fetch('/api/review/confirm?key=' + encodeURIComponent(b.dataset.confirm),
        { method: 'POST' }).catch(() => {});
      await load();
    };
  }
  const submitBtn = $('auth-submit');
  if (!submitBtn) return;

  const p = state.pending[0];
  const a = p.authorisation;
  const msg = (t, cls) => { $('auth-msg').innerHTML = `<div class="${cls}">${esc(t)}</div>`; };
  const submit = async (txHash) => {
    msg('Checking your signature on the ledger…', 'ok');
    const res = await fetch('/api/authorise?key=' + encodeURIComponent(p.key), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txHash }),
    });
    if (!res.ok) msg((await res.json()).error || 'Could not approve.', 'err');
  };
  const tx = {
    TransactionType: 'Payment', Destination: a.to,
    Amount: String(Math.round(Number(a.amountXrp) * 1000000)),
    Memos: [{ Memo: { MemoData: toHex(a.memo), MemoType: toHex('kirim/authorise') } }],
  };
  submitBtn.onclick = () => {
    const v = $('auth-hash').value.trim();
    if (!/^[0-9A-Fa-f]{64}$/.test(v)) return msg('That does not look like a transaction hash.', 'err');
    submit(v.toUpperCase());
  };
  const cm = $('w-crossmark');
  if (cm) cm.onclick = async () => {
    try {
      msg('Confirm in Crossmark…', 'ok');
      await window.crossmark.methods.signInAndWait();
      const r = await window.crossmark.methods.signAndSubmitAndWait(tx);
      const hash = r?.response?.data?.resp?.result?.hash || r?.data?.resp?.result?.hash;
      hash ? submit(hash) : msg('Crossmark did not return a transaction hash.', 'err');
    } catch (e) { msg('Crossmark: ' + (e.message || e), 'err'); }
  };
  const gw = $('w-gem');
  if (gw) gw.onclick = async () => {
    try {
      msg('Confirm in GemWallet…', 'ok');
      const api = window.gemWallet || window.GemWalletApi;
      const r = await api.sendPayment({
        amount: a.amountXrp, destination: a.to,
        memos: [{ memo: { memoData: toHex(a.memo), memoType: toHex('kirim/authorise') } }],
      });
      const hash = r?.result?.hash || r?.hash;
      hash ? submit(hash) : msg('GemWallet did not return a transaction hash.', 'err');
    } catch (e) { msg('GemWallet: ' + (e.message || e), 'err'); }
  };
}

/** Open one stage on the Demo screen — the way in from the stage list. */
function openStage(id) {
  state.focus = id;
  state.view = 'demo';
  render();
  loadEvidence();
}

async function loadEvidence() {
  const id = state.focus || state.lastRun || state.project?.milestones[0]?.id;
  if (!id) return;
  state.evidence = await fetch('/api/evidence?id=' + encodeURIComponent(id))
    .then((r) => r.json()).catch(() => null);
  render();
}

function toHex(s) {
  return Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Balances while a run is in flight. The claim this product makes is that money
 * moves on a public ledger in seconds; a screen that only says so afterwards is
 * asking to be taken on trust.
 */
let balanceTimer = null;

async function refreshWallets() {
  const w = await fetch('/api/wallets').then((r) => r.json()).catch(() => null);
  if (!w) return;
  state.wallets = w;
  if (state.view === 'demo' || state.view === 'system') render();
}

async function refreshHeld() {
  const h = await fetch('/api/held').then((r) => r.json()).catch(() => null);
  if (h) state.held = h.held || [];
}

function run(id) {
  if (state.running) return;
  state.running = id;
  state.lastRun = id;
  state.feed = [];
  state.stage = null;
  // Freeze the opening balances so the deltas mean "since this run started".
  state.wallets0 = state.wallets ? JSON.parse(JSON.stringify(state.wallets)) : null;
  render();
  fetch('/api/run?id=' + encodeURIComponent(id), { method: 'POST' });
  clearInterval(balanceTimer);
  balanceTimer = setInterval(refreshWallets, 2500);
}

// Two stages are the agent shopping around. Interesting once, noise every time.
const HIDE = new Set(['discovery', 'comparison']);

const es = new EventSource('/events');
es.onopen = () => { $('live').classList.add('on'); $('livetext').textContent = 'live'; };
es.onerror = () => { $('live').classList.remove('on'); $('livetext').textContent = 'reconnecting'; };
es.onmessage = async (ev) => {
  const e = JSON.parse(ev.data);
  if (e.type === 'run_finished' || e.type === 'run_failed') {
    state.running = null;
    state.stage = null;
    clearInterval(balanceTimer);
    // One last read after the ledger has validated, then leave the deltas up.
    await refreshHeld();
    await load();
    await refreshWallets();
    return;
  }
  if (e.type !== 'decision') return;
  state.stage = e.stage;
  state.feed.push(e);
  if (HIDE.has(e.stage)) {
    // still advances the pipeline, just not shown in this role's feed
    const flow = document.querySelector('.flow');
    if (flow) flow.outerHTML = pipelineHtml();
    return;
  }
  const feed = $('feed');
  if (feed) {
    feed.insertAdjacentHTML('beforeend', feedHtml().split('</div></div>').slice(-2)[0] + '</div></div>');
    feed.scrollTop = feed.scrollHeight;
  }
  const flow = document.querySelector('.flow');
  if (flow) flow.outerHTML = pipelineHtml();
};


load();
