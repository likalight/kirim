# XRPL transactions

Every transaction below is real, on the **XRP Ledger Testnet**, produced by one run
of `npm run milestone all` plus the client signature on `M5`. Explorer base: `https://testnet.xrpl.org/transactions/`

Roles: `buyer` (Sarah Lim, the client), `supplier` (ABC Renovation, the contractor),
`inspector` (the MPP provider payee), `platform` (Kirim — holds the escrow fulfillment,
issues credentials, receives the fee).

The full transcript is in [demo-run.txt](demo-run.txt).

---

## One run, six milestones

| Milestone | Amount | Outcome | Why |
|---|---|---|---|
| `M1` Demolition and disposal | US$10,000 | **released** | Evidence conformed. Released autonomously; fee charged; milestone written to the contractor’s ledger record. |
| `M2` Plumbing first fix | US$10,000 | **flagged for review** | A photograph taken 2.3km from site, and a delivery note absent from the supplier registry. |
| `M3` Electrical first fix | US$10,000 | **more information needed** | One photograph of three and no delivery notes. Nothing contradicts the scope, so nothing is marked against the contractor. |
| `M4` Tiling and finishing | US$10,000 | **flagged for review** | Inspection at 72% against a 95% threshold, a critical defect, a recycled photograph and a re-encoded file. One day late, so the express survey was bought. |
| `M5` Variation order | US$18,000 | **awaiting client authorisation → released** | Evidence in order but above Sarah’s US$12,000 ceiling. Released only after she signed from her own wallet. |
| `M6` Final completion | US$10,000 | **timed out and returned** | Nothing was ever presented. The escrow cancelled itself and the funds went back to the client. |

**Three of the six end with no payment to the contractor.** The challenge’s flow
diagram has no branch for an agent deciding *not* to transact; each of these is a
deliberate outcome with a recorded reason, and they are the part that makes an
autonomous payment system credible.

---

## Every hash from that run

