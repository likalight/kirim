# XRPL transactions

Every transaction below is real, on the **XRP Ledger Testnet**, produced by the
code in this repository. Explorer base: `https://testnet.xrpl.org/transactions/`

Wallets are funded from the testnet faucet by `npm run setup`. Roles: `buyer`
(the importer), `supplier` (the exporter), `inspector` (the x402 provider
payee), `platform` (Kirim — holds the escrow fulfillment).

---

## RLUSD trustlines — `npm run setup`

`TrustSet` against the RLUSD testnet issuer
[`rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV`](https://testnet.xrpl.org/accounts/rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV)
(`RLUSD_XRPL_ISSUER_TESTNET` in t54-labs/rlusd-cli — it is not documented in the
challenge materials or on the faucet page itself).

| Role | Hash |
|---|---|
| buyer | [`A506DDB7BF2E63C070F8C4929BA1973573793D3A8C73A7D9D14D44FA52609738`](https://testnet.xrpl.org/transactions/A506DDB7BF2E63C070F8C4929BA1973573793D3A8C73A7D9D14D44FA52609738) |
| supplier | [`07D74C5D6B8F081E73308667FECF6EB484A6AB6EDE0A5D6A952527E19E92C698`](https://testnet.xrpl.org/transactions/07D74C5D6B8F081E73308667FECF6EB484A6AB6EDE0A5D6A952527E19E92C698) |
| inspector | [`9A01ED075A26193C9481425152D2A020C69990FF9950FE6A97F1D1CCBB247D30`](https://testnet.xrpl.org/transactions/9A01ED075A26193C9481425152D2A020C69990FF9950FE6A97F1D1CCBB247D30) |
| platform | [`F103922043B6C2D8A77FF4189B344D5508760230F8E33B0F3DF68F3FD21FD886`](https://testnet.xrpl.org/transactions/F103922043B6C2D8A77FF4189B344D5508760230F8E33B0F3DF68F3FD21FD886) |

The trade runs below used the XRP path; they will be re-run on `TokenEscrow`
once the buyer holds RLUSD.

---

## The gate — `npm run escrow:smoke`

Escrow create, release against a crypto-condition, and cancel after timeout.
Run before any product code was trusted.

| # | Transaction | Hash |
|---|---|---|
| 1 | `EscrowCreate` | [`5FDBBC389394A463282EC3F04A5AA521C5809BF76F7A0F3BBE8F7CCF6FA39D9F`](https://testnet.xrpl.org/transactions/5FDBBC389394A463282EC3F04A5AA521C5809BF76F7A0F3BBE8F7CCF6FA39D9F) |
| 2 | `EscrowFinish` (fulfillment presented) | [`5A8CF0CB7F1FAD79299172B83F1425E19DDF1365999CB4ADC1CAF364541F0109`](https://testnet.xrpl.org/transactions/5A8CF0CB7F1FAD79299172B83F1425E19DDF1365999CB4ADC1CAF364541F0109) |
| 3 | `EscrowCreate` (25s `CancelAfter`) | [`E163242F3220624353D7F0683DFE03F1BF87A825AD20C837532100967F93034B`](https://testnet.xrpl.org/transactions/E163242F3220624353D7F0683DFE03F1BF87A825AD20C837532100967F93034B) |
| 4 | `EscrowCancel` (funds returned) | [`CA3A1592E1903C07050CB5E79C5B281F5AAC64EFB9E5A56479732B0578D47028`](https://testnet.xrpl.org/transactions/CA3A1592E1903C07050CB5E79C5B281F5AAC64EFB9E5A56479732B0578D47028) |

---

## PO-2026-0418 — documents conform, escrow releases

Principal US$4,000. Agent operating spend US$0.19. Five ledger writes.

| Stage | Transaction | Hash |
|---|---|---|
| purchase | x402 — sanctions & PEP screening, US$0.05 | [`05D68BFDFAED604AF471D2574114839AB4271FB0C3637AF159D3B824E0B91A6B`](https://testnet.xrpl.org/transactions/05D68BFDFAED604AF471D2574114839AB4271FB0C3637AF159D3B824E0B91A6B) |
| escrow | `EscrowCreate` — principal committed | [`371A4FDCBF7B2C35AD9828EB04324BE9E6A3F02C115BAF883D572E2D11E25AC7`](https://testnet.xrpl.org/transactions/371A4FDCBF7B2C35AD9828EB04324BE9E6A3F02C115BAF883D572E2D11E25AC7) |
| purchase | x402 — bill of lading verification, US$0.12 | [`E2A3A595DBA1C6FCB75EDD5D335B6EAF81BAC3F3778660A0354DCA666FFFF850`](https://testnet.xrpl.org/transactions/E2A3A595DBA1C6FCB75EDD5D335B6EAF81BAC3F3778660A0354DCA666FFFF850) |
| settlement | `EscrowFinish` — **supplier paid on presentation** | [`0A105E588101A014DD3C7C5F5FFFFFF7FF86310F15B175F4E2AABB211EB5DA42`](https://testnet.xrpl.org/transactions/0A105E588101A014DD3C7C5F5FFFFFF7FF86310F15B175F4E2AABB211EB5DA42) |
| purchase | x402 — FX quote, US$0.02 | [`D2D3763B7DD864409899FDE0D1A3CA6E3233C186DEA6D50AFF79C212597CC04A`](https://testnet.xrpl.org/transactions/D2D3763B7DD864409899FDE0D1A3CA6E3233C186DEA6D50AFF79C212597CC04A) |

The US$4.50 credit report was **declined** — above the per-call ceiling. No
transaction exists for it, which is the point.

---

## PO-2026-0419 — short shipment, release refused

Packing list and bill of lading show 400 units against a PO for 500.
`QTY-SHORT` is blocking; the funds stay in escrow.

| Stage | Transaction | Hash |
|---|---|---|
| purchase | x402 — screening | [`4DA9A762035D21033AA5D9BB2CE9E2087D7F4B8AB966044B43B49D6B27D3F8B1`](https://testnet.xrpl.org/transactions/4DA9A762035D21033AA5D9BB2CE9E2087D7F4B8AB966044B43B49D6B27D3F8B1) |
| escrow | `EscrowCreate` — US$3,200 committed | [`45EA4E0DD291CF94A1FE8392A4BF48B2481FE56A088ACD1EBBEFE7735FF4700E`](https://testnet.xrpl.org/transactions/45EA4E0DD291CF94A1FE8392A4BF48B2481FE56A088ACD1EBBEFE7735FF4700E) |
| purchase | x402 — bill of lading verification | [`547216B8528287D9F3A3B66F0584F453BD8C7B98AD1B883C588564EF141B9BB0`](https://testnet.xrpl.org/transactions/547216B8528287D9F3A3B66F0584F453BD8C7B98AD1B883C588564EF141B9BB0) |
| settlement | **none — no `EscrowFinish` exists** | — |

The absent transaction is the deliverable.

---

## PO-2026-0420 — no presentation, funds return

Supplier never ships. The escrow cancels itself and the buyer is made whole
with no dispute process.

| Stage | Transaction | Hash |
|---|---|---|
| purchase | x402 — screening | [`98A49E9B131DFE0AFD3F78CDFF6DE444FED57CBBF2A497C73CCB89F53B757377`](https://testnet.xrpl.org/transactions/98A49E9B131DFE0AFD3F78CDFF6DE444FED57CBBF2A497C73CCB89F53B757377) |
| escrow | `EscrowCreate` — US$2,940, 30s `CancelAfter` | [`BE8B93E60369F59031D51572B59FA7BC0A3E7B25C78F7A34DC43CE2D31828549`](https://testnet.xrpl.org/transactions/BE8B93E60369F59031D51572B59FA7BC0A3E7B25C78F7A34DC43CE2D31828549) |
| settlement | `EscrowCancel` — **returned to buyer** | [`379C17BA35A45D1EB2FBAE8DFDCD1AE4AE7E01210D2C7FFCB35B382FC54D2C80`](https://testnet.xrpl.org/transactions/379C17BA35A45D1EB2FBAE8DFDCD1AE4AE7E01210D2C7FFCB35B382FC54D2C80) |

---

## PO-2026-0421 — above the autonomous ceiling

US$40,000 principal against a US$5,000 ceiling. The agent buys its screening,
then stops and asks a human. **No escrow was created.**

| Stage | Transaction | Hash |
|---|---|---|
| purchase | x402 — screening | [`B9AA6736A574B4259D75605D25243DF134CB1B72E696420B2FB0881CD3589F20`](https://testnet.xrpl.org/transactions/B9AA6736A574B4259D75605D25243DF134CB1B72E696420B2FB0881CD3589F20) |
| escrow | refused: *"Trade principal US$40000.00 exceeds the autonomous ceiling of US$5000.00. Human authorisation required."* | — |

---

## PO-2026-0422 — screening hit, declined before funding

An OFAC SDN name match at 0.71. The agent declines and commits nothing.

| Stage | Transaction | Hash |
|---|---|---|
| purchase | x402 — screening | [`2EED61D827A7BA14B00D21406409C0139F80D006793C31B845F1FDBBF9D6C65C`](https://testnet.xrpl.org/transactions/2EED61D827A7BA14B00D21406409C0139F80D006793C31B845F1FDBBF9D6C65C) |
| escrow | none — declined at underwriting | — |

---

## Settlement note

These runs used the **XRP fallback path** (no `RLUSD_ISSUER` configured). The
principal is divided by `XRP_FALLBACK_DIVISOR` because the testnet faucet caps a
wallet at 100 XRP; every API response carries that note. Operating spend maps
1:1, so the amount each provider verified on-ledger is exactly the price it
quoted. With `RLUSD_ISSUER` set, escrow uses `TokenEscrow` and the principal
settles at par.
