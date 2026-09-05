import { Client, xrpToDrops, dropsToXrp, convertStringToHex, isoTimeToRippleTime } from 'xrpl';
import { makeCondition } from './conditions.mjs';

const ENDPOINT = process.env.XRPL_ENDPOINT || 'wss://s.altnet.rippletest.net:51233';
export const EXPLORER = process.env.XRPL_EXPLORER || 'https://testnet.xrpl.org';
export const explorerTx = (h) => `${EXPLORER}/transactions/${h}`;

let client;

/**
 * Connect, with room for a bad network.
 *
 * xrpl.js defaults to a 5-second connect timeout, which is generous on a desk
 * and short on conference wifi. A demo that dies because a websocket took six
 * seconds to open is an avoidable way to lose.
 */
export async function xrpl(attempts = 3) {
  if (client?.isConnected()) return client;
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      client = new Client(ENDPOINT, { connectionTimeout: 20000 });
      await client.connect();
      return client;
    } catch (e) {
      lastError = e;
      console.warn(`[xrpl] connect attempt ${i}/${attempts} failed: ${e.message}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  throw lastError;
}
export async function disconnect() { if (client?.isConnected()) await client.disconnect(); }

/** How Kirim settles. RLUSD when configured, XRP as the fallback path. */
export function settlementAsset() {
  const issuer = process.env.RLUSD_ISSUER;
  if ((process.env.SETTLEMENT || 'RLUSD').toUpperCase() === 'RLUSD' && issuer) {
    return { currency: process.env.RLUSD_CURRENCY || '524C555344000000000000000000000000000000', issuer };
  }
  return 'XRP';
}
export const isIOU = (a) => typeof a === 'object' && a !== null;

/**
 * Can this token be escrowed at all?
 *
 * TokenEscrow locks an issued token on its trust line, so the issuer has to
 * permit that: `asfAllowTrustLineLocking`, which appears on the AccountRoot as
 * `lsfAllowTrustLineLocking` (0x40000000).
 *
 * The RLUSD testnet issuer does not set it — its flags are 0x819A0000, which is
 * `lsfAllowTrustLineClawback` (0x80000000) set and locking clear. So every
 * EscrowCreate carrying RLUSD fails `tecNO_PERMISSION` on testnet however it is
 * shaped, while an ordinary RLUSD Payment between the same accounts succeeds.
 *
 * Rather than hardcode that, we ask the ledger. The day the issuer enables
 * locking, escrow moves to RLUSD with no code change.
 */
const LSF_ALLOW_TRUSTLINE_LOCKING = 0x40000000;
let lockingCache = null;

export async function issuerAllowsLocking(issuer) {
  if (lockingCache && lockingCache.issuer === issuer) return lockingCache.allowed;
  try {
    const c = await xrpl();
    const r = await c.request({ command: 'account_info', account: issuer });
    const allowed = Boolean(r.result.account_data.Flags & LSF_ALLOW_TRUSTLINE_LOCKING);
    lockingCache = { issuer, allowed };
    return allowed;
  } catch {
    return false;
  }
}

/**
 * What the principal is escrowed in.
 *
 * Payments settle in RLUSD. The escrowed principal falls back to XRP when the
 * token's issuer will not allow it to be locked — and says so, rather than
 * failing at signing time with a code that reads like our fault.
 */
export async function escrowAsset() {
  const asset = settlementAsset();
  if (!isIOU(asset)) return { asset, reason: null };
  if (await issuerAllowsLocking(asset.issuer)) return { asset, reason: null };
  return {
    asset: 'XRP',
    reason: `The RLUSD issuer ${asset.issuer} does not set asfAllowTrustLineLocking, so `
      + `TokenEscrow refuses it (tecNO_PERMISSION). The principal is escrowed in XRP; `
      + `every agentic payment still settles in RLUSD.`,
  };
}

export function amountField(asset, value) {
  return isIOU(asset)
    ? { currency: asset.currency, issuer: asset.issuer, value: String(value) }
    : xrpToDrops(String(value));
}

export function memoField(text) {
  return [{ Memo: { MemoType: convertStringToHex('kirim/trade'), MemoData: convertStringToHex(text) } }];
}

/**
 * SourceTag, per the XRPL Agent Wallet skill in the AI Starter Kit: every
 * transaction that passes the signing ceremony is attributable on-chain, and
 * the kit's default is used unless a domain sets its own. `0` is a valid value
 * meaning "suppress tagging", not an absence — so it is respected.
 */
const XRPL_STARTER_KIT_SOURCE_TAG = 20260530;
const tag = () => {
  const v = process.env.AGENT_SOURCE_TAG;
  if (v === undefined || v === '') return XRPL_STARTER_KIT_SOURCE_TAG;
  return Number(v);
};

/**
 * Simulate before signing, as the XRPL Payments skill prescribes.
 *
 * The ledger evaluates the transaction and reports what the result *would* be
 * — malformed fields, a missing trust line, a reserve shortfall — without
 * charging a fee or touching ledger state. Every failure this project spent
 * time chasing (tecUNFUNDED on an over-large escrow, tecNO_PERMISSION on a
 * racing FinishAfter) would have surfaced here, before a signature.
 */
async function simulate(c, prepared) {
  if (process.env.KIRIM_SKIP_SIMULATE === '1') return null;
  try {
    const r = await c.request({ command: 'simulate', tx_json: prepared });
    return r.result?.meta?.TransactionResult ?? null;
  } catch {
    // A node that does not offer `simulate` must not stop the build.
    return null;
  }
}

async function submit(wallet, tx) {
  const c = await xrpl();
  const prepared = await c.autofill(tx);
  if (tx.Fee) prepared.Fee = tx.Fee;

  const simulated = await simulate(c, prepared);
  if (simulated && simulated !== 'tesSUCCESS') {
    const err = new Error(`${tx.TransactionType} would fail: ${simulated} (simulated, nothing signed)`);
    err.result = simulated;
    err.simulated = true;
    throw err;
  }

  const signed = wallet.sign(prepared);
  const r = await c.submitAndWait(signed.tx_blob);
  const result = r.result.meta?.TransactionResult;
  if (result !== 'tesSUCCESS') {
    const err = new Error(tx.TransactionType + ' failed: ' + result);
    err.result = result; err.hash = r.result.hash;
    throw err;
  }
  return { hash: r.result.hash, result, explorer: explorerTx(r.result.hash), raw: r.result };
}

export async function trustSet(wallet, asset, limit = '1000000') {
  if (!isIOU(asset)) return { skipped: 'XRP needs no trustline' };
  return submit(wallet, {
    TransactionType: 'TrustSet',
    Account: wallet.address,
    LimitAmount: { currency: asset.currency, issuer: asset.issuer, value: limit },
  });
}

export async function pay({ wallet, to, value, asset, memo }) {
  return submit(wallet, {
    TransactionType: 'Payment',
    Account: wallet.address,
    Destination: to,
    Amount: amountField(asset, value),
    SourceTag: tag(),
    Memos: memoField(memo),
  });
}

/**
 * TokenEscrow when the asset is RLUSD, XRP escrow otherwise. The condition is
 * the instrument: only the holder of the fulfillment can release, and
 * CancelAfter returns the funds to the buyer with no dispute and no lawyer.
 */
export async function escrowCreate({ wallet, to, value, asset, memo, cancelAfterSeconds = 900, finishAfterSeconds = 0 }) {
  const { condition, fulfillment } = makeCondition();
  const now = Date.now();
  const c = await xrpl();
  const seq = (await c.request({ command: 'account_info', account: wallet.address })).result.account_data.Sequence;

  const out = await submit(wallet, {
    TransactionType: 'EscrowCreate',
    Account: wallet.address,
    Destination: to,
    Amount: amountField(asset, value),
    Condition: condition,
    // No FinishAfter. The crypto-condition is the gate — a time gate adds
    // nothing, and a FinishAfter only seconds ahead is racy: the ledger can
    // close past it before the transaction is validated, and rippled reports
    // that as tecNO_PERMISSION rather than anything about timing. Measured:
    // FinishAfter +2s fails, +60s succeeds, omitted succeeds.
    ...(finishAfterSeconds > 0
      ? { FinishAfter: isoTimeToRippleTime(new Date(now + finishAfterSeconds * 1000).toISOString()) }
      : {}),
    CancelAfter: isoTimeToRippleTime(new Date(now + cancelAfterSeconds * 1000).toISOString()),
    SourceTag: tag(),
    Memos: memoField(memo),
  });
  return { ...out, offerSequence: seq, condition, fulfillment };
}

export async function escrowFinish({ wallet, owner, offerSequence, condition, fulfillment }) {
  // No manual Fee. EscrowFinish carries a surcharge for the fulfillment, and
  // xrpl.js's autofill already applies the base fee x (33 + bytes/16) formula
  // (sugar/autofill.js). We were overriding a correct calculation with our own
  // and overpaying for it.
  return submit(wallet, {
    TransactionType: 'EscrowFinish',
    Account: wallet.address,
    Owner: owner,
    OfferSequence: offerSequence,
    Condition: condition,
    Fulfillment: fulfillment,
  });
}

export async function escrowCancel({ wallet, owner, offerSequence }) {
  return submit(wallet, {
    TransactionType: 'EscrowCancel',
    Account: wallet.address,
    Owner: owner,
    OfferSequence: offerSequence,
  });
}

/** The shape the x402 gate verifies against. Never trust a client's claim. */
export async function verifyTx(hash) {
  const c = await xrpl();
  const r = await c.request({ command: 'tx', transaction: hash });
  const t = r.result.tx_json ?? r.result;
  const amount = r.result.meta?.delivered_amount ?? t.Amount ?? r.result.DeliverMax;
  const value = typeof amount === 'string' ? dropsToXrp(amount) : amount?.value;
  return {
    validated: !!r.result.validated,
    result: r.result.meta?.TransactionResult,
    destination: t.Destination,
    account: t.Account,
    amountValue: String(value ?? '0'),
    currency: typeof amount === 'string' ? 'XRP' : amount?.currency,
    explorer: explorerTx(hash),
  };
}

export async function balances(address) {
  const c = await xrpl();
  return c.getBalances(address);
}

/**
 * Principal scaling.
 *
 * The story is a US$4,000 trade; the testnet cannot fund one. The RLUSD faucet
 * hands out 10 RLUSD per account per 24 hours, and the XRP faucet caps a wallet
 * at 100 XRP. So the principal is divided by SETTLEMENT_DIVISOR before it
 * touches the ledger, and every response carrying a scaled amount says so —
 * the trade is never quietly shrunk, and the demo never claims to have moved
 * four thousand of anything.
 *
 * Operating spend (x402 calls, all sub-dollar) is never scaled, so the amount a
 * provider verifies on-ledger is exactly the price it quoted.
 */
export function scalePrincipal(usd, escrowedAsset) {
  const divisor = Number(
    process.env.SETTLEMENT_DIVISOR || process.env.XRP_FALLBACK_DIVISOR || 1000,
  );
  // Name what actually moves. The principal may be escrowed in XRP while
  // payments settle in RLUSD, and a note that reports the wrong unit is worse
  // than no note.
  const asset = escrowedAsset ?? settlementAsset();
  const unit = isIOU(asset) ? 'RLUSD' : 'XRP';
  const cap = isIOU(asset)
    ? 'the RLUSD faucet allows 10 RLUSD per account per 24 hours'
    : 'the XRP faucet caps a wallet at 100 XRP';
  if (divisor === 1) return { value: String(usd), scaled: false, divisor: 1 };
  return {
    value: String(Number(usd) / divisor),
    scaled: true,
    divisor,
    unit,
    note: `Testnet scaling: US$${usd} settles as ${Number(usd) / divisor} ${unit} (divided by ${divisor}) because ${cap}. Set SETTLEMENT_DIVISOR=1 to settle at par.`,
  };
}

/**
 * XLS-70 Credentials — the contractor's track record.
 *
 * Kirim issues; the contractor accepts; anyone can read it back from the
 * contractor's own account. The record is portable and outlives us, which is
 * the honest answer to "why does this need a ledger at all".
 */
export async function credentialCreate({ wallet, subject, credentialType, uri, expirationSeconds }) {
  const tx = {
    TransactionType: 'CredentialCreate',
    Account: wallet.address,
    Subject: subject,
    CredentialType: convertStringToHex(credentialType),
    URI: convertStringToHex(uri),
  };
  if (expirationSeconds) {
    tx.Expiration = isoTimeToRippleTime(new Date(Date.now() + expirationSeconds * 1000).toISOString());
  }
  return submit(wallet, tx);
}

export async function credentialAccept({ wallet, issuer, credentialType }) {
  return submit(wallet, {
    TransactionType: 'CredentialAccept',
    Account: wallet.address,
    Issuer: issuer,
    CredentialType: convertStringToHex(credentialType),
  });
}

const ACCEPTED = 0x00010000;

export async function readCredentials(address) {
  const c = await xrpl();
  const r = await c.request({ command: 'account_objects', account: address, type: 'credential' });
  return r.result.account_objects.map((o) => {
    const uri = o.URI ? Buffer.from(o.URI, 'hex').toString() : '';
    const [path, query] = uri.split('?');
    const [, projectId, milestoneId, slug] = path.split('/');
    return {
      type: Buffer.from(o.CredentialType, 'hex').toString(),
      uri, projectId, milestoneId, slug,
      onTime: new URLSearchParams(query || '').get('onTime') === '1',
      accepted: Boolean(o.Flags & ACCEPTED),
      issuer: o.Issuer,
    };
  });
}

/**
 * Verify a client's release authorisation.
 *
 * The client authorises a release by sending a token payment from their own
 * wallet to Kirim, carrying a memo that binds it to one milestone. Any XRPL
 * wallet can produce that — Crossmark, GemWallet, Xaman, or a hand-built
 * transaction — so the authorisation does not depend on one vendor's
 * extension being installed on the day.
 *
 * We check the signature the only way that matters: the transaction is on the
 * ledger, it succeeded, it came from the client's account, it went to ours,
 * and its memo names this milestone and no other.
 */
export async function verifyAuthorisation({ hash, from, to, memo }) {
  const c = await xrpl();
  let r;
  try {
    r = await c.request({ command: 'tx', transaction: hash });
  } catch (e) {
    return { ok: false, reason: 'That transaction is not on the ledger.' };
  }
  const t = r.result.tx_json ?? r.result;

  if (!r.result.validated) return { ok: false, reason: 'The authorisation is not yet validated.' };
  if (r.result.meta?.TransactionResult !== 'tesSUCCESS') {
    return { ok: false, reason: `The authorisation failed on the ledger (${r.result.meta?.TransactionResult}).` };
  }
  if (t.TransactionType !== 'Payment') {
    return { ok: false, reason: 'The authorisation must be a Payment.' };
  }
  if (t.Account !== from) {
    return { ok: false, reason: `The authorisation was signed by ${t.Account}, not by the client account ${from}.` };
  }
  if (t.Destination !== to) {
    return { ok: false, reason: 'The authorisation was not addressed to Kirim.' };
  }

  const memos = (t.Memos ?? []).map((m) => {
    try { return Buffer.from(m.Memo?.MemoData ?? '', 'hex').toString('utf8'); }
    catch { return ''; }
  });
  if (!memos.includes(memo)) {
    return {
      ok: false,
      reason: `The authorisation does not name this milestone. Expected a memo of "${memo}".`,
    };
  }

  return { ok: true, payer: t.Account, hash, explorer: explorerTx(hash) };
}
