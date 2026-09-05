import { Mppx } from 'mppx/client';
import { xrpl } from 'xrpl-mpp-sdk/client';
import { challengeSafeFetch } from 'xrpl-mpp-sdk/client';

/**
 * The buyer side of the Machine Payments Protocol.
 *
 * This runs **inside the ledger service**, not inside the agent. `xrpl.charge`
 * needs a seed to sign with, and the rule this whole system is built on is
 * that only the process holding the seed may move money. So the agent asks the
 * ledger service to buy a URL; the ledger service checks the spend ceiling,
 * lets MPP settle the 402 handshake, and hands back the data with its receipt.
 *
 * `challengeSafeFetch` is the SDK's own workaround for a body-clone hazard in
 * mppx 0.8.x when a challenge response is re-read. Without it the 402 body can
 * be consumed twice and the handshake fails intermittently.
 */

let client = null;

export function createBuyer({ seed }) {
  if (!client) {
    const mppx = Mppx.create({
      methods: [xrpl.charge({ seed })],
      // Leave globalThis.fetch alone. Every other service in this repo talks
      // plain HTTP to its neighbours, and silently paying for any 402 anywhere
      // in the process is exactly the kind of thing spend ceilings exist to
      // prevent.
      polyfill: false,
      fetch: challengeSafeFetch(globalThis.fetch),
    });
    client = mppx;
  }
  return client;
}

/**
 * Buy one resource. Returns the parsed body and the MPP receipt, which carries
 * the settlement details the challenge asks us to surface.
 */
export async function buy(url, { seed, mode = 'push' } = {}) {
  const mppx = createBuyer({ seed });
  const res = await mppx.fetch(url, { mpp: { mode } });

  const receiptHeader = res.headers.get('payment-receipt')
    ?? res.headers.get('Payment-Receipt');

  let receipt = null;
  if (receiptHeader) {
    try {
      receipt = JSON.parse(Buffer.from(receiptHeader, 'base64').toString('utf8'));
    } catch {
      receipt = { raw: receiptHeader };
    }
  }

  if (!res.ok) {
    const body = await res.text();
    const e = new Error(`MPP purchase failed: ${res.status} ${body.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }

  return { data: await res.json(), receipt, status: res.status };
}

/**
 * The settled transaction hash.
 *
 * MPP calls it `reference` — the method-specific settlement identifier, which
 * for the XRPL charge method is the transaction hash. Verified: a receipt
 * reference resolves on the ledger as a validated tesSUCCESS Payment from the
 * buyer to the provider for exactly the quoted amount.
 */
export function receiptTxHash(receipt) {
  if (!receipt) return null;
  const candidate = receipt.reference ?? receipt.transaction
    ?? receipt.txHash ?? receipt.hash ?? null;
  return typeof candidate === 'string' && /^[0-9A-F]{64}$/i.test(candidate)
    ? candidate
    : null;
}
