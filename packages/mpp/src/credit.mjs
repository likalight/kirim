import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// `require` does not exist in an ES module, so resolving an optional
// dependency needs one built for this file.
const require = createRequire(import.meta.url);

/**
 * Claw Credit — buying evidence on credit instead of pre-funding it.
 *
 * The idea is the right one for this product. Today the buyer's wallet must hold
 * XRP before her agent can buy a thirty-cent inspection; with agent credit it
 * does not, and the checks are settled by a credit line and repaid later. That
 * is what turns a prototype into something a homeowner would actually use.
 *
 * It is not live here, and the reasons are worth stating plainly rather than
 * hiding behind a stub:
 *
 *   1. Registration requires an `invite_code`. We do not have one.
 *   2. The SDK expects an OpenClaw workspace and reads credentials from
 *      ~/.openclaw/agents/<agent>/agent/clawcredit.json.
 *   3. A new agent gets no credit on registration. It enters a
 *      "pre-qualification monitoring phase" that needs a HEARTBEAT.md check and
 *      time to elapse.
 *   4. There is no sandbox. The published skill mentions Base/USDC,
 *      Solana/USDC and XRPL/RLUSD, and never a testnet — so the whole path is
 *      mainnet-shaped, which a testnet prototype cannot exercise.
 *
 * So the integration is written against the documented API and gated behind
 * CLAW_CREDIT_ENABLED. `status()` reports exactly which gate is closed instead
 * of pretending. When an invite code arrives, this becomes live by setting one
 * environment variable — nothing else in Kirim changes, because the agent asks
 * the ledger service to buy a URL either way.
 */

const CREDENTIAL_PATH = () => path.join(
  os.homedir(), '.openclaw', 'agents',
  process.env.CLAW_AGENT || 'default', 'agent', 'clawcredit.json',
);

/** What is standing between us and paying on credit. */
export function status() {
  const enabled = process.env.CLAW_CREDIT_ENABLED === '1';
  const credentialFile = CREDENTIAL_PATH();
  const registered = fs.existsSync(credentialFile);
  const inviteCode = Boolean(process.env.CLAW_INVITE_CODE);

  let sdk = false;
  try { require.resolve('@t54-labs/clawcredit-sdk'); sdk = true; } catch { sdk = false; }

  const blockers = [];
  if (!enabled) blockers.push('CLAW_CREDIT_ENABLED is not 1 — credit is off by default.');
  if (!sdk) blockers.push('@t54-labs/clawcredit-sdk is not installed.');
  if (!registered && !inviteCode) {
    blockers.push(`No credentials at ${credentialFile} and no CLAW_INVITE_CODE to register with. `
      + 'Claw Credit registration is invite-only.');
  }
  if (!registered && inviteCode) {
    blockers.push('An invite code is present but the agent has not registered yet — '
      + 'run registration, then expect a pre-qualification period before credit is issued.');
  }

  return {
    available: blockers.length === 0,
    enabled, sdk, registered, inviteCode,
    credentialFile,
    settlement: { chain: 'XRPL', asset: 'RLUSD' },
    note: 'Claw Credit settles on Base/USDC, Solana/USDC or XRPL/RLUSD. Its published '
      + 'documentation describes no sandbox or testnet, so this path cannot be exercised '
      + 'from a testnet prototype even once an invite code is issued.',
    blockers,
  };
}

let credit = null;

async function client() {
  if (credit) return credit;
  const { ClawCredit } = await import('@t54-labs/clawcredit-sdk');
  credit = new ClawCredit({ agentName: process.env.CLAW_AGENT_NAME || 'kirim-milestone-agent' });
  if (process.env.CLAW_STATE_DIR) {
    credit.setOpenClawContext({
      stateDir: process.env.CLAW_STATE_DIR,
      agentId: process.env.CLAW_AGENT || 'main',
      workspaceDir: process.env.CLAW_WORKSPACE_DIR,
    });
  }
  return credit;
}

/**
 * Buy an x402 resource on credit. ClawCredit pays the provider on-chain and
 * proxies the HTTP call, so the response comes back through it rather than
 * from a request we paid for ourselves.
 */
export async function buyOnCredit(url, { priceUsd, reason }) {
  const c = await client();
  const result = await c.pay({
    transaction: {
      recipient: url,
      amount: Number(priceUsd),
      chain: 'XRPL',
      asset: 'RLUSD',
    },
    request_body: {
      http: { url, method: 'GET', headers: { accept: 'application/json' }, timeout_s: 30 },
    },
    context: { reasoning_process: reason },
  });

  if (result.status !== 'success') {
    const e = new Error(`Claw Credit declined: ${result.status} ${result.message ?? ''}`);
    e.credit = result;
    throw e;
  }

  return {
    data: result.merchant_response,
    txHash: result.tx_hash,
    amountCharged: result.amount_charged,
    remainingBalance: result.remaining_balance,
    settledBy: 'claw-credit',
  };
}
