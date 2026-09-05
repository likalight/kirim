/**
 * KIRIM console.
 *
 * Seven modules over one live event stream. Two people use this — the client
 * whose money is escrowed and the contractor waiting to be paid — so the same
 * data is worded differently depending on who is looking.
 */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (c) => 'S$' + (c / 100).toLocaleString('en-SG', { maximumFractionDigits: 0 });
const money2 = (c) => 'S$' + (c / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const state = {
  view: 'overview',
  role: 'client',
  project: null,
  milestones: {},
  record: null,
  pending: [],
  providers: [],
  wallets: null,
  reasoner: null,
  running: null,
  stage: null,
  feed: [],
};

const STATUS_WORDS = {
  client: {
    released: 'paid', flagged: 'needs your review', more_info: 'waiting on contractor',
    awaiting_client: 'needs your signature', returned: 'refunded to you',
    in_progress: 'in progress', unknown: 'not started',
  },
  contractor: {
    released: 'you were paid', flagged: 'held — see why', more_info: 'send more evidence',
    awaiting_client: 'awaiting client signature', returned: 'expired',
    in_progress: 'in progress', unknown: 'not submitted',
  },
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
  overview: 'M2 8 L8 2 L14 8 M4 7 v7 h8 v-7',
  milestones: 'M2 3 h12 M2 8 h12 M2 13 h7',
  evidence: 'M2 4 h12 v9 H2 z M5 4 l1-2 h4 l1 2 M8 11 a2.2 2.2 0 1 0 0-4.4 a2.2 2.2 0 0 0 0 4.4',
  payments: 'M2 5 h12 v7 H2 z M2 8 h12 M5 11 h3',
  providers: 'M8 2 v12 M3 5 h10 M4 9 h8',
  record: 'M8 2 L14 5 v4 c0 3-3 5-6 5 s-6-2-6-5 V5 z M5.5 8 L7.3 10 L10.7 6.2',
  system: 'M8 5.2 a2.8 2.8 0 1 0 0 5.6 a2.8 2.8 0 0 0 0-5.6 M8 1.5 v2 M8 12.5 v2 M1.5 8 h2 M12.5 8 h2',
};

const VIEWS = [
  ['overview', 'Overview'],
  ['milestones', 'Milestones'],
  ['evidence', 'Evidence'],
  ['payments', 'Payments'],
  ['providers', 'Providers'],
  ['record', 'Track record'],
  ['system', 'System'],
];

// ---------------------------------------------------------------- data
async function load() {
  const [project, st, record, pending, providers, wallets, reasoner] = await Promise.all([
    fetch('/api/project').then((r) => r.json()),
    fetch('/api/state').then((r) => r.json()).catch(() => ({ milestones: {} })),
    fetch('/api/record').then((r) => r.json()).catch(() => null),
    fetch('/api/pending').then((r) => r.json()).catch(() => ({ pending: [] })),
    fetch('/api/providers').then((r) => r.json()).catch(() => ({ providers: [] })),
    fetch('/api/wallets').then((r) => r.json()).catch(() => null),
    fetch('/api/reasoner').then((r) => r.json()).catch(() => null),
  ]);
  Object.assign(state, {
    project, milestones: st.milestones || {}, record,
    pending: pending.pending || [], providers: providers.providers || [],
    wallets, reasoner,
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
  $('nav-list').innerHTML = VIEWS.map(([k, label]) => `
    <li><button data-view="${k}" aria-current="${state.view === k}">
      <svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor"
           stroke-width="1.3" stroke-linecap="square"><path d="${ICONS[k]}"/></svg>
      ${label}</button></li>`).join('');
  for (const b of document.querySelectorAll('[data-view]')) {
    b.onclick = () => { state.view = b.dataset.view; render(); };
  }
  $('as-client').setAttribute('aria-pressed', state.role === 'client');
  $('as-contractor').setAttribute('aria-pressed', state.role === 'contractor');
}

function head(title, sub, meta) {
  return `<div class="head"><div><h2>${esc(title)}</h2>
    <div class="sub">${sub}</div></div>
    <div class="meta">${meta || ''}</div></div>`;
}

function render() {
  renderNav();
  const fn = {
    overview: viewOverview, milestones: viewMilestones, evidence: viewEvidence,
    payments: viewPayments, providers: viewProviders, record: viewRecord, system: viewSystem,
  }[state.view];
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
function viewOverview() {
  const t = totals();
  const p = state.project;
  const isClient = state.role === 'client';
  const needs = state.pending.length;

  return head(
    p.name,
    isClient
      ? `${esc(p.client)} · ${esc(p.contractor)} · ${esc(p.site.address)}`
      : `Work for ${esc(p.client)} at ${esc(p.site.address)}`,
    `${t.tx} ledger writes<br>${state.reasoner ? esc(state.reasoner.provider + ' / ' + state.reasoner.model) : ''}`)
  + `<h3 class="sec">${isClient ? 'Your money' : 'Your money'}</h3>`
  + `<dl class="tiles">
      <div><dt>${isClient ? 'Protected in escrow' : 'Paid to you'}</dt>
        <dd>${money(isClient ? t.committed : t.paid)}</dd>
        <small>${isClient ? 'released only against evidence' : 'on presentation, not on terms'}</small></div>
      <div><dt>Held back</dt><dd>${money(t.held)}</dd>
        <small>${isClient ? 'evidence incomplete or contradicted' : 'send what is missing'}</small></div>
      <div><dt>${isClient ? 'Cost of checking' : 'Milestones done'}</dt>
        <dd>${isClient ? money2(t.evidence) : (state.record?.milestonesCompleted ?? 0)}</dd>
        <small>${isClient ? 'paid to independent providers' : 'written to your ledger account'}</small></div>
      <div><dt>${isClient ? 'Kirim fees' : 'On time'}</dt>
        <dd>${isClient ? money2(t.fees) : (state.record?.onTimeRate == null ? '—' : state.record.onTimeRate + '%')}</dd>
        <small>${isClient ? '0.8% of each release' : 'across every project'}</small></div>
    </dl>`
  + (needs && isClient ? actionHtml() : '')
  + `<h3 class="sec">The pipeline${state.running ? ' — running ' + esc(state.running) : ''}</h3>`
  + pipelineHtml()
  + `<div class="split" style="margin-top:26px">
      <div><h3 class="sec">Milestones</h3>${milestoneListHtml()}</div>
      <div><h3 class="sec">${isClient ? 'What Kirim is doing with your money' : 'What Kirim checked'}</h3>
        <div class="feed" id="feed">${feedHtml()}</div></div>
    </div>`;
}

function milestoneListHtml() {
  const isClient = state.role === 'client';
  return state.project.milestones.map((m) => {
    const s = state.milestones[m.id] || { status: 'unknown' };
    const line = (isClient ? {
      released: 'Evidence matched what you agreed. Paid in seconds.',
      flagged: 'Something does not add up. Your money is still held.',
      more_info: 'The contractor has not sent enough yet. Nothing is wrong.',
      awaiting_client: 'Above the limit you set — Kirim will not release without you.',
      returned: 'Nothing was delivered. Your money came back.',
    } : {
      released: 'Paid on presentation.',
      flagged: 'Held — the evidence contradicts the agreed scope.',
      more_info: 'Send the missing items and it releases.',
      awaiting_client: 'Everything checked out. Waiting on the client to sign.',
      returned: 'Expired without a submission.',
    })[s.status] || m.scenario || '';
    return `<button class="ms ${s.status}" data-run="${m.id}" ${state.running ? 'disabled' : ''}>
      <span class="bar"></span>
      <span class="body"><span class="top"><span class="id">${m.id}</span>
        <span class="nm">${esc(m.name)}</span></span>
        <div class="sc">${esc(line)}</div></span>
      <span class="right"><div class="amt">${money(m.amountCents)}</div>
        <div class="pill ${s.status}">${esc(STATUS_WORDS[state.role][s.status] || s.status)}</div></span>
    </button>`;
  }).join('');
}

function viewMilestones() {
  const isClient = state.role === 'client';
  return head('Milestones',
    isClient
      ? 'Each one holds its own money. Click any to run it — the agent plans, buys what it needs to check the evidence, and decides.'
      : 'What you are being paid for, and exactly what each one needs before it releases.',
    `${state.project.milestones.length} on this project`)
  + milestoneListHtml()
  + (state.pending.length && isClient ? actionHtml() : '')
  + `<h3 class="sec">Activity</h3><div class="feed" id="feed">${feedHtml()}</div>`;
}

function viewEvidence() {
  const rules = [
    ['PHOTO-GEO', 'blocking', 'Photograph taken outside the site boundary'],
    ['PHOTO-TIME', 'blocking', 'Timestamp precedes the milestone, or postdates the submission'],
    ['PHOTO-REUSED', 'blocking', 'Byte-identical to a photograph from an earlier milestone'],
    ['PHOTO-TAMPERED', 'blocking', 'Forensics found re-encoding after capture'],
    ['MATERIALS-SHORT', 'blocking', 'Delivered quantity below the bill of quantities'],
    ['DELIVERY-UNVERIFIED', 'blocking', "Delivery note absent from the supplier's own records"],
    ['INSPECT-INCOMPLETE', 'blocking', 'Independent inspection below the release threshold'],
    ['DEFECT-CRITICAL', 'blocking', 'Critical defect open at inspection'],
    ['PERMIT-MISSING', 'blocking', 'Required permit reference not provided'],
    ['SEQ-INCOMPLETE', 'blocking', 'A milestone this one depends on has not been released'],
    ['EVIDENCE-THIN', 'missing', 'Fewer photographs than the milestone requires'],
    ['INSPECTION-NORESULT', 'missing', 'The inspection returned no completion figure'],
    ['LATE', 'advisory', 'Submitted after the agreed date — recorded, not blocking'],
  ];
  const found = [];
  for (const m of state.project.milestones) {
    const s = state.milestones[m.id];
    for (const f of (s?.findings || [])) found.push({ m: m.id, ...f });
  }

  return head('Evidence',
    'A photograph on its own cannot be examined. One with a timestamp and a GPS fix can. Kirim does not claim to verify construction — it reconciles what was submitted against what was agreed.',
    `${rules.length} rules`)
  + (found.length ? `<h3 class="sec">Findings on this project</h3><table>
      <tr><th>Milestone</th><th>Code</th><th>Severity</th><th>What it found</th></tr>` +
      found.map((f) => `<tr><td class="mono">${f.m}</td><td class="mono">${esc(f.code)}</td>
        <td><span class="pill ${f.severity === 'blocking' ? 'flagged' : f.severity === 'missing' ? 'more_info' : 'unknown'}">${esc(f.severity)}</span></td>
        <td>${esc(f.text)}</td></tr>`).join('') + '</table>' : '')
  + `<h3 class="sec">Every rule the agent applies</h3><table>
      <tr><th>Code</th><th>Severity</th><th>Check</th></tr>` +
    rules.map(([c, sev, d]) => `<tr><td class="mono">${c}</td>
      <td><span class="pill ${sev === 'blocking' ? 'flagged' : sev === 'missing' ? 'more_info' : 'unknown'}">${sev}</span></td>
      <td>${esc(d)}</td></tr>`).join('') + '</table>'
  + `<p class="note">Any blocking finding holds the money. A missing one asks for more and marks nothing
     against the contractor. The rules decide; the model only writes the note that explains them.</p>`;
}

function viewPayments() {
  const w = state.wallets;
  const rows = [];
  for (const m of state.project.milestones) {
    for (const h of (state.milestones[m.id]?.hashes || [])) rows.push({ m: m.id, ...h });
  }
  return head('Payments',
    'Every movement of money on this project, on the XRP Ledger. Evidence is bought over the Machine Payments Protocol and settles in RLUSD; the escrowed principal is in XRP.',
    w ? `payments in ${esc(w.payments)}<br>escrow in ${esc(w.escrow)}` : '')
  + (w?.escrowNote ? `<p class="note">${esc(w.escrowNote)}</p>` : '')
  + `<h3 class="sec">Wallets</h3><table>
      <tr><th>Role</th><th>Who</th><th class="mono">Address</th><th class="num">XRP</th><th class="num">RLUSD</th></tr>` +
    (w?.wallets ?? []).map((x) => `<tr><td>${esc(x.role)}</td><td>${esc(x.who)}</td>
      <td class="mono">${esc(x.address)}</td><td class="num">${esc(x.xrp ?? '—')}</td>
      <td class="num">${esc(x.rlusd ?? '—')}</td></tr>`).join('') + '</table>'
  + `<h3 class="sec">Ledger writes${rows.length ? ' — ' + rows.length : ''}</h3>` +
    (rows.length ? `<table><tr><th>Milestone</th><th>Stage</th><th>Outcome</th><th class="mono">Transaction</th></tr>` +
      rows.map((r) => `<tr><td class="mono">${r.m}</td><td>${esc(r.stage)}</td>
        <td>${esc(String(r.decision || '').replace(/_/g, ' '))}</td>
        <td class="mono"><a href="${esc(r.explorer)}" target="_blank" rel="noopener">${esc(r.txHash.slice(0, 30))}…</a></td></tr>`).join('')
      + '</table>'
      : `<div class="empty">No milestone has run yet in this project.</div>`);
}

function viewProviders() {
  return head('Providers',
    'Independent services the agent buys from, per call, over MPP. Each replies 402 with a price, verifies the payment on-ledger, and signs what it returns. No contract, no account, no subscription.',
    `${state.providers.length} in the market`)
  + `<table><tr><th>Provider</th><th class="num">Price</th><th class="num">Turnaround</th>
      <th class="num">Reliability</th><th>Status</th></tr>` +
    state.providers.map((p) => `<tr>
      <td><strong>${esc(p.name)}</strong><div class="sub" style="font-size:12.5px;color:var(--ink-3)">${esc(p.description)}</div></td>
      <td class="num">US$${esc(p.price)}</td>
      <td class="num">${p.turnaroundHours ? p.turnaroundHours + 'h' : '—'}</td>
      <td class="num">${p.reliability != null ? Math.round(p.reliability * 100) + '%' : '—'}</td>
      <td><span class="pill ${p.available === false ? 'down' : 'available'}">${p.available === false ? 'unavailable' : 'available'}</span></td>
    </tr>`).join('') + '</table>'
  + `<p class="note">The US$4.50 credit report is deliberately above the per-call ceiling — the agent is
     offered it on every milestone and refuses it every time. Two inspectors sell the same check at
     different prices and turnarounds, and the deadline decides which one is bought.</p>`;
}

function viewRecord() {
  const r = state.record;
  const isClient = state.role === 'client';
  return head(isClient ? 'Who you hired' : 'Your track record',
    isClient
      ? 'Held on the contractor’s own XRPL account as XLS-70 credentials. You can verify it without asking Kirim, and it survives us.'
      : 'Yours, on your own account. Portable to any future client, verifiable without asking Kirim.',
    'XLS-70 credentials')
  + `<div class="split"><div>
      <div class="panel"><h4>${esc(isClient ? state.project.contractor : 'On the ledger')}</h4>
        <div class="row"><span>milestones completed</span><span>${r?.milestonesCompleted ?? 0}</span></div>
        <div class="row"><span>projects completed</span><span>${r?.projectsCompleted ?? 0}</span></div>
        <div class="row"><span>delivered on time</span><span>${r?.onTimeRate == null ? '—' : r.onTimeRate + '%'}</span></div>
        <div class="addr">${esc(r?.address || '')}</div></div>
      <p class="note">A credential is keyed to the project and milestone, so it cannot be issued twice.
        Re-running a demo cannot inflate a record.</p>
    </div>
    <div><h3 class="sec" style="margin-top:0">What a credential says</h3>
      <div class="panel"><h4>on-ledger credential</h4>
        <div class="row"><span>type</span><span>KIRIM:${esc(state.project.id)}:M1</span></div>
        <div class="row"><span>subject</span><span>the contractor</span></div>
        <div class="row"><span>issuer</span><span>Kirim</span></div>
        <div class="row"><span>accepted</span><span>true</span></div>
      </div>
      <p class="note">We do not claim a credential makes a contractor trustworthy. It makes their
        history visible.</p>
    </div></div>`;
}

function viewSystem() {
  const w = state.wallets;
  const p = w?.policy;
  return head('System',
    'What is running, what it will do on its own, and where it stops.',
    state.reasoner ? esc(state.reasoner.provider + ' / ' + state.reasoner.model) : '')
  + `<h3 class="sec">Autonomy and ceilings</h3><table>
      <tr><th>Control</th><th>Applies to</th><th class="num">Limit</th></tr>
      <tr><td>Per call</td><td>one evidence check over MPP</td><td class="num">${p ? money2(p.perCallCents) : '—'}</td></tr>
      <tr><td>Per milestone</td><td>everything the agent buys to decide</td><td class="num">${p ? money2(p.perTradeCents) : '—'}</td></tr>
      <tr><td>Per run</td><td>the process as a whole</td><td class="num">${p ? money2(p.perRunCents) : '—'}</td></tr>
      <tr><td><strong>Release ceiling</strong></td><td>above this the client signs, from their own wallet</td>
        <td class="num"><strong>${p ? money(p.approvalAboveCents) : '—'}</strong></td></tr>
    </table>
    <p class="note">Ceilings are enforced inside the only process that holds a key. The agent may ask;
      it cannot make that process send. A refusal is a logged decision with a reason.</p>`
  + `<h3 class="sec">Settlement</h3><table>
      <tr><th>Flow</th><th>Asset</th><th>Why</th></tr>
      <tr><td>Evidence checks and fees</td><td>${esc(w?.payments ?? '—')}</td><td>dollar prices settled in a dollar stablecoin</td></tr>
      <tr><td>Escrowed principal</td><td>${esc(w?.escrow ?? '—')}</td><td>${esc(w?.escrowNote ? 'the RLUSD issuer does not permit trustline locking, so TokenEscrow refuses it' : 'the token permits locking')}</td></tr>
    </table>`
  + `<h3 class="sec">The stack</h3><table>
      <tr><th>Layer</th><th>What we use</th></tr>
      <tr><td>Ledger</td><td>XRP Ledger testnet — Escrow with crypto-conditions, Payment, Credentials (XLS-70), TrustSet</td></tr>
      <tr><td>Agentic payments</td><td>Machine Payments Protocol via <span class="mono">xrpl-mpp-sdk</span></td></tr>
      <tr><td>Starter Kit</td><td>agent-wallet and payments skills, XRPL Docs MCP, SourceTag 20260530, simulate before signing</td></tr>
      <tr><td>Model</td><td>${state.reasoner ? esc(state.reasoner.provider + ' / ' + state.reasoner.model) : 'composed text'} — writes the advice, never decides whether money moves</td></tr>
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
       The evidence is in order. Approve from your own wallet and the contractor is paid in seconds.</p>
    <dl><dt>to</dt><dd>${esc(a.to)}</dd><dt>reference</dt><dd>${esc(a.memo)}</dd></dl>
    ${wallets.length ? `<div class="row2">${wallets.join('')}</div>` : ''}
    <div class="row2" style="margin-top:10px">
      <input type="text" id="auth-hash" placeholder="…or paste the transaction hash from any wallet">
      <button class="btn ghost" id="auth-submit">Approve</button></div>
    <div id="auth-msg"></div></div>`;
}

function feedHtml() {
  if (!state.feed.length) return '<div class="empty">Run a milestone and the agent’s decisions appear here, live.</div>';
  return state.feed.map((e) => {
    const cost = e.costCents ? `<span class="cost">S$${(e.costCents / 100).toFixed(2)}</span>` : '';
    const link = e.explorer
      ? `<a href="${esc(e.explorer)}" target="_blank" rel="noopener">${esc(e.txHash.slice(0, 26))}…</a>` : '';
    return `<div class="row ${e.stage} ${e.decision}"><div class="stage">${esc(e.stage)}</div>
      <div>${cost}<div class="decision ${e.decision}">${esc(e.decision.replace(/_/g, ' '))}</div>
      <div class="reason">${esc(e.reason)}</div>${link}</div></div>`;
  }).join('');
}

// ---------------------------------------------------------------- wiring
function wire() {
  for (const b of document.querySelectorAll('[data-run]')) {
    b.onclick = () => run(b.dataset.run);
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

function toHex(s) {
  return Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function run(id) {
  if (state.running) return;
  state.running = id;
  state.feed = [];
  state.stage = null;
  render();
  fetch('/api/run?id=' + encodeURIComponent(id), { method: 'POST' });
}

// Each side sees what concerns it.
const HIDE = {
  client: new Set(['discovery', 'planning', 'comparison']),
  contractor: new Set(['revenue']),
};

const es = new EventSource('/events');
es.onopen = () => { $('live').classList.add('on'); $('livetext').textContent = 'live'; };
es.onerror = () => { $('live').classList.remove('on'); $('livetext').textContent = 'reconnecting'; };
es.onmessage = async (ev) => {
  const e = JSON.parse(ev.data);
  if (e.type === 'run_finished' || e.type === 'run_failed') {
    state.running = null;
    state.stage = null;
    await load();
    return;
  }
  if (e.type !== 'decision') return;
  state.stage = e.stage;
  state.feed.push(e);
  if (HIDE[state.role].has(e.stage)) {
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

$('as-client').onclick = () => { state.role = 'client'; render(); };
$('as-contractor').onclick = () => { state.role = 'contractor'; render(); };

load();
