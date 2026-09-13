#!/usr/bin/env node
'use strict';

/**
 * One-time provisioning for the Privy-backed agent signer.
 *
 * Creates the policy, creates a wallet governed by it, and prints the env
 * values to add. Run once; it does not mutate anything that already exists.
 *
 *   PRIVY_APP_ID=... PRIVY_APP_SECRET=... node scripts/privy-setup.js
 *
 * Afterwards the new wallet address must be granted AGENT2_ROLE on each pool
 * (and AGENT1_ROLE if the pause/overdue routes are used). The contract checks
 * the role, so until that grant lands the server will sign correctly and the
 * transaction will revert.
 */

const path = require('path');
const { agentPolicyDocument, PRIVY_API } = require(
  path.join(__dirname, '..', 'server', 'services', 'privySigner'),
);

const APP_ID = process.env.PRIVY_APP_ID;
const APP_SECRET = process.env.PRIVY_APP_SECRET;
const CHAIN_ID = parseInt(process.env.EVM_CHAIN_ID || '5042002', 10);

function headers() {
  const auth = Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64');
  const h = {
    Authorization: `Basic ${auth}`,
    'privy-app-id': APP_ID,
    'Content-Type': 'application/json',
  };
  if (process.env.PRIVY_AUTHORIZATION_KEY) {
    h['privy-authorization-signature'] = process.env.PRIVY_AUTHORIZATION_KEY;
  }
  return h;
}

async function call(pathname, body) {
  const res = await fetch(`${PRIVY_API}${pathname}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`POST ${pathname} → ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return json;
}

async function main() {
  if (!APP_ID || !APP_SECRET) {
    console.error('Set PRIVY_APP_ID and PRIVY_APP_SECRET (Privy dashboard → Settings → Basics).');
    process.exit(2);
  }

  console.log('1/2  creating policy…');
  const policy = await call('/v1/policies', agentPolicyDocument({ chainId: CHAIN_ID }));
  console.log(`     policy id: ${policy.id}`);

  console.log('2/2  creating wallet governed by that policy…');
  const wallet = await call('/v1/wallets', {
    chain_type: 'ethereum',
    display_name: 'DeFa agent (AGENT2_ROLE)',
    policy_ids: [policy.id],
  });
  console.log(`     wallet id: ${wallet.id}`);
  console.log(`     address:   ${wallet.address}`);

  console.log('');
  console.log('Add to server/.env:');
  console.log('');
  console.log(`PRIVY_APP_ID=${APP_ID}`);
  console.log('PRIVY_APP_SECRET=<the secret you just used>');
  console.log(`PRIVY_WALLET_ID=${wallet.id}`);
  console.log(`PRIVY_WALLET_ADDRESS=${wallet.address}`);
  console.log('');
  console.log('Then grant the new address its on-chain roles, or drawdowns will revert:');
  console.log('');
  console.log(`  AGENT2_ROLE → ${wallet.address}   (executeDrawdown)`);
  console.log(`  AGENT1_ROLE → ${wallet.address}   (setPaused, setScOverdue)`);
  console.log('');
  console.log('Remove AGENT_PRIVATE_KEY once drawdowns are confirmed working.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
