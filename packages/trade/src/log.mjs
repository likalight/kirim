/**
 * The decision log. This is a submission deliverable — "explain the agent's
 * decision-making" — not debug output. Append-only, one reason per entry.
 */
export class DecisionLog {
  constructor(tradeId, sink = () => {}) {
    this.tradeId = tradeId;
    this.entries = [];
    this.sink = sink;
  }
  add(stage, decision, reason, extra = {}) {
    const e = { at: new Date().toISOString(), tradeId: this.tradeId, stage, decision, reason, ...extra };
    this.entries.push(e);
    this.sink(e);
    return e;
  }
  spentCents() {
    return this.entries.filter((e) => e.costCents).reduce((a, e) => a + e.costCents, 0);
  }
}
