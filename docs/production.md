# Beyond the prototype

The challenge asks how this would realistically operate at scale. Written
honestly: what holds, what does not, and what it would cost.

---

## XRPL only — verified, not assumed

All on-chain functionality runs on the **XRP Ledger Testnet**. No EVM sidechain,
no other chain, in any code path.

Two dependencies *offer* other chains, and neither is used:

| Dependency | Offers | What Kirim configures |
|---|---|---|
| `mppx` | exports an `evm` payment method alongside `xrpl` | only `xrpl.charge` from `xrpl-mpp-sdk` — the `evm` method is never constructed |
| `@t54-labs/clawcredit-sdk` | Base/USDC, Solana/USDC, XRPL/RLUSD | `{ chain: 'XRPL', asset: 'RLUSD' }`, pinned in `packages/mpp/src/credit.mjs` |

`grep -riE '\bevm\b|solana|sepolia|ethereum|0x[0-9a-f]{40}'` across our source
returns only the comment in `credit.mjs` explaining which chains Claw Credit
supports. Seven transaction types, all XRPL: `EscrowCreate`, `EscrowFinish`,
`EscrowCancel`, `Payment`, `CredentialCreate`, `CredentialAccept`, `TrustSet`.

---

## Security

**Holds today.** The agent never holds a seed. The ledger service — which holds
all of them — requires a bearer token on every route that moves money, compared
in constant time; read-only routes stay open for inspection. Provider
attestations are ed25519-verified before the evidence is used. Every transaction
is simulated before it is signed. No shipped default secrets.

**What production needs.** Seeds live in `wallets.json` in plaintext; that
becomes an HSM or KMS, and the Agent Wallet skill's external-signer pattern is
the documented path — the signer exposes `sign(tx_json)` and the key never
enters the process. The agent/ledger boundary becomes a network boundary with
mTLS rather than a shared bearer token on localhost. Rate limiting per caller.

**The failure worth naming.** We shipped this service unauthenticated and only
found it auditing our own governance claims — an unauthenticated `POST /pay`
moved real testnet XRP. The lesson generalises: the moment you separate the
agent from the signer, the boundary between them is an internal API that can
move money.

## Scalability

**The real constraint is not XRPL.** The ledger closes every 3–5 seconds and
handles orders of magnitude more throughput than a milestone-payment business
would generate. A renovation milestone is a once-a-week event per project.

**What does not scale as written:**

- **MPP replay protection is `Store.memory()`**, declared `process-local`. The
  SDK refuses an undeclared process-local store on mainnet, and it is right to —
  replay state that is not shared across replicas lets a settled payment be
  presented twice. Production swaps in `Store.redis()` or the DynamoDB store the
  SDK ships.
- **Pending releases are a JSON file.** Correct for one node, wrong for several;
  becomes a row in Postgres with the escrow fulfillment encrypted at rest.
- **One market service.** In production the providers are independent
  businesses with their own endpoints, and the registry is a directory rather
  than a process we own.

**What does scale.** Escrows are independent — no shared state between
milestones, no global lock, no ordering requirement. The work is horizontally
partitionable by project.

## Performance

Measured on testnet, from the decision log:

| | |
|---|---|
| Milestone end to end | ~45–60s, dominated by `submitAndWait` on 5–6 transactions |
| One ledger write | 3–5s to validation |
| Evidence checks | 3 MPP round trips, ~4–8s each including settlement |
| Model call (review note) | ~1–3s |

The wall-clock is XRPL finality, not our code. Batching the fee with the release
would remove one write. `EscrowFinish` and the fee could settle atomically under
the `Batch` amendment, which is not on testnet at time of writing.

## Reliability

**Holds today.** A ledger error stops the run loudly rather than narrating a
settlement that never happened. An unavailable provider returns `503` charging
nothing, and the plan routes to the alternative. A fee that cannot be collected
never unwinds a release. `CancelAfter` returns the principal with no human in
the loop. Simulation catches malformed transactions before a fee is spent.

**Fixed while writing this.** Pending releases were an in-memory `Map`. A
restart between "awaiting client authorisation" and the client's signature would
have stranded the principal until `CancelAfter` expired — and their signature
would have arrived to find nothing waiting for it. They now persist and are
recovered on boot.

**What production needs.** A durable queue for in-flight milestones, health
checks and supervision on the three services, and a reconciliation job that
walks open escrows on the ledger against local state — the ledger is the source
of truth, and local state should be rebuildable from it.

## Infrastructure requirements

Deliberately small. Node 20+, three processes, no database, no Docker, no build
step, no message broker. A judge clones and runs it in two minutes.

Production adds Postgres (pending releases, decision logs, provider registry),
Redis (MPP replay store), an HSM or KMS for keys, and a reverse proxy. It is a
three-container deployment, not a platform.

## Cost

**Per milestone, measured:**

| | |
|---|---|
| XRPL fees | ~6 transactions × 10–350 drops — fractions of a cent |
| Evidence checks | US$0.48–0.73, paid to providers over MPP |
| Model call | ~400 input / 120 output tokens — fractions of a cent |
| **Kirim's revenue** | 0.8% of the milestone — US$80 on US$10,000 |

The margin is not tight. The cost of assurance no longer scales with a site
visit, which is the whole economic argument: an independent inspection at thirty
cents against a scheduled visit that costs a day.

**Where cost grows:** the model, linearly with milestones, and it is the
smallest line. The evidence providers are the real cost of goods, and they are
priced per call rather than per subscription — so a quiet month costs nothing.

## Integration

Kirim's own surfaces are HTTP + JSON with no framework in the way. The parts
that matter for someone else integrating:

- **Providers** join by exposing an MPP-gated endpoint and a wallet address. No
  contract, no account, no onboarding — that is the point of the payment rail.
- **Wallets**: Crossmark and GemWallet are wired directly, and any XRPL wallet
  produces the same client authorisation, so nothing depends on one vendor.
- **The evidence rules are a module**, not the product. `packages/works` and
  `packages/trade` are two rule sets over the same engine, which is how a third
  vertical would be added.

## Compliance

**What exists.** XLS-70 Credentials give a portable, verifiable record on the
contractor's own account rather than in our database. Every ledger write carries
a `Memo` binding it to a milestone and the Starter Kit's `SourceTag`, so a whole
agent run is attributable on-chain. Decision logs persist per milestone. The
client's release ceiling is enforced server-side and can only be made stricter.

**What a regulated deployment adds.** `PermissionedDomains` so only credentialed
contractors can transact in the Kirim domain — enabled on testnet, not yet
wired. Real KYB on both sides rather than a fixture. Money-transmission analysis
is the serious one: holding client funds in escrow, even non-custodially under a
crypto-condition, is a licensed activity in most jurisdictions, and in Singapore
that conversation is with MAS. The honest position for a prototype is that this
is a design that *could* be licensed, not one that is.

**What we do not claim.** Kirim does not verify construction. It reconciles
submitted evidence against an agreed scope and reports where they disagree. A
credential says a milestone was released against conforming evidence — it does
not say the work was good.
