# Kirim — working rules

Micro letter-of-credit for ASEAN SME trade. RLUSD escrow on XRPL, documents
examined by an agent, x402 for the agent's own paid inputs.

## Invariants (do not violate to make a test pass)

1. **Testnet only.** Never point at mainnet. Never commit a seed.
2. **The agent may request a payment. Only `services/ledger` may send one.**
   The orchestrator never holds a wallet seed and never calls xrpl.js directly.
3. **Spend ceilings are enforced in the ledger service**, from env, server-side.
   Never widen a ceiling to make something pass — log the refusal instead.
4. **Every ledger write carries** a `Memo` binding it to the trade id and a
   `SourceTag` identifying the agent (`AGENT_SOURCE_TAG`).
5. **Every payment received by a provider is verified on-ledger** (amount,
   destination, memo, validated) before a single byte of data is served.
6. **Every decision appends to the trade's decision log** with a reason string.
   The log is a submission deliverable, not debug output.
7. **Every hash goes into `docs/transactions.md`** as it happens.

## Anti-patterns from the challenge brief

- Do not require a human to approve each agent action. Approval fires only
  above `HUMAN_APPROVAL_ABOVE_USD`.
- Do not simulate a payment. Supply may be simulated; the ledger may not.
- No EVM sidechain, no other chain.

## Stack

Node 20+, ESM, npm workspaces, `xrpl` v4. No TypeScript, no bundler, no Docker —
a judge must be able to clone and run in two minutes.
