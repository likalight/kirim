# Kirim — architecture

## The rule the whole design hangs on

> **The agent may request a payment. Only the ledger service may send one.**

The orchestrator has no seed and never imports `xrpl`. Every movement of money is
an HTTP request to a process that owns the keys, enforces the ceilings, and can
say no. This single split answers most of the challenge's governance criteria
without a settings page.

## Processes

```
                        ┌───────────────────────────────┐
   buyer's request ────▶│  services/orchestrator        │
                        │  the agent                    │
                        │  discover · underwrite ·      │
                        │  examine · decide             │
                        │  (holds NO seed)              │
                        └───┬───────────────────┬───────┘
                            │ x402              │ pay / escrow
                            │ (fetchWithPayment)│ (never signs)
                            ▼                   ▼
            ┌───────────────────────┐   ┌────────────────────────────┐
            │ services/market       │   │ services/ledger            │
            │ x402-gated providers  │   │ THE ONLY SEED HOLDER       │
            │  · screening   $0.05  │   │  · SpendPolicy ceilings    │
            │  · doc-verify  $0.12  │   │  · Payment                 │
            │  · fx-quote    $0.02  │   │  · EscrowCreate/Finish/    │
            │  · credit rpt  $4.50  │   │    Cancel + condition      │
            │    (over ceiling)     │   │  · verifyTx                │
            └───────────┬───────────┘   └─────────────┬──────────────┘
                        │ GET /tx?hash=…              │
                        │ verify ON-LEDGER before     │  xrpl.js
                        │ serving a byte              │  (wss)
                        └──────────────┬──────────────┘
                                       ▼
                        ┌──────────────────────────────┐
                        │      XRP Ledger — Testnet    │
                        │  Payment · EscrowCreate ·    │
                        │  EscrowFinish (fulfillment)· │
                        │  EscrowCancel (timeout)      │
                        │  RLUSD via TokenEscrow       │
                        └──────────────────────────────┘

   apps/console  ◀── server-sent events ── orchestrator
   (live decision log, spend ledger, explorer links)
```

## The commercial loop, twice

The challenge's loop is *need → discovery → decision → transaction → outcome*.
Kirim runs it at two scales, nested:

**Inner loop — the agent buys its own inputs.**
Discovery is `GET /v1/catalog`. Each provider answers an unpaid request with
`402` and a price. The agent decides which are worth buying, pays over XRPL,
and retries with proof. The over-priced provider is declined by the ceiling and
the refusal is logged with its reason.

**Outer loop — the trade itself.**
The underwriting decision commits the principal into escrow, documents are
examined, and the escrow releases, is withheld, or cancels itself.

## The instrument

Escrow here is not a timer. `EscrowCreate` carries a **PREIMAGE-SHA-256
crypto-condition**; only the holder of the fulfillment can call `EscrowFinish`.
Kirim (the `platform` wallet) holds it and releases only on conforming
documents. `CancelAfter` returns the funds to the buyer with no dispute process.

Conditions are hand-encoded in `services/ledger/src/conditions.mjs` — no extra
dependency:

```
condition   = A0 25 80 20 <sha256(preimage)> 81 01 <cost>
fulfillment = A0 22 80 20 <preimage>
```

`EscrowFinish` fee is base × (33 + fulfillment_bytes/16), set explicitly.

## Document examination

`packages/trade/src/examine.mjs` — deterministic, stated in trade-finance
language, and the sole authority on whether money moves:

| Code | Severity | Check |
|---|---|---|
| `REF-MISMATCH` | blocking | BL quotes a different PO |
| `PORT-LOADING` / `PORT-DISCHARGE` | blocking | Ports differ from the PO |
| `LATE-SHIPMENT` | blocking | Shipped after the latest shipment date |
| `QTY-SHORT` | blocking | BL quantity below the PO |
| `QTY-INCONSISTENT` | blocking | Packing list disagrees with the BL |
| `QTY-ABSENT` | blocking | An ordered SKU is missing from a document |
| `GOODS-EXTRA` | advisory | Shipped but not ordered |
| `CONSIGNEE` | advisory | Consignee is not the buyer |

Any blocking discrepancy holds the funds. A model narrates the finding; it does
not overrule it.

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
| `MAX_PER_TRADE_USD` | operating spend within a trade | 250.00 |
| `MAX_PER_RUN_USD` | operating spend for the process | 500.00 |
| `HUMAN_APPROVAL_ABOVE_USD` | trade principal | 5,000.00 |

Trade principal is bounded by the approval threshold, not the per-call ceiling —
an escrow is not an operating expense. Above the threshold the agent stops and
asks, which is a safeguard rather than the per-action approval the brief calls an
anti-pattern.

## Not yet built

Named honestly, in the order they should be added:

- **Credentials (XLS-70) / PermissionedDomains** — KYB attestation on-ledger so
  only credentialed counterparties can be paid. Currently screening is a signed
  off-ledger attestation from the market service.
- **Batch** — supplier, inspector and platform fee settling atomically.
- **XRPL DEX conversion** — the FX leg is quoted but not executed.
- **Agent credit** (claw.credit / t54) — so the buyer draws credit instead of
  pre-funding the escrow. This is the step that turns the demo into trade
  finance.
