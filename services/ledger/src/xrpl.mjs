import { Client, xrpToDrops, dropsToXrp, convertStringToHex, isoTimeToRippleTime } from 'xrpl';
import { makeCondition, finishFee } from './conditions.mjs';

const ENDPOINT = process.env.XRPL_ENDPOINT || 'wss://s.altnet.rippletest.net:51233';
export const EXPLORER = process.env.XRPL_EXPLORER || 'https://testnet.xrpl.org';
export const explorerTx = (h) => `${EXPLORER}/transactions/${h}`;

let client;
export async function xrpl() {
  if (client?.isConnected()) return client;
  client = new Client(ENDPOINT);
  await client.connect();
  return client;
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

export function amountField(asset, value) {
  return isIOU(asset)
    ? { currency: asset.currency, issuer: asset.issuer, value: String(value) }
    : xrpToDrops(String(value));
}

export function memoField(text) {
  return [{ Memo: { MemoType: convertStringToHex('kirim/trade'), MemoData: convertStringToHex(text) } }];
}

const tag = () => Number(process.env.AGENT_SOURCE_TAG || 880402);

async function submit(wallet, tx) {
  const c = await xrpl();
  const prepared = await c.autofill(tx);
  if (tx.Fee) prepared.Fee = tx.Fee;
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
  return submit(wallet, {
    TransactionType: 'EscrowFinish',
    Account: wallet.address,
    Owner: owner,
    OfferSequence: offerSequence,
    Condition: condition,
    Fulfillment: fulfillment,
    Fee: finishFee(fulfillment),
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
export function scalePrincipal(usd) {
  const divisor = Number(
    process.env.SETTLEMENT_DIVISOR || process.env.XRP_FALLBACK_DIVISOR || 1000,
  );
  const asset = settlementAsset();
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
