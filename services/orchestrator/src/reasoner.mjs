/**
 * The narration layer.
 *
 * Kirim's decisions are deterministic — the discrepancy rules in
 * @kirim/trade decide whether funds move, and a model never gets a vote on
 * that. What the model does is write the advice: the underwriting rationale
 * and the discrepancy notice, in the language a trade finance officer would
 * use, which is the part a buyer and a supplier actually read.
 *
 * With no ANTHROPIC_API_KEY set, every function here falls back to composed
 * text and the product still runs end to end. Mock-first on purpose: a demo
 * must never depend on a key at the venue wifi.
 */

import { fmt } from '@kirim/trade';

const MODEL = process.env.KIRIM_MODEL || 'claude-opus-5';
let client = null;
let clientTried = false;

async function getClient() {
  if (clientTried) return client;
  clientTried = true;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic();
  } catch {
    client = null; // SDK not installed — deterministic path is fine
  }
  return client;
}

async function ask(system, user, fallback) {
  const c = await getClient();
  if (!c) return fallback;
  try {
    const response = await c.messages.create({
      model: MODEL,
      max_tokens: 1000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = response.content.find((b) => b.type === 'text')?.text?.trim();
    return text || fallback;
  } catch {
    return fallback;
  }
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
  'You write milestone review notes for a construction payment platform.',
  'Two to four sentences. No preamble, no bullets, no markdown.',
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
