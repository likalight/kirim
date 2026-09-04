# XRPL transactions

Every transaction below is real, on the **XRP Ledger Testnet**, produced by the
code in this repository. Explorer base: `https://testnet.xrpl.org/transactions/`

Roles: `buyer` (Sarah Lim, the client), `supplier` (ABC Renovation, the contractor),
`inspector` (the x402 provider payee), `platform` (Kirim — holds the escrow
fulfillment and issues credentials).

A full transcript of the run below is in [demo-run.txt](demo-run.txt).

---

## One run, six milestones

| Milestone | Amount | Outcome | Why |
|---|---|---|---|
| `M1` Demolition and disposal | US$10,000 | **released** | Evidence conformed. Released autonomously; credential written to the contractor account. |
| `M2` Plumbing first fix | US$10,000 | **flagged for review** | A photograph taken 2.3km from the site, and a delivery note absent from the supplier registry. |
| `M3` Electrical first fix | US$10,000 | **more information needed** | One photograph of three, no delivery notes, no inspection result. Nothing contradicts the scope. |
| `M4` Tiling and finishing | US$10,000 | **flagged for review** | Inspection at 72% against a 95% threshold, a critical defect, a recycled photograph and a re-encoded file. |
| `M5` Variation order | US$18,000 | **awaiting client authorisation** | Evidence in order, but above the US$12,000 autonomous ceiling. No release without the client. |
| `M6` Final completion | US$10,000 | **timed out and returned** | Nothing was ever presented. The escrow cancelled itself and the funds went back to the client. |

Three of those six are payments that correctly did **not** happen. That is the
part that makes an autonomous payment system credible.

---

## Every hash from that run

