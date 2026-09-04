# Kirim

**A letter of credit small enough for a S$4,000 order — because an agent reads the documents and the ledger holds the money.**

SingHacks 2026 · Ripple challenge: *AI-Native Business on XRPL*

---

## The problem

A Singapore SME orders S$4,000 of goods from a supplier in Da Nang. Three options, all bad:

| Option | Cost | Time | Protection |
|---|---|---|---|
| Telegraphic transfer | US$20–50 + 1–3% FX spread | 1–3 days | None |
| Letter of credit | % of value + fixed fees | Days of document handling | Full — but uneconomic below ~US$50,000 |
| Pay 100% upfront | "free" | Instant | None. This is what most SMEs actually do. |

A letter of credit is expensive for exactly one reason: **a human being reads the documents.** A trade finance officer checks that the bill of lading matches the purchase order, that quantities agree, that dates are consistent. That labour is why the instrument has a floor, and why every trade beneath it goes unprotected.

## What Kirim does

Replaces the officer with an agent and the issuing bank with an escrow.

```
need → discovery → decision → transaction → outcome
```

1. A buyer's agent takes the purchase order.
2. It **discovers** providers and buys only the underwriting inputs worth their price — screening, bill-of-lading verification, an FX quote — each one over **x402**, each payment settled on XRPL.
3. It **underwrites**, and either commits or declines with a reason.
4. Funds lock in **XRPL escrow under a crypto-condition**. Not a timer: only the holder of the fulfillment can release, and `CancelAfter` returns the money to the buyer if nothing is presented.
5. Documents are **examined** against the PO — quantities, ports, dates, references — and a discrepancy blocks release. That is the instrument.
6. Conforming documents release the escrow. The supplier is paid in about four seconds, not on 60-day terms.

**Remove the AI** and you need a trade finance officer, which is why this instrument does not exist below US$50k. **Remove autonomous payments** and the escrow becomes an invoice and a lawyer.

## Run it

```bash
npm install
cp .env.example .env
npm run setup          # funds four XRPL testnet wallets, writes wallets.json
npm run escrow:smoke   # THE GATE: escrow create, finish, and cancel-on-timeout
npm run dev            # ledger + market + console
npm run trade PO-2026-0418   # or open http://localhost:4000
```

`npm run escrow:smoke` is the load-bearing check. If it does not pass, nothing above it can be trusted.

### Demo scenarios

| Trade | Principal | What it shows |
|---|---|---|
| `PO-2026-0418` | US$4,000 | Documents conform. Escrow releases; supplier paid on presentation. |
| `PO-2026-0419` | US$3,200 | Packing list shows 400 against a PO for 500. **Release refused, funds retained.** |
| `PO-2026-0420` | US$2,940 | Supplier never ships. Escrow times out; **funds return automatically.** |
| `PO-2026-0421` | US$40,000 | Above the autonomous ceiling. Agent **stops and asks a human.** |
| `PO-2026-0422` | US$1,960 | Screening hit. **Declined before a cent is committed.** |

Most demos show the happy path. `0419`, `0420` and `0422` are the ones worth watching: a payment that correctly does *not* happen is what makes an autonomous payment system credible.

## Architecture

See [docs/architecture.md](docs/architecture.md). In short — four processes, one rule:

> **The agent may request a payment. Only the ledger service may send one.**

```
apps/console            static page, server-sent events, live decision log
services/orchestrator   the agent: discover, underwrite, examine, decide
services/ledger         the ONLY process holding a seed. xrpl.js, spend ceilings
services/market         x402-gated providers (simulated supply, real payments)
packages/x402           client + server middleware, one implementation
packages/trade          PO/BL/packing schemas, discrepancy rules, decision log
```

The orchestrator has no wallet and never imports `xrpl`. It asks; the ledger service decides, enforces per-call / per-trade / per-run ceilings from `.env`, signs, and returns a hash. A refusal comes back as a logged decision with a reason, never a silent no-op.

## Trust, governance and controls

The challenge brief lists seven considerations. Kirim answers them structurally, not with a settings page:

