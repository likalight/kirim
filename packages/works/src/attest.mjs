import crypto from 'node:crypto';

/**
 * Verify what you bought.
 *
 * Every provider signs its attestation with ed25519 and publishes the public
 * key at `/v1/pubkey`. Until now the agent paid for those attestations and
 * believed them on sight, which makes the signature decorative — an unverified
 * attestation is a bought lie, and the whole release decision rests on them.
 *
 * The market signs `JSON.stringify(body)` where `body` is the attestation
 * without its `signature` field, so verification reconstructs exactly that.
 */
export function verifyAttestation(attestation, publicKeyPem) {
  if (!attestation || typeof attestation !== 'object') {
    return { ok: false, reason: 'No attestation was returned.' };
  }
  const { signature, ...body } = attestation;
  if (!signature) return { ok: false, reason: 'The attestation carries no signature.' };
  if (!publicKeyPem) return { ok: false, reason: 'No provider public key to verify against.' };

  let ok = false;
  try {
    ok = crypto.verify(
      null,
      Buffer.from(JSON.stringify(body)),
      crypto.createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64'),
    );
  } catch (e) {
    return { ok: false, reason: `The signature could not be checked: ${e.message}` };
  }

  return ok
    ? { ok: true, issuer: body.issuer, claim: body.claim }
    : { ok: false, reason: 'The signature does not match the attestation. Treating it as absent.' };
}
