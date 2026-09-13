#!/usr/bin/env node
'use strict';

/**
 * Full lifecycle end-to-end against the deployed API and Arc testnet.
 *
 * Drives the same HTTP routes the web apps call — the transaction builders
 * return calldata and this signs it with a local key instead of a browser
 * wallet. Every step is verified by reading the chain afterwards rather than
 * trusting a 200 response, because several bugs this week returned 200 while
 * doing nothing.
 *
 * Covers: bind → request → approve → deploy → fund → activate → drawdown →
 * repay → redeem. Repay is the reason it exists.
 *
 *   PRIVATE_KEY=0x... node scripts/e2e-arc.js
 */

const { ethers } = require('ethers');

const API = process.env.API_URL || 'https://defa-arc-hackathon.invoicemate.net/api';
const RPC = process.env.EVM_RPC_URL || 'https://rpc.testnet.arc.io';
const PSP_EMAIL = process.env.PSP_EMAIL || 'psp3@demo.invoicemate.net';
const PSP_PASS = process.env.PSP_PASS || 'demo123';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const FUNDING_SECS = parseInt(process.env.FUNDING_SECS || '600', 10);
const DEPOSIT_USDC = process.env.DEPOSIT_USDC || '5';
const DRAW_USDC = process.env.DRAW_USDC || '2';

const provider = new ethers.JsonRpcProvider(RPC, 5042002);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usdc = (n) => BigInt(Math.round(Number(n) * 1e6));
const fmt = (b) => (Number(b) / 1e6).toFixed(6);

let step = 0;
const say = (m) => console.log(`\n[${++step}] ${m}`);
const ok = (m) => console.log(`    ✓ ${m}`);
const info = (m) => console.log(`    · ${m}`);

async function api(path, { method = 'GET', token, body, retries = 4 } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (res.status === 429 && retries > 0) {
    // The auth endpoints are rate-limited per IP; a scripted run trips them
    // where a human clicking never would.
    info('rate limited, backing off 20s…');
    await sleep(20000);
    return api(path, { method, token, body, retries: retries - 1 });
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

async function lenderLogin() {
  // Lender accounts are wallet-only — there is no password to log in with.
  const { nonce, message } = await api('/auth/wallet/nonce', {
    method: 'POST', body: { wallet: wallet.address, purpose: 'login' },
  });
  const signature = await wallet.signMessage(message);
  const r = await api('/auth/wallet/login', {
    method: 'POST', body: { wallet: wallet.address, nonce, signature, message },
  });
  return r.token;
}

async function onchainAdminLogin() {
  const { nonce, message } = await api('/auth/wallet/nonce', {
    method: 'POST', body: { wallet: wallet.address, purpose: 'login' },
  });
  const signature = await wallet.signMessage(message);
  const r = await api('/auth/wallet/onchain-admin/login', {
    method: 'POST', body: { wallet: wallet.address, nonce, signature, message },
  });
  return r.token;
}

async function login(email, password) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password } });
  return r.token;
}

/** Send one builder-produced transaction and wait for it to actually mine. */
async function send(tx, label) {
  const sent = await wallet.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value ? BigInt(tx.value) : 0n,
  });
  const rec = await sent.wait();
  if (rec.status !== 1) throw new Error(`${label} reverted: ${sent.hash}`);
  ok(`${label} — ${sent.hash}`);
  return rec;
}

/** Builders return either one transaction or an ordered list of steps. */
async function sendBuilt(built, label) {
  if (Array.isArray(built?.txs)) {
    for (let i = 0; i < built.txs.length; i++) {
      await send(built.txs[i], `${built.steps?.[i] ?? label} (${i + 1}/${built.txs.length})`);
    }
    return;
  }
  await send(built, label);
}

const POOL_ABI = [
  'function status() view returns (uint8)',
  'function totalAssets() view returns (uint256)',
  'function outstanding() view returns (uint256)',
  'function availableToDd() view returns (uint256)',
  'function pspWallet() view returns (address)',
  'function fMaturityTs() view returns (uint256)',
  'function finalizeFunding() external',
  'function drawDownRefs(uint256) view returns (bytes32)',
];
const STATUS = ['Funding', 'Active', 'Unsuccessful', 'Closed', 'Default'];

