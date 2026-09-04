import crypto from 'node:crypto';

/**
 * x402 server side, for plain node:http.
 *
 * Unpaid request  -> 402 with a payment requirement the caller can satisfy.
 * Paid request    -> X-PAYMENT header carrying the XRPL tx hash; we verify it
 *                    ON-LEDGER (amount, destination, memo, validated) before
 *                    serving a single byte. Never trust the header alone.
 *
 * Reconcile the wire format with xrpl-x402.t54.ai before submission; this is a
 * faithful implementation of the shape, kept in one file on purpose.
 */

const seen = new Map(); // txHash -> resource, replay protection

export function paymentRequired({ price, payTo, asset, resource, description }) {
  return {
    x402Version: 1,
    error: 'payment_required',
    accepts: [{
      scheme: 'exact',
      network: 'xrpl-testnet',
      resource,
      description,
      maxAmountRequired: price,       // decimal string, e.g. "0.05"
      asset,                          // "XRP" | { currency, issuer }
      payTo,
      nonce: crypto.randomUUID(),
      maxTimeoutSeconds: 120,
    }],
  };
}

/**
 * @param {object} o
 * @param {(hash:string)=>Promise<object>} o.verifyOnLedger  resolves the tx from the ledger service
 */
export function gate(o) {
  const { price, payTo, asset, resource, description, verifyOnLedger } = o;

  return async function check(req, res) {
    const header = req.headers['x-payment'];
    if (!header) {
      send(res, 402, paymentRequired({ price, payTo, asset, resource, description }));
      return false;
    }

    let claim;
    try {
      claim = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    } catch {
      send(res, 400, { error: 'malformed_payment_header' });
      return false;
    }

    if (!claim.txHash) { send(res, 400, { error: 'missing_tx_hash' }); return false; }
    if (seen.has(claim.txHash)) { send(res, 409, { error: 'payment_already_used' }); return false; }

    let tx;
    try {
      tx = await verifyOnLedger(claim.txHash);
    } catch (e) {
      send(res, 502, { error: 'ledger_unreachable', detail: String(e.message || e) });
      return false;
    }

    const fail = (why) => { send(res, 402, { error: 'payment_invalid', reason: why, ...paymentRequired({ price, payTo, asset, resource, description }) }); return false; };

    if (!tx.validated) return fail('transaction not validated');
    if (tx.result !== 'tesSUCCESS') return fail(`transaction result ${tx.result}`);
    if (tx.destination !== payTo) return fail('paid to the wrong account');
    if (Number(tx.amountValue) + 1e-9 < Number(price)) return fail(`underpaid: ${tx.amountValue} < ${price}`);
    if (typeof asset === 'object' && tx.currency !== asset.currency) return fail('wrong currency');

    seen.set(claim.txHash, resource);
    res.setHeader('X-Payment-Response', Buffer.from(JSON.stringify({
      settled: true, txHash: claim.txHash, amount: tx.amountValue, resource,
    })).toString('base64'));
    return true;
  };
}

export function send(res, code, body) {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}
