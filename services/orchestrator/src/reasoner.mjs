/**
 * The narration layer.
 *
 * Kirim's decisions are deterministic — the rules in @kirim/works decide
 * whether money moves, and a model never gets a vote on that. What the model
 * writes is the advice a homeowner and a contractor actually read: the
 * milestone review note, in the language a site manager would use.
 *
 * Three providers, tried in order, because a hackathon should not depend on
 * which account you happen to have:
 *
 *   1. ANTHROPIC_API_KEY        — Claude, via the official SDK
 *   2. OPENAI_API_KEY           — any OpenAI-compatible chat-completions
 *                                 endpoint: OpenAI, Groq, Gemini's compat
 *                                 layer, OpenRouter, Together, or a local
 *                                 Ollama / LM Studio server via OPENAI_BASE_URL
 *   3. no key at all            — composed text, and the product still runs
 *                                 end to end
 *
 * That last one is not a placeholder, it is the demo's safety net. Venue wifi
 * fails, keys hit rate limits, and a milestone review that cannot be written
 * must never stop a payment that has already been decided.
 */

import { fmt } from '@kirim/trade';

const ANTHROPIC_MODEL = process.env.KIRIM_MODEL || 'claude-opus-5';
const OPENAI_MODEL = process.env.KIRIM_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

let anthropic = null;
let anthropicTried = false;

async function anthropicClient() {
  if (anthropicTried) return anthropic;
  anthropicTried = true;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic();
  } catch {
    anthropic = null; // SDK not installed — fall through to the next provider
  }
  return anthropic;
}

/** Which provider is actually going to write this. Surfaced in the console. */
export function reasonerProvider() {
  if (process.env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model: ANTHROPIC_MODEL };
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: OPENAI_BASE_URL.includes('api.openai.com') ? 'openai' : 'openai-compatible',
      model: OPENAI_MODEL,
      baseUrl: OPENAI_BASE_URL,
    };
  }
  return { provider: 'none', model: null, note: 'composed text — set a key to enable the model' };
}

async function askAnthropic(system, user) {
  const c = await anthropicClient();
  if (!c) return null;
  const response = await c.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: user }],
  });
  return response.content.find((b) => b.type === 'text')?.text?.trim() || null;
}

async function askOpenAiCompatible(system, user) {
  if (!process.env.OPENAI_API_KEY) return null;
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_completion_tokens: 400,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`${OPENAI_MODEL} at ${OPENAI_BASE_URL}: ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
  const body = await res.json();
  return body.choices?.[0]?.message?.content?.trim() || null;
}

async function ask(system, user, fallback) {
  for (const attempt of [askAnthropic, askOpenAiCompatible]) {
    try {
      const text = await attempt(system, user);
      if (text) return text;
    } catch (e) {
      // A model that will not answer must never block a decision that has
      // already been made. Say so once, then compose the text ourselves.
      console.warn('[reasoner] ' + e.message);
    }
  }
  return fallback;
}

const SYSTEM = [
  'You write trade finance advices for a documentary credit desk.',
  'Two to three sentences. No preamble, no bullet points, no markdown.',
  'Plain declarative English in the register a bank uses with an SME client.',
  'State the decision and the reason for it. Never invent facts not given to you.',
].join(' ');

export async function explainUnderwriting({ po, screening, outcome }) {
  const listed = screening
    ? (screening.clear
      ? `Screening against ${screening.listsChecked.join(', ')} returned no matches.`
      : `Screening returned ${screening.matches.length} potential match(es): ` +
        screening.matches.map((m) => `${m.list} at ${m.score} (${m.note})`).join('; ') + '.')
    : 'Screening was not purchased.';

  const fallback = outcome === 'approved'
    ? `Credit approved for ${fmt(po.totalCents)} in favour of ${po.supplier}. ${listed} ` +
      `Funds will be committed to escrow and released only against documents conforming to ${po.poNumber}.`
    : `Credit declined for ${fmt(po.totalCents)} in favour of ${po.supplier}. ${listed} ` +
      `No funds have been committed. The buyer should obtain manual clearance before proceeding.`;

  return ask(SYSTEM,
    `Write the underwriting advice.\n` +
    `Decision: ${outcome}\n` +
    `Buyer: ${po.buyer}\nSupplier: ${po.supplier}\n` +
    `Amount: ${fmt(po.totalCents)}\nPO: ${po.poNumber}\n` +
    `Route: ${po.portOfLoading} to ${po.portOfDischarge}\n` +
    `Screening: ${listed}\n` +
    `The instrument is an escrow released against conforming documents.`,
    fallback);
}

export async function explainDiscrepancies({ po, bl, result }) {
  const listed = result.all.length
    ? result.all.map((d) => `${d.code}: ${d.text}`).join(' ')
    : 'No discrepancies noted.';

  const fallback = `${result.verdict} ${listed}`;

  return ask(SYSTEM,
    `Write the examination advice for documents presented under ${po.poNumber}.\n` +
    `Bill of lading: ${bl.blNumber}, ${bl.vessel} voyage ${bl.voyage}, ` +
    `shipped on board ${bl.shippedOnBoardDate}.\n` +
    `Outcome: ${result.clean ? 'documents conform, release authorised' : 'documents rejected, funds retained'}\n` +
    `Findings: ${listed}\n` +
    `If rejected, state that the supplier may present corrected documents before the escrow cancel time.`,
    fallback);
}

const MS_SYSTEM = [
  'You write the milestone review note itself, addressed to the client and the',
  'contractor. Do not describe the note or refer to "the review" — just write it.',
  'Open with the finding, never with a phrase like "the notes indicate".',
  'Two to four sentences. No preamble, no bullets, no markdown, no headings.',
  'Plain English a homeowner and a contractor both understand.',
  'State the recommendation and the specific reason. Never invent findings.',
  'Never claim to have verified the construction itself — you reconcile submitted',
  'evidence against an agreed scope and report where they disagree.',
].join(' ');

export async function explainMilestone({ project, ms, sub, result }) {
  const listed = result.all.length
    ? result.all.map((f) => `${f.code} (${f.severity}): ${f.text}`).join(' ')
    : 'Nothing inconsistent found.';

  const headline = {
    ready: 'Ready for approval',
    more_info: 'More information needed',
    flagged: 'Flagged for review',
  }[result.state];

  const fallback = `${headline}. ${result.verdict} ${listed}`;

  return ask(MS_SYSTEM,
    `Write the milestone review note.\n` +
    `Recommendation: ${headline}\n` +
    `Project: ${project.name} (${project.client} / ${project.contractor})\n` +
    `Milestone: ${ms.name}, agreed ${ms.startsOn} to ${ms.dueOn}\n` +
    `Submitted: ${sub.submittedAt} with ${sub.photos.length} photograph(s)\n` +
    `Contractor's note: "${sub.note}"\n` +
    `Findings: ${listed}\n` +
    `If flagged, say what the contractor should do next. If more information is ` +
    `needed, be clear that nothing is wrong yet and name what is outstanding.`,
    fallback);
}

