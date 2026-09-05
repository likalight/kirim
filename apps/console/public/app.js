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
const ME = () => (state.role === 'client' ? state.project?.clientRole : state.project?.contractorRole)
  || (state.role === 'client' ? 'Client' : 'Contractor');
const THEM = () => ((state.role === 'client' ? state.project?.contractorRole : state.project?.clientRole)
  || (state.role === 'client' ? 'Contractor' : 'Client')).toLowerCase();

const state = {
  view: 'demo',
  role: 'client',
  project: null,
  milestones: {},
  record: null,
  pending: [],
  providers: [],
  wallets: null,
  wallets0: null,
  held: [],
  reasoner: null,
  running: null,
  stage: null,
  feed: [],
};

const STATUS_WORDS = {
  client: {
    released: 'paid', flagged: 'needs your review', more_info: 'waiting on {them}',
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
  demo: 'M3 2 l10 6 l-10 6 z',
  milestones: 'M2 3 h12 M2 8 h12 M2 13 h7',
  system: 'M8 5.2 a2.8 2.8 0 1 0 0 5.6 a2.8 2.8 0 0 0 0-5.6 M8 1.5 v2 M8 12.5 v2 M1.5 8 h2 M12.5 8 h2',
};

const VIEWS = [
  ['demo', 'Demo', 'watch the money move'],
  ['milestones', 'Every stage', 'what passed, what did not'],
  ['system', 'How it is built', 'wallets, limits, transactions'],
];

// ---------------------------------------------------------------- data
async function load() {
  const [project, st, record, pending, providers, wallets, reasoner, held] = await Promise.all([
    fetch('/api/project').then((r) => r.json()),
    fetch('/api/state').then((r) => r.json()).catch(() => ({ milestones: {} })),
    fetch('/api/record').then((r) => r.json()).catch(() => null),
    fetch('/api/pending').then((r) => r.json()).catch(() => ({ pending: [] })),
    fetch('/api/providers').then((r) => r.json()).catch(() => ({ providers: [] })),
    fetch('/api/wallets').then((r) => r.json()).catch(() => null),
    fetch('/api/reasoner').then((r) => r.json()).catch(() => null),
    fetch('/api/held').then((r) => r.json()).catch(() => ({ held: [] })),
  ]);
  Object.assign(state, {
    project, milestones: st.milestones || {}, record,
    pending: pending.pending || [], providers: providers.providers || [],
    wallets, reasoner, held: held.held || [],
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
    b.onclick = () => { state.view = b.dataset.view; render(); };
  }
  $('as-client').setAttribute('aria-pressed', state.role === 'client');
  $('as-contractor').setAttribute('aria-pressed', state.role === 'contractor');
  if (state.project) {
    $('as-client').textContent = state.project.clientRole || 'Client';
    $('as-contractor').textContent = state.project.contractorRole || 'Contractor';
    $('as-client').title = 'See this as ' + state.project.client;
    $('as-contractor').title = 'See this as ' + state.project.contractor;
  }
}

function head(title, sub, meta) {
  return `<div class="head"><div><h2>${esc(title)}</h2>
    <div class="sub">${sub}</div></div>
    <div class="meta">${meta || ''}</div></div>`;
}

function render() {
  renderNav();
  const fn = { demo: viewDemo, milestones: viewMilestones, system: viewSystem }[state.view]
    || viewDemo;
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
 *   Demo       what this is, and the money moving while you watch
 *   Milestones every stage, and why each one passed or failed
 *   System     the wallets, the providers, the limits, the proof
 *
 * There were eight. Everything the other five held is still here, folded into
 * the screen it belonged to. Somebody seeing this for the first time should not
 * have to learn a navigation bar before they can see what the product does.
 */
const ACTS = [
  { n: 1, id: 'M1', title: 'It pays on its own',
    line: 'The foundation evidence is good. Nobody approves anything. Watch the two balances swap.' },
  { n: 2, id: 'M4', title: 'It refuses to pay',
    line: 'The fit-out claim is only 72% done, has a critical defect, and reuses a photo from the foundation. Her money leaves — and stops.' },
  { n: 3, id: 'M4', title: 'It pays once the work is fixed', rework: true,
    line: 'The builder repairs the defect and sends new evidence. The same locked money releases. She is not charged twice.' },
];

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
    ${moved ? `<div class="delta">${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)} this run</div>`
      : `<div class="sub">${esc(sub)}</div>`}
    ${w ? `<a class="addr" href="https://testnet.xrpl.org/accounts/${esc(w.address)}"
      target="_blank" rel="noopener">${esc(w.address.slice(0, 16))}… &#8599;</a>` : ''}
  </div>`;
}

function viewDemo() {
  const p = state.project;
  const t = totals();
  const lockedCents = state.held.reduce((a, h) => a + (h.amountCents || 0), 0);
  const heldIds = new Set(state.held.map((h) => h.milestone));

  const acts = ACTS.map((a) => {
    const st = state.milestones[a.id];
    const isHeld = heldIds.has(a.id);
    const ready = a.rework ? isHeld : true;
    const done = a.rework ? (st?.status === 'released' && !isHeld)
      : a.n === 2 ? isHeld : st?.status === 'released';
    return `<button class="act ${done ? 'done' : ''} ${ready ? '' : 'waiting'}"
        data-run="${a.id}" ${state.running || !ready ? 'disabled' : ''}>
      <span class="n">${a.n}</span>
      <span class="body"><span class="t">${esc(a.title)}</span>
        <span class="l">${esc(a.line)}</span></span>
      <span class="go">${done ? 'done' : ready ? (a.rework ? 'resubmit' : 'run it') : 'do 2 first'}</span>
    </button>`;
  }).join('');

  return `<div class="explain">
      <h2>${esc(p.client)} is paying for an apartment that does not exist yet.</h2>
      <p>She bought <strong>${esc(p.name)}</strong> off-plan from ${esc(p.contractor)}.
        Normally her bank hands the developer the entire mortgage on day one, and a local official
        decides when each stage of construction has earned its share. That is the arrangement that
        left millions of homes in China unfinished.</p>
      <p class="big"><strong>Kirim locks her money on a public ledger instead — one construction
        stage at a time — and releases each stage only when the evidence proves it was built.</strong>
        An agent checks that evidence. No official, no site visit, no waiting.</p>
    </div>`
    + `<h3 class="sec">The money right now — these are live balances on the XRP Ledger</h3>`
    + `<div class="wallets">
        ${walletCard('buyer', p.client + ' · the buyer', 'her mortgage, waiting to be earned')}
        <div class="wc lock"><div class="lbl">Locked, going nowhere</div>
          <div class="bal">${(lockedCents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}<span class="ccy">${esc(cur())}</span></div>
          <div class="sub">${state.held.length
            ? state.held.length + ' stage(s) held back — the evidence did not add up'
            : 'nothing is being held back right now'}</div>
          <div class="addr">nobody can move this — not her, not him, not us</div></div>
        ${walletCard('supplier', p.contractor + ' · the builder', 'paid only when a stage checks out')}
      </div>`
    + `<p class="cap">Click either address and check the balance yourself. Every figure on this page is
       a real transaction on a public ledger.</p>`
    + `<h3 class="sec">Watch it happen — run these in order</h3><div class="acts">${acts}</div>`
    + (state.pending.length && state.role === 'client' ? actionHtml() : '')
    + `<h3 class="sec">What the agent is doing${state.running ? ' — running now' : ''}</h3>`
    + pipelineHtml()
    + `<div class="split"><div class="feed" id="feed">${feedHtml()}</div>
        <div>
          <dl class="tiles">
            <div><dt>Released so far</dt><dd>${money(t.paid)}</dd>
              <small>the evidence checked out</small></div>
            <div><dt>Held back</dt><dd>${money(t.held)}</dd>
              <small>the evidence did not</small></div>
            <div><dt>Cost of checking</dt><dd>${money2(t.evidence)}</dd>
              <small>paid to independent providers</small></div>
            <div><dt>Kirim's fee</dt><dd>${money2(t.fees)}</dd>
              <small>0.8%, and only on release</small></div>
          </dl>
          <div class="panel"><h4>What you are looking at</h4>
            <div class="row"><span>network</span><span>XRP Ledger testnet</span></div>
            <div class="row"><span>stages paid in</span><span>${esc(state.wallets?.escrow ?? '—')}</span></div>
            <div class="row"><span>evidence paid in</span><span>${esc(state.wallets?.payments ?? '—')}</span></div>
            <div class="row"><span>ledger writes</span><span>${t.tx}</span></div>
            <p class="pnote">Fixed rules decide whether money moves. The language model only writes the
              sentence explaining the decision — it never makes it.</p>
          </div>
        </div></div>`;
}

function milestoneListHtml() {
  const isClient = state.role === 'client';
  const heldIds = new Set(state.held.map((h) => h.milestone));
  return state.project.milestones.map((m) => {
    const s = state.milestones[m.id] || { status: 'unknown' };
    const canRedo = heldIds.has(m.id);
    const line = (isClient ? {
      released: 'The evidence matched what was agreed. Paid in seconds.',
      flagged: 'Something does not add up. Your money is still locked.',
      more_info: 'The {them} has not sent enough yet. Nothing is wrong.',
      awaiting_client: 'Above the limit you set — Kirim will not release it without you.',
      returned: 'Nothing was ever delivered. Your money came back on its own.',
    } : {
      released: 'Paid on presentation.',
      flagged: 'Held — the evidence contradicts what was agreed.',
      more_info: 'Send what is missing and it releases.',
      awaiting_client: 'Everything checked out. Waiting on the {them} to sign.',
      returned: 'Expired without a submission.',
    })[s.status] || m.scenario || '';
    const say = line.replace('{them}', THEM());
    return `<button class="ms ${s.status}" data-run="${m.id}" ${state.running ? 'disabled' : ''}>
      <span class="bar"></span>
      <span class="body"><span class="top"><span class="id">${m.id}</span>
        <span class="nm">${esc(m.name)}</span></span>
        <div class="sc">${esc(say)}</div>
        ${canRedo ? '<div class="redo">the money is still locked — click to send corrected evidence</div>' : ''}</span>
      <span class="right"><div class="amt">${money(m.amountCents)}</div>
        <div class="pill ${s.status}">${esc((STATUS_WORDS[state.role][s.status] || s.status).replace('{them}', THEM()))}</div></span>
    </button>`;
  }).join('');
}

const RULES = [
  ['PHOTO-GEO', 'blocking', 'Photograph taken outside the site boundary'],
  ['PHOTO-TIME', 'blocking', 'Timestamp precedes the stage, or postdates the submission'],
  ['PHOTO-REUSED', 'blocking', 'Byte-identical to a photograph already paid for'],
  ['PHOTO-TAMPERED', 'blocking', 'Forensics found re-encoding after capture'],
  ['MATERIALS-SHORT', 'blocking', 'Delivered quantity below the bill of quantities'],
  ['DELIVERY-UNVERIFIED', 'blocking', "Delivery note absent from the supplier's own records"],
  ['INSPECT-INCOMPLETE', 'blocking', 'Independent inspection below the release threshold'],
  ['DEFECT-CRITICAL', 'blocking', 'Critical defect still open at inspection'],
  ['PERMIT-MISSING', 'blocking', 'Required permit reference not provided'],
  ['SEQ-INCOMPLETE', 'blocking', 'A stage this one depends on has not been released'],
  ['EVIDENCE-THIN', 'missing', 'Fewer photographs than the stage requires'],
  ['INSPECTION-NORESULT', 'missing', 'The inspection returned no completion figure'],
  ['LATE', 'advisory', 'Submitted after the agreed date — recorded, not blocking'],
];

const sevPill = (sev) => sev === 'blocking' ? 'flagged' : sev === 'missing' ? 'more_info' : 'unknown';

function viewMilestones() {
  const isClient = state.role === 'client';
  const found = [];
  for (const m of state.project.milestones) {
    for (const f of (state.milestones[m.id]?.findings || [])) found.push({ m: m.id, ...f });
  }

  return head('Every stage',
    `The apartment is paid for in ${state.project.milestones.length} pieces. Each piece holds its own `
    + 'money and releases on its own evidence. Click any stage to run it.',
    `${money(state.project.totalCents)} in total`)
  + milestoneListHtml()
  + (state.pending.length && isClient ? actionHtml() : '')
  + (found.length ? `<h3 class="sec">What the agent found, stage by stage</h3><table>
      <tr><th>Stage</th><th>Code</th><th>Severity</th><th>What it found</th></tr>` +
      found.map((f) => `<tr><td class="mono">${f.m}</td><td class="mono">${esc(f.code)}</td>
        <td><span class="pill ${sevPill(f.severity)}">${esc(f.severity)}</span></td>
        <td>${esc(f.text)}</td></tr>`).join('') + '</table>' : '')
  + `<h3 class="sec">The thirteen checks it runs every time</h3>
     <p class="cap">A photograph on its own proves nothing. One with a timestamp and a GPS fix can be
     checked. Kirim never claims to have verified a building — it reconciles what was submitted
     against what was agreed, and says where the two disagree.</p>
     <table><tr><th>Code</th><th>Severity</th><th>Check</th></tr>` +
    RULES.map(([c, sev, d]) => `<tr><td class="mono">${c}</td>
      <td><span class="pill ${sevPill(sev)}">${sev}</span></td>
      <td>${esc(d)}</td></tr>`).join('') + '</table>'
  + `<p class="note"><strong>Blocking</strong> holds the money. <strong>Missing</strong> asks for more
     and marks nothing against the ${esc(THEM())}. "You did not send enough" and "what you sent does
     not add up" are different messages, and only the second should ever count against somebody.</p>`
  + `<h3 class="sec">Activity</h3><div class="feed" id="feed">${feedHtml()}</div>`;
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
  state.feed = [];
  state.stage = null;
  // Freeze the opening balances so the deltas mean "since this run started".
  state.wallets0 = state.wallets ? JSON.parse(JSON.stringify(state.wallets)) : null;
  render();
  fetch('/api/run?id=' + encodeURIComponent(id), { method: 'POST' });
  clearInterval(balanceTimer);
  balanceTimer = setInterval(refreshWallets, 2500);
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