| Milestone | Transaction | Hash |
|---|---|---|
| `M1` | `EscrowCreate` — principal committed | [`DB2C321D1C41C72440227725382A8C4390F2373B196E665259E47869C3A332C7`](https://testnet.xrpl.org/transactions/DB2C321D1C41C72440227725382A8C4390F2373B196E665259E47869C3A332C7) |
| `M1` | MPP purchase — evidence check | [`21EF14A8EBC9925E26AB013DBD7865FC30A9656D156E84B2F4B3802AA0F32D03`](https://testnet.xrpl.org/transactions/21EF14A8EBC9925E26AB013DBD7865FC30A9656D156E84B2F4B3802AA0F32D03) |
| `M1` | MPP purchase — evidence check | [`717F00FCC0E1B8CDB7A4875FEDE6EAAC7BBF1A2CAFBD182633CE947DCCD4EE44`](https://testnet.xrpl.org/transactions/717F00FCC0E1B8CDB7A4875FEDE6EAAC7BBF1A2CAFBD182633CE947DCCD4EE44) |
| `M1` | MPP purchase — evidence check | [`437708426FE38214C97A4B6C1C90E715DE2156AC2304FFE86B9BE40F9D2B51C4`](https://testnet.xrpl.org/transactions/437708426FE38214C97A4B6C1C90E715DE2156AC2304FFE86B9BE40F9D2B51C4) |
| `M1` | `EscrowFinish` / `EscrowCancel` | [`28F9F75CB532EFF8BBB95A50286CA5CA3196505E97B1C51F852B810162592EFA`](https://testnet.xrpl.org/transactions/28F9F75CB532EFF8BBB95A50286CA5CA3196505E97B1C51F852B810162592EFA) |
| `M1` | `Payment` — Kirim’s 0.8% fee | [`AB172BC4FF2E188C4EE68C6947DB3BB5A4FB2A644A00BAE2B2E0753B502E6BA0`](https://testnet.xrpl.org/transactions/AB172BC4FF2E188C4EE68C6947DB3BB5A4FB2A644A00BAE2B2E0753B502E6BA0) |
| `M2` | `EscrowCreate` — principal committed | [`3E5861CC183D5319D9FC807C196392E21DAE86A04869D548398942EF8B377C0B`](https://testnet.xrpl.org/transactions/3E5861CC183D5319D9FC807C196392E21DAE86A04869D548398942EF8B377C0B) |
| `M2` | MPP purchase — evidence check | [`D53DC6C404C655573405B5CD97E73E0C267E5DDE505FEA795D26CB9A802C4043`](https://testnet.xrpl.org/transactions/D53DC6C404C655573405B5CD97E73E0C267E5DDE505FEA795D26CB9A802C4043) |
| `M2` | MPP purchase — evidence check | [`E85E5B3FDE8F1E66644902963D47A47619212A253FA46C3F9305A5F41B7BD3D9`](https://testnet.xrpl.org/transactions/E85E5B3FDE8F1E66644902963D47A47619212A253FA46C3F9305A5F41B7BD3D9) |
| `M2` | MPP purchase — evidence check | [`068CE5AF94AFD52EBA920C9282BFA3E61782321AF3840744E2FA74337AED77AB`](https://testnet.xrpl.org/transactions/068CE5AF94AFD52EBA920C9282BFA3E61782321AF3840744E2FA74337AED77AB) |
| `M3` | `EscrowCreate` — principal committed | [`7F4569A83FA61CC6FDC41C0D5063957C8FBE5FEDA530BF8259F47782EDB0745A`](https://testnet.xrpl.org/transactions/7F4569A83FA61CC6FDC41C0D5063957C8FBE5FEDA530BF8259F47782EDB0745A) |
| `M3` | MPP purchase — evidence check | [`D5FFA03100D25F9970D02C30D6CC17212363B87D302E735E74CD38FEE58AAEF4`](https://testnet.xrpl.org/transactions/D5FFA03100D25F9970D02C30D6CC17212363B87D302E735E74CD38FEE58AAEF4) |
| `M3` | MPP purchase — evidence check | [`C8EFAA2DA606834B1E88B13BAC015429EF8F8519434AD213F48FEC1659B9E7ED`](https://testnet.xrpl.org/transactions/C8EFAA2DA606834B1E88B13BAC015429EF8F8519434AD213F48FEC1659B9E7ED) |
| `M4` | `EscrowCreate` — principal committed | [`89DFE56BEE185E8340D161D633F8E3F9EA9199E729D13D47B474017FF10F9361`](https://testnet.xrpl.org/transactions/89DFE56BEE185E8340D161D633F8E3F9EA9199E729D13D47B474017FF10F9361) |
| `M4` | MPP purchase — evidence check | [`C48EE396A07F19676F84367C9AB6D18C9FB761EF362644015AFD80120A2B2EB0`](https://testnet.xrpl.org/transactions/C48EE396A07F19676F84367C9AB6D18C9FB761EF362644015AFD80120A2B2EB0) |
| `M4` | MPP purchase — evidence check | [`E8940442F65A66FE4BFCF08706EF1EC37BC01A1BDBB90079CD48C0B028EC8ADC`](https://testnet.xrpl.org/transactions/E8940442F65A66FE4BFCF08706EF1EC37BC01A1BDBB90079CD48C0B028EC8ADC) |
| `M4` | MPP purchase — evidence check | [`A291765E10E8C493EA6FEA60F6185DBE4910DB3A15C4E5FD011270019DAFCB91`](https://testnet.xrpl.org/transactions/A291765E10E8C493EA6FEA60F6185DBE4910DB3A15C4E5FD011270019DAFCB91) |
| `M5` | `EscrowCreate` — principal committed | [`B3D5A1E17DDF7B547238988FCCFEF7E09075BFF7223EF5E2DB743FA004AB853F`](https://testnet.xrpl.org/transactions/B3D5A1E17DDF7B547238988FCCFEF7E09075BFF7223EF5E2DB743FA004AB853F) |
| `M5` | MPP purchase — evidence check | [`3E9A1DF54ED9980E9E8FC13FFCA48C62C3AC472CD44C6BE90436640CBE6B6C2E`](https://testnet.xrpl.org/transactions/3E9A1DF54ED9980E9E8FC13FFCA48C62C3AC472CD44C6BE90436640CBE6B6C2E) |
| `M5` | MPP purchase — evidence check | [`698390B84325A4150F7E0CB39CEEBF94435187306C4A0CD2231AF0AD9BFB731F`](https://testnet.xrpl.org/transactions/698390B84325A4150F7E0CB39CEEBF94435187306C4A0CD2231AF0AD9BFB731F) |
| `M5` | MPP purchase — evidence check | [`850B2A69618C18B071EC1C55080820D0EC56E5EC621117A09BC77B2422C431BF`](https://testnet.xrpl.org/transactions/850B2A69618C18B071EC1C55080820D0EC56E5EC621117A09BC77B2422C431BF) |
| `M6` | `EscrowCreate` — principal committed | [`5CA771A597B4BBE063F0902D7FAD53B3436467E091A6BFB99D24DF5A53D936F8`](https://testnet.xrpl.org/transactions/5CA771A597B4BBE063F0902D7FAD53B3436467E091A6BFB99D24DF5A53D936F8) |
| `M6` | `EscrowFinish` / `EscrowCancel` | [`D55A3E67A27B20E848E79A115569F361CF2D240AAD90A293F51F17480E24C2D5`](https://testnet.xrpl.org/transactions/D55A3E67A27B20E848E79A115569F361CF2D240AAD90A293F51F17480E24C2D5) |

**23 transactions** in a single run.

### The client’s signature on `M5`

Above her ceiling, Sarah authorises from her own wallet — an ordinary Payment
carrying a memo naming the milestone. Kirim verifies it on-ledger before the escrow
is finished.

| Transaction | Hash |
|---|---|
| `Payment` — client authorisation, memo `PRJ-2026-014/M5` | [`0DA1B8119218FE726EEC18FEE6047D7F9C1260E473042FA9034C64D0F140FA70`](https://testnet.xrpl.org/transactions/0DA1B8119218FE726EEC18FEE6047D7F9C1260E473042FA9034C64D0F140FA70) |

Refused against the same signature: replayed at another milestone, claimed to come
from the contractor, addressed elsewhere, or a hash that does not exist.

---

## The gates

Both were run before any product code was trusted.

### Escrow — `npm run escrow:smoke`

| # | Transaction | Hash |
|---|---|---|
| 1 | `EscrowCreate` | [`5FDBBC389394A463282EC3F04A5AA521C5809BF76F7A0F3BBE8F7CCF6FA39D9F`](https://testnet.xrpl.org/transactions/5FDBBC389394A463282EC3F04A5AA521C5809BF76F7A0F3BBE8F7CCF6FA39D9F) |
| 2 | `EscrowFinish` against the fulfillment | [`5A8CF0CB7F1FAD79299172B83F1425E19DDF1365999CB4ADC1CAF364541F0109`](https://testnet.xrpl.org/transactions/5A8CF0CB7F1FAD79299172B83F1425E19DDF1365999CB4ADC1CAF364541F0109) |
| 3 | `EscrowCreate` with a 25s `CancelAfter` | [`E163242F3220624353D7F0683DFE03F1BF87A825AD20C837532100967F93034B`](https://testnet.xrpl.org/transactions/E163242F3220624353D7F0683DFE03F1BF87A825AD20C837532100967F93034B) |
| 4 | `EscrowCancel` — funds returned | [`CA3A1592E1903C07050CB5E79C5B281F5AAC64EFB9E5A56479732B0578D47028`](https://testnet.xrpl.org/transactions/CA3A1592E1903C07050CB5E79C5B281F5AAC64EFB9E5A56479732B0578D47028) |

### Credentials — `npm run credential:smoke`

| # | Transaction | Hash |
|---|---|---|
| 1 | `CredentialCreate` (XLS-70) | [`015A393AAE9EA17806D81D1BBEE3D3F698E952942918F566A9148253A3877641`](https://testnet.xrpl.org/transactions/015A393AAE9EA17806D81D1BBEE3D3F698E952942918F566A9148253A3877641) |
| 2 | `CredentialAccept` by the contractor | [`4A21D4957626070AF03925EB8B9415138BECE9D904CCDD67773BACD21374B8FE`](https://testnet.xrpl.org/transactions/4A21D4957626070AF03925EB8B9415138BECE9D904CCDD67773BACD21374B8FE) |

---

## Notes

**What has no transaction.** The US$4.50 credit report is declined on every milestone
— it exceeds the per-call ceiling — so no payment for it exists. `M2`, `M3` and `M4`
have no `EscrowFinish`, because the evidence did not justify one. The absent
transactions are as much a deliverable as the present ones.

**Payments are MPP.** Every purchase row is a Machine Payments Protocol settlement
through `xrpl-mpp-sdk` — a real `WWW-Authenticate: Payment` challenge, settled and
verified on-ledger before the provider serves a byte. The receipt’s `reference` field
is the transaction hash.

**Settlement.** These runs used the XRP path. The principal is divided by
`SETTLEMENT_DIVISOR` before it touches the ledger — the RLUSD faucet allows 10 RLUSD
per account per 24 hours and the XRP faucet caps a wallet at 100 XRP, so a US$10,000
milestone cannot settle at par on testnet. **Every response carrying a scaled amount
says so.** Operating spend is never scaled, so the amount each provider verified
on-ledger is exactly the price it quoted.