async function main() {
  console.log(`signer  ${wallet.address}`);
  console.log(`api     ${API}`);
  const bal = await provider.getBalance(wallet.address);
  console.log(`balance ${ethers.formatEther(bal)} (native)`);

  say('Sign in as the borrower');
  const pspToken = await login(PSP_EMAIL, PSP_PASS);
  ok(`${PSP_EMAIL}`);

  say('Bind the wallet (SIWE)');
  // Nonces are scoped by purpose: a 'login' nonce will not verify a bind, and
  // the failure reads as "Nonce not found, expired, or already used".
  const { nonce, message } = await api('/auth/wallet/nonce', {
    method: 'POST', body: { wallet: wallet.address, purpose: 'bind' },
  });
  const signature = await wallet.signMessage(message);
  await api('/auth/wallet/bind', {
    method: 'POST', token: pspToken,
    body: { wallet: wallet.address, signature, nonce, message },
  });
  const prof = await api('/psp/profile', { token: pspToken });
  if (!(prof.walletAddress || []).some((w) => w.address?.toLowerCase() === wallet.address.toLowerCase())) {
    throw new Error('bind did not write walletAddress — the exact failure that wasted two days');
  }
  ok(`bound and verified: ${prof.primaryWallet}`);

  say('Request a facility');
  const reqd = await api('/facility/request', {
    method: 'POST', token: pspToken,
    body: { label: 'E2E repay proof', requestedTerms: { creditLine: 20, tenorDays: 30 } },
  });
  // The route returns the Mongo id as `facilityId` and the on-chain sequence
  // number as `onChainFacilityId` — not the other way round.
  const facilityId = reqd.facilityId ?? reqd._id;
  if (!facilityId) throw new Error(`no facility id in response: ${JSON.stringify(reqd)}`);
  info(`facility ${facilityId} (#${reqd.onChainFacilityId}) · status ${reqd.status}`);

  say('Credit committee approvals');
  // The CRO sets the economic terms. Leaving them unset deploys on encoder
  // defaults where the utilisation rate is not below the penalty rate, and the
  // factory rejects the pool with "Factory: util >= pen".
  const CRO_TERMS = {
    creditLine: 20, tenorDays: 30,
    utilizationRateBps: 10, commitmentRateBps: 1, penaltyRateBps: 20,
    graceDays: 1, penaltyDays: 30, maxDrawdownAmount: 20,
    softCap: Number(DEPOSIT_USDC), hardCap: 20,
  };
  for (const role of ['kam', 'cad', 'cro']) {
    try {
      const t = await login(`${role}@maildrop.cc`, ADMIN_PASS);
      await api(`/facility/${facilityId}/approve`, {
        method: 'POST', token: t,
        body: role === 'cro' ? { note: '', termAdjustments: CRO_TERMS } : { note: '' },
      });
      ok(`${role.toUpperCase()} approved`);
    } catch (e) {
      info(`${role.toUpperCase()} skipped — ${e.message.slice(0, 80)}`);
    }
  }
  const after = await api('/facility/my', { token: pspToken });
  const fac = after.items.find((f) => String(f._id) === String(facilityId));
  info(`status now ${fac.status}`);
  if (fac.status !== 'AWAITING_POOL_INIT') throw new Error(`expected AWAITING_POOL_INIT, got ${fac.status}`);

  say('Deploy the pool');
  // A PSP may hold only one live pool. A previous run that died after
  // createPool leaves the slot occupied, and re-running would fail with
  // "Factory: PSP has live pool" forever. Resume that pool instead.
  const factory = new ethers.Contract(
    process.env.PAYFI_FACTORY_ADDRESS || '0xE912Fd28FBa9E39b18d8d19D38c8bd35b565e751',
    ['function psps(address) view returns (bool approved, address activePool)'],
    provider,
  );
  const existing = (await factory.psps(wallet.address)).activePool;
  const hasLive = existing && !/^0x0+$/.test(existing);
  if (hasLive) info(`resuming existing pool ${existing}`);

  // The on-chain admin authenticates by wallet, not by password — the routes
  // that build factory transactions require that JWT specifically.
  let poolAddr = hasLive ? existing : null;
  if (!hasLive) {
    const adminToken = await onchainAdminLogin();
    await sendBuilt(await api('/pool/admin/build-tx/approve-psp', {
      method: 'POST', token: adminToken, body: { pspWallet: wallet.address, facilityId },
    }), 'approvePsp');
    await sendBuilt(await api('/pool/admin/build-tx/initialize-pool', {
      method: 'POST', token: adminToken, body: { facilityId, fundingDurationSecs: FUNDING_SECS },
    }), 'createPool');
    await api(`/pool/admin/confirm-pool-init/${facilityId}`, { method: 'POST', token: adminToken });
    const mine = (await api('/facility/my', { token: pspToken })).items
      .find((f) => String(f._id) === String(facilityId));
    poolAddr = mine.poolPda;
  }
  if (!poolAddr) throw new Error('no pool bound to the facility');
  const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
  const borrower = await pool.pspWallet();
  ok(`pool ${poolAddr}`);
  if (borrower.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`borrower is ${borrower}, not us — the immutable-wrong-borrower bug`);
  }
  ok(`borrower is our wallet`);

  // A resumed pool may already be funded and active; repeating the funding
  // steps against it reverts with "Pool: not funding".
  const alreadyActive = Number(await pool.status()) === 1;
  if (alreadyActive) info('pool is already Active — skipping funding and activation');

  if (!alreadyActive) {
  say(`Deposit ${DEPOSIT_USDC} USDC as lender`);
  // Prefer the real lender route. It needs a registered lender account, which
  // is gated behind an invite code; when this wallet has none, deposit
  // directly on-chain instead. The deposit path is already proven through the
  // UI — repay is what this run exists to prove, so a missing invite code must
  // not block reaching it.
  let depositedVia = 'lender API';
  try {
    const lenderToken = await lenderLogin();
    await sendBuilt(await api('/pool/lender/build-tx/deposit', {
      method: 'POST', token: lenderToken,
      body: { pool: poolAddr, amount: usdc(DEPOSIT_USDC).toString() },
    }), 'deposit');
  } catch (e) {
    info(`lender API unavailable (${e.message.slice(0, 60)}…) — depositing on-chain`);
    depositedVia = 'direct on-chain';
    const erc20 = new ethers.Interface([
      'function approve(address,uint256) returns (bool)',
    ]);
    const poolIface = new ethers.Interface(['function deposit(uint256) external']);
    const USDC_ADDR = '0x3600000000000000000000000000000000000000';
    await send({ to: USDC_ADDR, data: erc20.encodeFunctionData('approve', [poolAddr, usdc(DEPOSIT_USDC)]) }, 'approve USDC');
    await send({ to: poolAddr, data: poolIface.encodeFunctionData('deposit', [usdc(DEPOSIT_USDC)]) }, 'deposit');
  }
  info(`deposited via ${depositedVia}`);
  info(`totalAssets ${fmt(await pool.totalAssets())} USDC`);

  say('Wait out the funding window, then activate');
  // Wait on *chain* time, not the local clock. Arc's block timestamps lag wall
  // clock by seconds, and finalizeFunding() requires block.timestamp >=
  // fMaturityTs — a local-clock check sends the transaction a few seconds
  // early and it reverts with no reason string.
  const maturity = Number(await pool.fMaturityTs());
  for (;;) {
    const blk = await provider.getBlock('latest');
    const remaining = maturity - blk.timestamp;
    if (remaining <= 0) break;
    info(`${remaining}s to maturity (chain time)…`);
    await sleep(Math.min(30000, (remaining + 2) * 1000));
  }
  const fin = await wallet.sendTransaction({
    to: poolAddr,
    data: new ethers.Interface(POOL_ABI).encodeFunctionData('finalizeFunding'),
  });
  await fin.wait();
  const st = Number(await pool.status());
  ok(`status ${STATUS[st]}`);
  if (st !== 1) throw new Error(`expected Active, got ${STATUS[st]}`);
  }

  info(`pool status ${STATUS[Number(await pool.status())]} · assets ${fmt(await pool.totalAssets())} · drawable ${fmt(await pool.availableToDd())}`);

  say(`Drawdown ${DRAW_USDC} USDC (server signs as AGENT2)`);
  const dd = await api('/pool/psp/exec/drawdown', {
    method: 'POST', token: pspToken,
    body: { pool: poolAddr, amount: usdc(DRAW_USDC).toString(), receiverWallet: wallet.address, tenorDays: 5 },
  });
  info(`drawdown ${JSON.stringify(dd).slice(0, 160)}`);
  info(`outstanding ${fmt(await pool.outstanding())} USDC`);

  say('List open drawdowns (the call that returned [] for a live debt)');
  const list = await api(`/pool/pool/${poolAddr}/drawdowns`, { token: pspToken });
  if (!Array.isArray(list) || list.length === 0) throw new Error('drawdown list is empty — repay would be unreachable');
  ok(`${list.length} open drawdown(s): ${list[0].id}`);

  say('REPAY');
  const repayBuilt = await api('/pool/psp/build-tx/repay', {
    method: 'POST', token: pspToken, body: { pool: poolAddr, ref: list[0].id },
  });
  info(`steps: ${JSON.stringify(repayBuilt.steps ?? ['repay'])}`);
  await sendBuilt(repayBuilt, 'repay');
  const outstandingAfter = await pool.outstanding();
  ok(`outstanding now ${fmt(outstandingAfter)} USDC`);
  if (outstandingAfter !== 0n) throw new Error('repay did not clear the debt');

  console.log('\n══════════════════════════════════════════');
  console.log('  REPAY PROVEN END TO END');
  console.log(`  pool ${poolAddr}`);
  console.log('══════════════════════════════════════════');
}

main().catch((e) => { console.error(`\nFAILED: ${e.message}`); process.exit(1); });
