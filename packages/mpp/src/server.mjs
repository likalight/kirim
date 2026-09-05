import { Mppx, Store } from 'mppx/server';
import { xrpl } from 'xrpl-mpp-sdk/server';
import { toDrops } from 'xrpl-mpp-sdk';

/**
 * What the providers are paid in.
 *
 * RLUSD when an issuer is configured — a dollar-denominated price settling in
 * a dollar stablecoin, which is the whole point of pricing evidence per call.
 * XRP otherwise. The SDK serialises this into the 402 challenge, so the client
 * learns the currency from the challenge rather than being told out of band.
 */
function chargeCurrency() {
  const issuer = process.env.RLUSD_ISSUER;
  if ((process.env.SETTLEMENT || 'RLUSD').toUpperCase() === 'RLUSD' && issuer) {
    return {
      currency: process.env.RLUSD_CURRENCY || '524C555344000000000000000000000000000000',
      issuer,
    };
  }
  return 'XRP';
}

const CURRENCY = chargeCurrency();
const IS_IOU = typeof CURRENCY === 'object';
// The method config takes the currency object; the per-request charge takes its
// serialised form, which the SDK defines as JSON.stringify of that object.
const CURRENCY_STR = IS_IOU ? JSON.stringify(CURRENCY) : 'XRP';

/**
 * The seller side of the Machine Payments Protocol.
 *
 * MPP is what the challenge names alongside x402 — the Machine Payments
 * Protocol (mpp.dev). `xrpl-mpp-sdk` is Ripple's XRPL payment method for it,
 * built on `mppx`, and it speaks the same HTTP 402 handshake we had
 * hand-rolled: unpaid request gets a challenge, the client pays, the paid
 * request carries a credential the server verifies on-ledger before serving.
 *
 * We use the SDK's implementation rather than our own so the wire format is
 * the ecosystem's, not ours. Credential mode is the client's choice:
 * `pull` (client signs a blob, this server submits it) or `push` (client
 * submits and sends the hash). Both end up verified against the ledger here.
 */

const NETWORK = process.env.MPP_NETWORK || 'testnet';

/**
 * One MPP handler for the whole market. Replay protection is in-process,
 * which is correct for a single-node prototype and declared as such — the SDK
 * refuses an undeclared process-local store on mainnet, and it is right to.
 */
export function createMarket({ recipient, secretKey }) {
  const payment = Mppx.create({
    methods: [
      xrpl.charge({
        recipient,
        network: NETWORK,
        currency: CURRENCY,
        store: Store.memory(),
        storeDurability: 'process-local',
      }),
    ],
    secretKey,
    realm: 'kirim-market',
  });

  /**
   * Gate one request. Returns true when payment has been verified and the
   * caller should serve the resource; false when MPP has already written a
   * 402 challenge (or an error) to the response.
   */
  return async function gate(req, res, { priceUsd, resource }) {
    const result = await Mppx.toNodeListener(
      payment.charge({
        // An IOU amount is a decimal string; XRP settles in drops.
        //
        // Quote the IOU amount in its canonical numeric form. XRPL normalises
        // issued-currency values, so a quote of "0.10" comes back off the
        // ledger as "0.1" — and the SDK compares those as strings, rejecting a
        // correct payment with AMOUNT_MISMATCH. Number() first, and the two
        // agree. (0.08 settles; 0.10 does not, until you do this.)
        amount: IS_IOU ? String(Number(priceUsd)) : toDrops(String(priceUsd)),
        currency: CURRENCY_STR,
        recipient,
        description: resource,
        externalId: resource,
      }),
    )(req, res);

    return result.status !== 402;
  };
}
