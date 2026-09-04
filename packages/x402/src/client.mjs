/**
 * x402 client side.
 *
 * The client never signs. It hands the payment requirement to the ledger
 * service, which owns the seed and enforces the spend ceilings, then retries
 * with proof. If the ledger service refuses on policy, that refusal is
 * returned to the caller as a decision, not thrown away.
 */
export async function fetchWithPayment(url, {
  pay,                 // async ({ payTo, amount, asset, resource, memo }) => { txHash } | { refused, reason }
  memo,
  onQuote = () => {},
  init = {},
} = {}) {
  const first = await fetch(url, init);
  if (first.status !== 402) {
    return { paid: false, response: first, data: await safeJson(first) };
  }

  const body = await first.json();
  const req = body.accepts?.[0];
  if (!req) throw new Error('402 without a payment requirement');

  onQuote(req);

  const result = await pay({
    payTo: req.payTo,
    amount: req.maxAmountRequired,
    asset: req.asset,
    resource: req.resource,
    memo,
  });

  if (result.refused) {
    return { paid: false, refused: true, reason: result.reason, quote: req };
  }

  const header = Buffer.from(JSON.stringify({ txHash: result.txHash })).toString('base64');
  const second = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), 'x-payment': header },
  });

  return {
    paid: true,
    txHash: result.txHash,
    quote: req,
    response: second,
    data: await safeJson(second),
  };
}

async function safeJson(r) { try { return await r.json(); } catch { return null; } }
