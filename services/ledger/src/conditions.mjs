import crypto from 'node:crypto';

/**
 * PREIMAGE-SHA-256 crypto-conditions, hand-encoded so we carry no extra
 * dependency. This is what makes Kirim a letter of credit rather than a timer:
 * the escrow can only be finished by whoever holds the fulfillment, and the
 * agent holds it until the documents conform.
 *
 *   condition   = A0 25 80 20 <sha256(preimage)> 81 01 <cost>
 *   fulfillment = A0 22 80 20 <preimage>
 */
export function makeCondition() {
  const preimage = crypto.randomBytes(32);
  const digest = crypto.createHash('sha256').update(preimage).digest('hex').toUpperCase();
  return {
    condition: `A0258020${digest}810120`,
    fulfillment: `A0228020${preimage.toString('hex').toUpperCase()}`,
  };
}

/** EscrowFinish costs base fee x (33 + fulfillment_bytes/16). Generous, in drops. */
export function finishFee(fulfillmentHex) {
  const bytes = Buffer.from(fulfillmentHex, 'hex').length;
  return String(10 * (33 + Math.ceil(bytes / 16)) + 100);
}
