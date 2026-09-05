# Kirim — architecture

> **A note on names.** The ledger service knows four roles: `buyer`, `supplier`,
> `inspector`, `platform`. This document calls the first two *client* and
> *contractor*, because those are the generic names for the two sides of a
> milestone contract. In the demo scenario — an apartment block being built in
> Tangerang, Indonesia — they are **the owner** (Mentari Group, whose money is
> escrowed) and **the builder** (Gedung Jaya, paid against construction stages).
> The mechanism is the same either way; `fixtures/project.json` sets the wording.

## Against the challenge's commercial flow

The challenge draws the loop as seven steps. Kirim runs all of them, and runs
them **twice** — nested, because the agent has to buy things in order to decide
whether the trade itself should settle.

```
   THE CHALLENGE'S FLOW              KIRIM'S STAGES (from one real run)

   Customer Need               ───▶  MILESTONE  opened
                                     scope, amount, agreed dates, required
                                     evidence, the client's own budget
                                     and release ceiling
            ↓                        ESCROW     funded
                                     the principal is committed before work
                                     starts — nobody can spend it, including us

   Agent Understands           ───▶  SUBMISSION received
   the Objective                     PLANNING   planned
                                     what must be ESTABLISHED, derived from the
                                     milestone's terms and what was actually
                                     presented

            ↓
   Discover / Compare          ───▶  DISCOVERY  surveyed
   Services                          8 providers: price, turnaround,
                                     reliability, availability

            ↓
   Agent Selects an            ───▶  PLANNING   planned
   Appropriate Option                one provider per requirement, skips what
                                     would establish nothing, declines what
                                     breaches the ceiling

            ↓
   Agentic Payment             ───▶  PURCHASE   bought  (x3, over MPP)
   (x402 / MPP)                      PURCHASE   declined (over the per-call cap)

            ↓
   XRPL Transaction /          ───▶  EXAMINATION released / withheld / held
   Settlement                        SETTLEMENT released
                                     REVENUE    charged

            ↓
   Product, Service            ───▶  RECORD     credentialed
   or Value Delivered                OUTCOME    complete
                                     verdict, an on-ledger credential the
                                     contractor keeps, and what it cost against
                                     the human baseline
```

**The order differs deliberately.** The escrow is funded *before* discovery,
because the client commits the principal at the start of a milestone and the
agent then spends its own small budget establishing whether that principal
should be released. Two loops:

- **inner** — the agent's own commerce: need evidence → discover → compare →
  select → pay over MPP → receive data. This is the challenge's flow exactly.
- **outer** — the trade: money committed → evidence examined → released, held,
  or returned.

**And sometimes the decision is no.** Three of the six demo milestones end with
no payment to the contractor: held for more information, flagged for a
contradiction, or timed out and returned. The challenge's diagram has no branch
for an agent deciding *not* to transact. Kirim's does, and each one is a
deliberate outcome with a recorded reason.

---

## The rule the whole design hangs on

> **The agent may request a payment. Only the ledger service may send one.**

The orchestrator holds no seed and never imports `xrpl`. Every movement of money
is an HTTP request to a process that owns the keys, enforces the ceilings, and
can say no.

## Processes

```
   client's milestone ──▶┌────────────────────────────────┐
                         │  services/orchestrator         │
                         │  the milestone agent           │
                         │  plan · buy · examine · decide │
                         │  (holds NO seed)               │
                         └───┬────────────────────┬───────┘
                             │ /buy               │ escrow · credential
                             │ (asks; never signs)│ (asks; never signs)
                             ▼                    ▼
        ┌────────────────────────────┐   ┌──────────────────────────────┐
        │ services/market            │   │ services/ledger              │
        │ MPP-gated evidence         │   │ THE ONLY SEED HOLDER         │
        │  · photo forensics  $0.08  │   │  · SpendPolicy ceilings      │
        │  · materials reg.   $0.10  │   │  · MPP buyer (holds the seed)│
        │  · inspection       $0.30  │   │  · Claw Credit, when enabled │
        │  · inspection XPR   $0.55  │   │  · Payment · Escrow* ·       │
        │  · credit report    $4.50  │   │    Credential* · TrustSet    │
        │    (over the ceiling)      │   │  · simulate before signing   │
        │  /v1/health: availability  │   │  · verifyAuthorisation       │
        │    and reliability         │   └───────────────┬──────────────┘
        └───────────┬────────────────┘                   │ xrpl.js (wss)
                    │ MPP 402 challenge                   │
                    │ settled + verified on-ledger        │
                    └──────────────┬──────────────────────┘
                                   ▼
                    ┌──────────────────────────────────┐
                    │       XRP Ledger — Testnet       │
                    │  EscrowCreate · EscrowFinish     │
                    │  EscrowCancel · Payment          │
                    │  CredentialCreate / Accept       │
                    │  TrustSet · RLUSD via TokenEscrow│
                    └──────────────────────────────────┘

   apps/console  ◀── server-sent events ── orchestrator
   (live decision log; the client signs above-ceiling releases here)
```

