import { toCents, fmt } from '@kirim/trade';

/**
 * Spend ceilings. These live here, in the only process that holds a seed,
 * and they are checked before signing. The agent can ask for anything; it
 * cannot make this service send it.
 *
 * A refusal is a logged decision with a reason, never a silent no-op.
 */
export class SpendPolicy {
  constructor(env = process.env) {
    this.perCall = toCents(env.MAX_PER_CALL_USD ?? 1);
    this.perTrade = toCents(env.MAX_PER_TRADE_USD ?? 250);
    this.perRun = toCents(env.MAX_PER_RUN_USD ?? 500);
    this.approvalAbove = toCents(env.HUMAN_APPROVAL_ABOVE_USD ?? 5000);
    this.runSpent = 0;
    this.tradeSpent = new Map();
  }

  check({ amountCents, tradeId, kind }) {
    // Escrow funding is the trade principal, not an operating expense: it is
    // bounded by the approval threshold, not by the per-call ceiling.
    if (kind === 'escrow') {
      if (amountCents > this.approvalAbove) {
        return { ok: false, needsApproval: true,
          reason: `Trade principal ${fmt(amountCents)} exceeds the autonomous ceiling of ${fmt(this.approvalAbove)}. Human authorisation required.` };
      }
      return { ok: true };
    }

    if (amountCents > this.perCall) {
      return { ok: false, reason: `Single call ${fmt(amountCents)} exceeds the per-call ceiling of ${fmt(this.perCall)}.` };
    }
    const t = this.tradeSpent.get(tradeId) ?? 0;
    if (t + amountCents > this.perTrade) {
      return { ok: false, reason: `Trade ${tradeId} has spent ${fmt(t)}; ${fmt(amountCents)} more would exceed the per-trade ceiling of ${fmt(this.perTrade)}.` };
    }
    if (this.runSpent + amountCents > this.perRun) {
      return { ok: false, reason: `Run has spent ${fmt(this.runSpent)}; ${fmt(amountCents)} more would exceed the per-run ceiling of ${fmt(this.perRun)}.` };
    }
    return { ok: true };
  }

  record({ amountCents, tradeId, kind }) {
    if (kind === 'escrow') return;
    this.runSpent += amountCents;
    this.tradeSpent.set(tradeId, (this.tradeSpent.get(tradeId) ?? 0) + amountCents);
  }

  snapshot() {
    return {
      runSpentCents: this.runSpent,
      perCallCents: this.perCall,
      perTradeCents: this.perTrade,
      perRunCents: this.perRun,
      approvalAboveCents: this.approvalAbove,
    };
  }
}
