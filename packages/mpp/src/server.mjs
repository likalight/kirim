import { Mppx, Store } from 'mppx/server';
import { xrpl } from 'xrpl-mpp-sdk/server';
import { toDrops } from 'xrpl-mpp-sdk';

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
        // XRP settles in drops. Prices are quoted in dollars in the catalogue
        // and mapped 1:1 to XRP on testnet, so a US$0.30 check is 0.3 XRP —
        // the amount the provider verifies is exactly the amount it quoted.
        amount: toDrops(String(priceUsd)),
        currency: 'XRP',
        recipient,
        description: resource,
        externalId: resource,
      }),
    )(req, res);

    return result.status !== 402;
  };
}