| Consideration | How |
|---|---|
| Transparency | Every step appends to a decision log with a reason string; the console renders it live |
| Authorisation | Autonomous below `HUMAN_APPROVAL_ABOVE_USD`, stops and asks above it — a threshold, not per-action approval |
| Spending controls | Per-call, per-trade and per-run ceilings enforced server-side in the only process that can sign |
| Security | The agent never holds a seed. `wallets.json` is gitignored. Testnet only. |
| Traceability | Every ledger write carries a `Memo` bound to the trade and a `SourceTag` identifying the agent |
| Failure handling | Discrepancy → funds retained. No presentation → escrow cancels itself. Ledger error → the run stops loudly rather than narrating a settlement that never happened. |
| Safeguards | Providers verify payment **on-ledger** before serving a byte; the escrow condition means Kirim cannot pay for goods that were never shipped |

## What is real and what is simulated

**Real:** every XRPL transaction. Escrow create, escrow finish against a crypto-condition, escrow cancel on timeout, and every x402 payment. Hashes are in [docs/transactions.md](docs/transactions.md) and link to the testnet explorer.

**Simulated:** the supplier, the shipping documents, the carrier registry and the screening lists are fixtures under `fixtures/`. No Da Nang exporter has an x402 endpoint this weekend.

The line matters: simulated supply is normal; a simulated payment would not be.

## Settlement currency

Kirim settles in **RLUSD**. `.env` is already pointed at the RLUSD testnet issuer
`rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV` (`RLUSD_XRPL_ISSUER_TESTNET` in
[t54-labs/rlusd-cli](https://github.com/t54-labs/rlusd-cli)), and `npm run setup`
places RLUSD trustlines on all four wallets.

**One manual step remains:** claim testnet RLUSD for the buyer at
[tryrlusd.com](https://tryrlusd.com) — sign in, pick **XRPL Testnet**, paste the
buyer address from `npm run setup`. There is no API; the official RLUSD CLI's own
`faucet fund` command says *"Open the official RLUSD faucet and claim testnet
RLUSD there."*

### Testnet scaling

The faucet allows **10 RLUSD per account per 24 hours** (and the XRP faucet caps a
wallet at 100 XRP), so a US$4,000 trade principal cannot settle at par on testnet.
The principal is divided by `SETTLEMENT_DIVISOR` (default 1000) before it touches
the ledger — US$4,000 settles as 4 RLUSD — and **every response carrying a scaled
amount says so**. The trade is never quietly shrunk and the demo never claims to
have moved four thousand of anything. Set `SETTLEMENT_DIVISOR=1` to settle at par
on a funded account.

Operating spend (x402 calls, all sub-dollar) is never scaled, so the amount each
provider verifies on-ledger is exactly the price it quoted.

### Amendment status, checked on testnet

| Amendment | Status |
|---|---|
| `TokenEscrow` | **enabled** — RLUSD escrow works |
| `Credentials` (XLS-70) | **enabled** — on-ledger KYB is available |
| `PermissionedDomains` | **enabled** |
| `PermissionedDEX` | **enabled** |
| `MPTokensV1` (XLS-33) | **enabled** |
| `Batch` | not present in the testnet feature list |

With RLUSD funded, escrow uses **TokenEscrow** and the principal settles at par.

## Builder feedback hook

Installed and registered project-scoped in `.claude/settings.json`, pointing at
`hook/agents/claude-code/stop-hook.mjs` (copied from the challenge repo). Verified
injecting — `stop-hook.mjs` exits 2 with the reflection instruction.

It fires on ~20% of turns by default. Raise it with `"sample": 1` in
`~/.xrpl-feedback-hook.json`, which also needs your team name and real name:

```bash
TEAM_NAME="<team>" HACKER_NAME="<your name>" node hook/setup.mjs --non-interactive
```

Builder feedback is 10% of the score and is graded on the stream, not a single
end-of-event recollection. Also submit the Google form near the end — both,
not either.

## The model's role

Deliberately narrow. The discrepancy rules in `packages/trade/src/examine.mjs` decide whether money moves; a model never gets a vote on that. What the model writes is the *advice* — the underwriting rationale and the discrepancy notice, in the language a trade finance desk uses.

Set `ANTHROPIC_API_KEY` to enable it. Without a key, composed text is used and the product still runs end to end — a demo must never depend on a key at venue wifi.

## Ports

`4000` console · `4010` ledger · `4020` market. If `npm run dev` reports `EADDRINUSE`, a previous run's children survived — kill whatever is listening on those ports first.