## Planning

`packages/works/src/plan.mjs`. The agent does not run a fixed pipeline.

`requirements({ ms, sub, daysLate, prefs })` derives what must be established
from the milestone's own terms and the submission in front of it. A requirement
is **mandatory** when the release rules block without it, and **moot** when the
evidence cannot help — forensics on zero photographs establishes nothing.

The model proposes a plan; `validatePlan` constrains it before a cent is
committed. It may not invent a provider, exceed the client's evidence budget, or
drop a mandatory requirement. Every correction is logged.

Two decisions are deliberately **not** the model's:

- **The deadline.** Where lateness settles which inspector to buy, the rule
  settles it. The model suggested the cheaper survey on a milestone already a
  day late — saving 25 cents by keeping the contractor waiting another 47 hours.
  A differing suggestion is recorded as considered, not acted on.
- **Availability.** A provider that is not accepting requests cannot be bought
  from. The plan routes to the alternative and says so; if nothing can establish
  a mandatory requirement, the milestone is held rather than released on thinner
  evidence.

## The instrument

`EscrowCreate` carries a **PREIMAGE-SHA-256 crypto-condition**; only the holder
of the fulfillment can call `EscrowFinish`. Kirim holds it and releases only on
conforming evidence. `CancelAfter` returns the funds with no dispute process.

Conditions are hand-encoded in `services/ledger/src/conditions.mjs` — verified
byte-identical to the SDK's own `generatePreimageCondition`.

**No `FinishAfter`.** The condition is the gate, and a `FinishAfter` seconds
ahead is racy: the ledger closes past it before validation and rippled reports
`tecNO_PERMISSION`. Measured: `+2s` fails, `+60s` succeeds, omitted succeeds.

**No manual `Fee`.** `EscrowFinish` carries a fulfillment surcharge; xrpl.js's
autofill already applies base × (33 + bytes/16). We were overriding a correct
calculation with a dearer one.

## Evidence examination

`packages/works/src/examine.mjs` — deterministic, and the sole authority on
whether money moves. Three outcomes, because a site manager thinks in three:

| Outcome | Meaning | Effect |
|---|---|---|
| `ready` | Evidence is consistent with the agreed scope | Release, subject to the ceiling |
| `more_info` | Incomplete; nothing contradicts the scope | Held, **no mark on the record** |
| `flagged` | Evidence contradicts the scope | Held, discrepancy named |

Collapsing "you did not send enough" into the same rejection as "what you sent
does not add up" punishes the honest contractor who forgot a photograph.

## Authorisation above the ceiling

The client's release ceiling is **their** preference, and the ledger enforces
the stricter of theirs and the platform's — a preference cannot buy away a
safeguard.

Above it, "the client approved" means a signature on the ledger: an ordinary
Payment from their own account carrying a memo naming the milestone. Crossmark
and GemWallet are wired into the console; any wallet produces the same thing.
Verified against a real authorisation — replaying it against another milestone,
claiming it came from the contractor, addressing it elsewhere, and inventing a
hash are all refused with the reason.

## The track record

Every release issues an **XLS-70 Credential** to the contractor's own account,
which they accept. Keyed `KIRIM:<projectId>:<milestoneId>` — credentials are
unique per (issuer, subject, type), so issuance is idempotent by construction
and a re-run cannot inflate a record.

## Payments

`packages/mpp` wraps `xrpl-mpp-sdk` — Ripple's XRPL payment method for the
**Machine Payments Protocol**. The market issues genuine MPP challenges
(`WWW-Authenticate: Payment`, `method=xrpl`, `intent=charge`, RFC 9457 body) and
the buyer settles them.

The MPP client runs **inside the ledger service**, because `xrpl.charge` needs a
signing seed and only the seed-holder may move money. The agent calls
`POST /buy`; the ceiling is checked before anything is signed.

Kirim started with a hand-rolled 402 flow. It was deleted rather than left
beside the real one.

## Spend controls

| Ceiling | Applies to | Source |
|---|---|---|
| `MAX_PER_CALL_USD` | one MPP call | platform |
| `MAX_PER_TRADE_USD` / `evidenceBudgetUsd` | evidence per milestone | stricter of platform and client |
| `MAX_PER_RUN_USD` | operating spend per process | platform |
| `HUMAN_APPROVAL_ABOVE_USD` / `autoReleaseCeilingUsd` | **release** | stricter of platform and client |

Funding an escrow moves money into protection, so no ceiling applies there.
Releasing it is irreversible, so that is where the client is asked.

## Two verticals, one engine

`packages/works` (construction milestones) and `packages/trade` (cross-border
document credits) are two rule sets over the same ledger service, MPP layer and
escrow instrument. Both run end to end.

## Not yet built

- **PermissionedDomains** — restrict the market to credentialed contractors.
- **XRPL DEX** — the FX leg is quoted but not executed.
- **Claw Credit** — written and gated; blocked on an invite code and the absence
  of any sandbox.
- **Batch** — not present in the testnet feature list at time of writing.
