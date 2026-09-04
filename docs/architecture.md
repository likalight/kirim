# Kirim — architecture

## The rule the whole design hangs on

> **The agent may request a payment. Only the ledger service may send one.**

The orchestrator holds no seed and never imports `xrpl`. Every movement of money
is an HTTP request to a process that owns the keys, enforces the ceilings, and
can say no. That single split answers most of the challenge's governance
criteria without a settings page.

## Processes

```
   client's milestone ──▶┌────────────────────────────────┐
                         │  services/orchestrator         │
                         │  the milestone agent           │
                         │  discover · buy · examine ·    │
                         │  decide                        │
                         │  (holds NO seed)               │
                         └───┬────────────────────┬───────┘
                             │ x402               │ escrow / pay / credential
                             │ fetchWithPayment   │ (never signs)
                             ▼                    ▼
        ┌────────────────────────────┐   ┌──────────────────────────────┐
        │ services/market            │   │ services/ledger              │
        │ x402-gated evidence        │   │ THE ONLY SEED HOLDER         │
        │  · photo forensics  $0.08  │   │  · SpendPolicy ceilings      │
        │  · materials reg.   $0.10  │   │  · Payment                   │
        │  · site inspection  $0.30  │   │  · EscrowCreate/Finish/      │
        │  · credit report    $4.50  │   │    Cancel + crypto-condition │
        │    (over the ceiling)      │   │  · CredentialCreate/Accept   │
        └───────────┬────────────────┘   │  · verifyTx                  │
                    │ GET /tx?hash=…     └───────────────┬──────────────┘
                    │ verify ON-LEDGER                   │ xrpl.js (wss)
                    │ before serving a byte              │
                    └──────────────┬─────────────────────┘
                                   ▼
                    ┌──────────────────────────────────┐
                    │       XRP Ledger — Testnet       │
                    │  EscrowCreate · EscrowFinish     │
                    │  EscrowCancel · Payment          │
                    │  CredentialCreate / Accept       │
                    │  RLUSD via TokenEscrow           │
                    └──────────────────────────────────┘

   apps/console  ◀── server-sent events ── orchestrator
   (live decision log, every reason and hash as it happens)
```

## The commercial loop, twice

The challenge's loop is *need → discovery → decision → transaction → outcome*.
Kirim runs it at two scales, nested.

**Inner loop — the agent buys its own evidence.**
Discovery is `GET /v1/catalog`. Each provider answers an unpaid request with
`402` and a price. The agent buys photo forensics, the materials registry check
and an independent inspection, and **declines the US$4.50 credit report**
because it exceeds the per-call ceiling. The refusal is logged with its reason.

**Outer loop — the milestone itself.**
The client's money is escrowed, the evidence is examined against the agreed
scope, and the escrow releases, is held, or cancels itself.

## The instrument

Escrow here is not a timer. `EscrowCreate` carries a **PREIMAGE-SHA-256
crypto-condition**; only the holder of the fulfillment can call `EscrowFinish`.
Kirim (the `platform` wallet) holds it and releases only on conforming evidence.
`CancelAfter` returns the funds to the client with no dispute process.

Conditions are hand-encoded in `services/ledger/src/conditions.mjs` — no extra
dependency:

```
condition   = A0 25 80 20 <sha256(preimage)> 81 01 <cost>
fulfillment = A0 22 80 20 <preimage>
```

`EscrowFinish` fee is base × (33 + fulfillment_bytes/16), set explicitly.

**No `FinishAfter`.** The condition is the gate, so a time gate adds nothing —
and a `FinishAfter` only seconds ahead is racy: the ledger can close past it
before the transaction is validated, and rippled reports that as
`tecNO_PERMISSION` rather than anything about timing. Measured on testnet:
`+2s` fails, `+60s` succeeds, omitted succeeds.

## Evidence examination

`packages/works/src/examine.mjs` — deterministic, and the sole authority on
whether money moves. Three outcomes, because a site manager thinks in three:

| Outcome | Meaning | Effect |
|---|---|---|
| `ready` | Evidence is consistent with the agreed scope | Release, subject to the ceiling |
| `more_info` | Evidence is incomplete; nothing contradicts the scope | Funds held, **no mark on the record** |
| `flagged` | Evidence contradicts the scope | Funds held, discrepancy named, client reviews |

Severities map onto that: any `blocking` finding gives `flagged`, any `missing`
finding alone gives `more_info`, `advisory` findings are recorded and do not
hold funds.

That distinction is the point. Collapsing "you did not send enough" into the
same rejection as "what you sent does not add up" punishes the honest
contractor who forgot a photograph.

## The track record

Every release issues an **XLS-70 Credential** to the contractor's own account:

```
CredentialCreate   issuer  = platform, subject = contractor,
                   type    = KIRIM:<projectId>:<milestoneId>
                   uri     = kirim:milestone/<project>/<milestone>/<slug>?onTime=1
CredentialAccept   the contractor's own wallet accepts it
```

A credential is keyed by `(issuer, subject, type)` and the type carries the
milestone, so issuance is **idempotent by construction** — `tecDUPLICATE` means
the milestone is already recorded, which is the right outcome, not a failure.
Re-running the demo cannot inflate a track record.

## x402

`packages/x402` implements both sides once.

- **Unpaid** → `402` with `{scheme, network, resource, maxAmountRequired, asset, payTo, nonce}`.
- **Paid** → `X-PAYMENT: base64({txHash})`, and the server resolves that hash
  **on the ledger** and checks validated, `tesSUCCESS`, destination, amount and
  currency before serving anything. Hashes are single-use.

Reconcile the wire format against `xrpl-x402.t54.ai` before submission — it is
deliberately kept in one file to make that a small change.

## Spend controls

`services/ledger/src/policy.mjs`, from `.env`:

| Ceiling | Applies to | Default |
|---|---|---|
| `MAX_PER_CALL_USD` | one x402 call | 1.00 |
| `MAX_PER_TRADE_USD` | operating spend within a milestone | 5.00 |
| `MAX_PER_RUN_USD` | operating spend for the process | 500.00 |
| `HUMAN_APPROVAL_ABOVE_USD` | **release** of a milestone | 12,000.00 |

Note where the approval ceiling sits. **Funding** an escrow only moves money
into protection, so no ceiling applies there. **Releasing** it is the
irreversible act, so that is where the client is asked. Below the ceiling the
agent releases on its own; above it, the evidence is examined and the payment
waits for authorisation.

## Two verticals, one engine

`packages/works` (construction milestones) and `packages/trade` (cross-border
document credits) are two rule sets over the same ledger service, x402 layer and
escrow instrument. `npm run milestone all` and `npm run trade PO-2026-0418` both
run end to end. That is the reachability argument made rather than claimed.

## Not yet built

Named honestly, in the order they should be added:

- **PermissionedDomains** — restrict the market to credentialed contractors.
- **XRPL DEX** — the FX leg is quoted but not executed.
- **Agent credit** (claw.credit / t54) — so the client draws credit rather than
  pre-funding each milestone.
- **Batch** — not present in the testnet feature list at time of writing.