const PLAN_SYSTEM = [
  'You plan which paid evidence checks a construction milestone needs.',
  'Reply with JSON only: {"plan":[{"requirement":"<id>","provider":"<id>|null",',
  '"skip":true|false,"why":"<one sentence>"}]}.',
  'One entry per requirement you were given, using its exact id.',
  'Choose a provider only from that requirement\'s own list.',
  'Where a requirement lists two providers, choose on value: the dearer one is',
  'worth it only when the milestone is late and its turnaround buys real time.',
  'You may skip a requirement that is not mandatory when spending on it would',
  'establish nothing. Never skip a mandatory one.',
  'The "why" is read by a homeowner — plain English, no jargon, no markdown.',
].join(' ');

/**
 * Ask the agent what to buy. The answer is a proposal: @kirim/works validates
 * it against the catalogue, the budget and the release rules before a cent is
 * committed.
 */
export async function planEvidence({ project, ms, sub, reqs, catalog, budgetUsd, daysLate }) {
  const providerLines = catalog
    .map((p) => `  ${p.id} — ${p.name}, US$${p.price}`
      + (p.turnaroundHours ? `, ${p.turnaroundHours}h turnaround` : ''))
    .join('\n');

  const reqLines = reqs
    .map((r) => `  ${r.id} — ${r.need} `
      + `[providers: ${r.providers.join(', ')}] `
      + `[${r.mandatory ? 'mandatory' : 'discretionary'}]`
      + (r.moot ? ` [moot: ${r.mootReason}]` : ''))
    .join('\n');

  const user =
    `Milestone: ${ms.name} on ${project.name}, ${(ms.amountCents / 100).toFixed(2)} USD.\n` +
    `Agreed ${ms.startsOn} to ${ms.dueOn}; the submission arrived ${sub.submittedAt}` +
    (daysLate >= 0 ? `, ${daysLate} day(s) past the agreed date.\n` : `, inside the agreed date.\n`) +
    `Evidence budget for this milestone: US$${budgetUsd.toFixed(2)}.\n\n` +
    `Requirements:\n${reqLines}\n\nProviders available:\n${providerLines}`;

  const text = await ask(PLAN_SYSTEM, user, null);
  if (!text) return null;
  try {
    const json = JSON.parse(text.replace(/^```(?:json)?|```$/gm, '').trim());
    return Array.isArray(json.plan) ? json.plan : null;
  } catch {
    return null; // a plan we cannot parse is no plan; the validator fills in
  }
}