| Milestone | Transaction | Hash |
|---|---|---|
| `M1` | `EscrowCreate` — milestone funded | [`3954D4FD802CB6320D37DD8F7659554BEBC861B32517D50FE01675C6FD9F249D`](https://testnet.xrpl.org/transactions/3954D4FD802CB6320D37DD8F7659554BEBC861B32517D50FE01675C6FD9F249D) |
| `M1` | x402 payment — evidence check | [`EDA2C04409AA41618376126C460A0DE0B161934C6424176A0497082979ECC16B`](https://testnet.xrpl.org/transactions/EDA2C04409AA41618376126C460A0DE0B161934C6424176A0497082979ECC16B) |
| `M1` | x402 payment — evidence check | [`EC4AEE5477D3096D77B8B0046A7AD4492ED93D54FAC69076A5FA0FA615F3E5EA`](https://testnet.xrpl.org/transactions/EC4AEE5477D3096D77B8B0046A7AD4492ED93D54FAC69076A5FA0FA615F3E5EA) |
| `M1` | x402 payment — evidence check | [`F94443312C498FC683044BBF76A24BF9AC186B99A129C1D0C9C3A05D3E43F7EE`](https://testnet.xrpl.org/transactions/F94443312C498FC683044BBF76A24BF9AC186B99A129C1D0C9C3A05D3E43F7EE) |
| `M1` | `EscrowFinish` / `EscrowCancel` | [`C7C034D6C740452B353246A67FDA069C29EE9173C482198E266A72E750CC0288`](https://testnet.xrpl.org/transactions/C7C034D6C740452B353246A67FDA069C29EE9173C482198E266A72E750CC0288) |
| `M2` | `EscrowCreate` — milestone funded | [`7A0E4EC247749F4F37C5304F8DB9FC6FE5F2EA5FF8883C79520782CDF8CECC39`](https://testnet.xrpl.org/transactions/7A0E4EC247749F4F37C5304F8DB9FC6FE5F2EA5FF8883C79520782CDF8CECC39) |
| `M2` | x402 payment — evidence check | [`1C50BE1B0EE322848B19BB11704A5F0A1B7E7087BFF33BEF45BCBA242F96A8D6`](https://testnet.xrpl.org/transactions/1C50BE1B0EE322848B19BB11704A5F0A1B7E7087BFF33BEF45BCBA242F96A8D6) |
| `M2` | x402 payment — evidence check | [`382A46CD8291BDCDF91555B85653198A72DEFE618585403DE88583BE53F1577B`](https://testnet.xrpl.org/transactions/382A46CD8291BDCDF91555B85653198A72DEFE618585403DE88583BE53F1577B) |
| `M2` | x402 payment — evidence check | [`D653986E129CD93724EEFEEFE3FB67453AD89360D51C40452ADE23EEEAF721BD`](https://testnet.xrpl.org/transactions/D653986E129CD93724EEFEEFE3FB67453AD89360D51C40452ADE23EEEAF721BD) |
| `M3` | `EscrowCreate` — milestone funded | [`A4041F4B0BD6BBE67A99EAD06C823200A4A2915180D45F453474825FAFC33869`](https://testnet.xrpl.org/transactions/A4041F4B0BD6BBE67A99EAD06C823200A4A2915180D45F453474825FAFC33869) |
| `M3` | x402 payment — evidence check | [`0F01C6205EF50C334DC858C4BF6D7EBC91F45132DA5CF676260F42352866A739`](https://testnet.xrpl.org/transactions/0F01C6205EF50C334DC858C4BF6D7EBC91F45132DA5CF676260F42352866A739) |
| `M3` | x402 payment — evidence check | [`16BB29B1B7558EC5B22B9C28CC7AAFF1DC8D648705318234093EB49D609652A7`](https://testnet.xrpl.org/transactions/16BB29B1B7558EC5B22B9C28CC7AAFF1DC8D648705318234093EB49D609652A7) |
| `M4` | `EscrowCreate` — milestone funded | [`2482B049AC3679F543D32CFD4C16B63D9F3A9B938B94A56B7EA80C5E4EBCEBF1`](https://testnet.xrpl.org/transactions/2482B049AC3679F543D32CFD4C16B63D9F3A9B938B94A56B7EA80C5E4EBCEBF1) |
| `M4` | x402 payment — evidence check | [`F8A97EDB0589C2A9B9108C20FFF8132024F47940564B355B2EDE6CD1FEC67446`](https://testnet.xrpl.org/transactions/F8A97EDB0589C2A9B9108C20FFF8132024F47940564B355B2EDE6CD1FEC67446) |
| `M4` | x402 payment — evidence check | [`C5582695B36E7D57308A37216D51A5CC246740214D2138676F40169F881D4931`](https://testnet.xrpl.org/transactions/C5582695B36E7D57308A37216D51A5CC246740214D2138676F40169F881D4931) |
| `M4` | x402 payment — evidence check | [`C7EA460930FFD40B13DDD6EE084D4EC993B5BC82FA798CFEA7DB1FE03F0ABD4D`](https://testnet.xrpl.org/transactions/C7EA460930FFD40B13DDD6EE084D4EC993B5BC82FA798CFEA7DB1FE03F0ABD4D) |
| `M5` | `EscrowCreate` — milestone funded | [`1E62FFB6BF361F777695ED8C2A830DA9EDD5913050B773809A2639061D214AD5`](https://testnet.xrpl.org/transactions/1E62FFB6BF361F777695ED8C2A830DA9EDD5913050B773809A2639061D214AD5) |
| `M5` | x402 payment — evidence check | [`0B9E865A1EC8375AC393F160CFD61B18C608F1E5A8C17A851177E114BA840738`](https://testnet.xrpl.org/transactions/0B9E865A1EC8375AC393F160CFD61B18C608F1E5A8C17A851177E114BA840738) |
| `M5` | x402 payment — evidence check | [`C3E45BEA79FD5034AAEEE02B328475C6EE9BA369CB1CDBC2CB476460D1F10942`](https://testnet.xrpl.org/transactions/C3E45BEA79FD5034AAEEE02B328475C6EE9BA369CB1CDBC2CB476460D1F10942) |
| `M5` | x402 payment — evidence check | [`7051A881390EF1C215ECEED7EAAA5FD0BEB7466A8A72F6874CE1C2D1C1A54B18`](https://testnet.xrpl.org/transactions/7051A881390EF1C215ECEED7EAAA5FD0BEB7466A8A72F6874CE1C2D1C1A54B18) |
| `M6` | `EscrowCreate` — milestone funded | [`92C2D9FB9CF2469BE6EE8609251A97B5D0213EF777B3EB4413D735BF84F20782`](https://testnet.xrpl.org/transactions/92C2D9FB9CF2469BE6EE8609251A97B5D0213EF777B3EB4413D735BF84F20782) |
| `M6` | `EscrowFinish` / `EscrowCancel` | [`2CE81FFA49F7C09034274043499C32BA44AFB06ADD676CB3567077D6C1A6BE51`](https://testnet.xrpl.org/transactions/2CE81FFA49F7C09034274043499C32BA44AFB06ADD676CB3567077D6C1A6BE51) |

**22 transactions** in a single run of `npm run milestone all`.

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

## RLUSD trustlines — `npm run setup`

`TrustSet` against the RLUSD testnet issuer [`rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV`](https://testnet.xrpl.org/accounts/rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV)
(`RLUSD_XRPL_ISSUER_TESTNET` in t54-labs/rlusd-cli — it is documented in neither the
challenge materials nor the faucet page).

| Role | Hash |
|---|---|
| buyer | [`A506DDB7BF2E63C070F8C4929BA1973573793D3A8C73A7D9D14D44FA52609738`](https://testnet.xrpl.org/transactions/A506DDB7BF2E63C070F8C4929BA1973573793D3A8C73A7D9D14D44FA52609738) |
| supplier | [`07D74C5D6B8F081E73308667FECF6EB484A6AB6EDE0A5D6A952527E19E92C698`](https://testnet.xrpl.org/transactions/07D74C5D6B8F081E73308667FECF6EB484A6AB6EDE0A5D6A952527E19E92C698) |
| inspector | [`9A01ED075A26193C9481425152D2A020C69990FF9950FE6A97F1D1CCBB247D30`](https://testnet.xrpl.org/transactions/9A01ED075A26193C9481425152D2A020C69990FF9950FE6A97F1D1CCBB247D30) |
| platform | [`F103922043B6C2D8A77FF4189B344D5508760230F8E33B0F3DF68F3FD21FD886`](https://testnet.xrpl.org/transactions/F103922043B6C2D8A77FF4189B344D5508760230F8E33B0F3DF68F3FD21FD886) |

---

## Notes

**What has no transaction.** The US$4.50 credit report is declined on every
milestone — it exceeds the per-call ceiling — so no payment for it exists. `M2`, `M3`
and `M4` have no `EscrowFinish`, because the evidence did not justify one. The absent
transactions are as much a deliverable as the present ones.

**Settlement.** These runs used the XRP path. The principal is divided by
`SETTLEMENT_DIVISOR` before it touches the ledger — the RLUSD faucet allows 10 RLUSD
per account per 24 hours and the XRP faucet caps a wallet at 100 XRP, so a US$10,000
milestone cannot settle at par on testnet. **Every response carrying a scaled amount
says so.** Operating spend is never scaled, so the amount each provider verified
on-ledger is exactly the price it quoted.

**No `FinishAfter`.** The crypto-condition is the gate. A `FinishAfter` only seconds
ahead is racy: the ledger closes past it before validation and rippled reports
`tecNO_PERMISSION`. Measured: `+2s` fails, `+60s` succeeds, omitted succeeds.
