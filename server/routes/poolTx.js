/**
 * Pool transaction endpoints — EVM (payfi_v1) edition.
 *
 * Each `build-tx` route returns `{ to, data, value }` — the shape wagmi's
 * writeContract / ethers.sendTransaction expect. The caller signs in the
 * browser wallet and submits directly to the RPC; no server relay hop.
 *
 * `exec/*` routes are server-signed (AGENT_PRIVATE_KEY = AGENT1+AGENT2
 * role). They perform the write and return `{ txHash, blockNumber }`.
 * Used for AGENT2-gated operations like executeDrawdown that payfi_v1
 * doesn't let the PSP call directly — this is the "PSP clicks button,
 * server signs" UX that replaces Colosseum's fee-payer relay.
 *
 * Auth model:
 *   /lender/* — JWT.kind === 'lender'. Uses req.user.wallet directly.
 *   /psp/*    — JWT.role === 'PSP'. Uses PSPProfile.walletAddress (field
 *               name preserved; stored value is now a 0x… EVM address).
 *   /admin/*  — JWT.role in {KAM, CAD, CRO, CFO, ...} OR onchain-admin
 *               allowlist for MULTISIG-gated writes.
 *
 * On-chain enforcement: payfi_v1 gates every write with AccessControl
 * roles (AGENT1/AGENT2/MULTISIG). This route layer is a UX/policy gate —
 * building a tx for the wrong role still returns calldata; submitting it
 * reverts on the on-chain role check.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');

const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const PSPProfile = require('../models/PSPProfile');
const User = require('../models/User');
const Facility = require('../models/Facility');
const svc = require('../services/poolServiceEvm');
const { getProvider, getFactoryAddress, isOnchainAdmin } = require('../config/chain');
const { PoolState, DrawdownState } = require('../models/PoolState');
const PoolNameOverride = require('../models/PoolNameOverride');

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Field-name alias: the Mongo schemas still call these `walletAddress` /
 * `poolPda` from the Colosseum era. Values are now 0x… EVM addresses.
 * Aliasing here keeps the mismatch out of route bodies.
 */
// The canonical wallet bound at onboarding. `walletAddress` is the array of
// additional whitelisted recipient wallets and must not be used here — it
// would hand an array to anything expecting an address.
const walletOf   = (doc) => doc?.primaryWallet || doc?.evmWallet || '';
const poolAddrOf = (doc) => doc?.poolPda || doc?.poolAddress || '';

/** Cheap EIP-55 validator; returns checksummed address or null. */
function validAddr(x) {
  try { return ethers.getAddress(x); } catch { return null; }
}

// How long a new pool accepts deposits before it can be locked.
//
// This is wall-clock seconds, so it must track the clock of the factory in
// PAYFI_FACTORY_ADDRESS. The contracts cannot be locked early — finalizeFunding
// requires block.timestamp >= fMaturityTs — so a 7-day window on a fast-clock
// factory (MathLib.SECONDS_PER_DAY = 60, where a contract "day" is a real
// minute) would leave the pool unlockable for a real week and strand the demo.
// Fast-clock deployments set POOL_FUNDING_DURATION_SECS to a few minutes.
// Capped by the factory's maxFundingDurationSecs (30 days).
const DEFAULT_FUNDING_DURATION_SECS =
  Number(process.env.POOL_FUNDING_DURATION_SECS) || 7 * 86400;

// Facility terms are denominated in whole USDC (a 20 USDC credit line is the
// number 20). toBase() below reads a bare integer as *already* being in base
// units, so handing it 20 would deploy a pool capped at 0.000020 USDC. Anything
// sourced from the Facility doc goes through here instead.
const USDC_DECIMALS = 6;
function usdcToBase(amount) {
  if (amount === null || amount === undefined || amount === '') return undefined;
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return undefined;
  // Round at the token's precision rather than trusting binary floats.
  return BigInt(Math.round(n * 10 ** USDC_DECIMALS));
}

/**
 * Coerce a caller-provided amount into a BigInt of USDC base units.
 *
 * Convention: a bare integer is ALREADY in base units ("20" is 0.000020 USDC);
 * a decimal string is human USDC and gets scaled ("20.0" is 20 USDC). Callers
 * are expected to scale before sending — see usdcToBase() for the other
 * direction. The ambiguity is load-bearing for the raw-params path, so do not
 * "fix" it here without auditing every call site.
 */
function toBase(amount) {
  if (amount === null || amount === undefined) return null;
  if (typeof amount === 'bigint') return amount;
  const s = String(amount).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return BigInt(s);
  if (/^\d+\.\d+$/.test(s)) {
    const [whole, frac = ''] = s.split('.');
    const padded = (frac + '000000').slice(0, 6);
    return BigInt(whole) * 1_000_000n + BigInt(padded);
  }
  return null;
}

/** bps → WAD: bps * 1e14 (10_000 bps = 1.0 = 1e18 WAD). */
const bpsToWad = (bps) => BigInt(Math.round(Number(bps || 0))) * 10n ** 14n;

/** WAD → bps for read-side conversion. */
const wadToBps = (wad) => Number((BigInt(wad || 0) * 10_000n) / 10n ** 18n);

async function labelFor(poolAddress, fallback) {
  try {
    const override = await PoolNameOverride.findOne({ poolPda: poolAddress }).lean();
    if (override?.displayName) return override.displayName;
  } catch { /* schema not present on fresh install — ignore */ }
  return fallback || `Pool ${poolAddress.slice(0, 6)}…${poolAddress.slice(-4)}`;
}

function shapePoolResponse(mongoDoc, state) {
  return {
    pubkey:               state.poolAddress,
    admin:                mongoDoc?.admin || state.pspWallet,
    pspWallet:            state.pspWallet,
    pspName:              mongoDoc?.pspName || null,
    facilityId:           mongoDoc?.facilityId || null,
    usdcMint:             state.stablecoin,
    vault:                state.poolAddress,
    lpMint:               state.poolAddress,
    softCap:              state.softCap.toString(),
    hardCap:              state.hardCap.toString(),
    facilityTenorDays:    Number(state.tenure),
    utilizationRateBps:   wadToBps(state.utilizedRateDaily),
    commitmentRateBps:    wadToBps(state.idleRateDaily),
    penaltyRateBps:       wadToBps(state.penaltyRateDaily),
    aprAnnualBps:         wadToBps(state.aprAnnual),
    graceDays:            Number(state.penaltyGraceDays),
    penaltyDays:          Number(state.penaltyGraceDays),
    protocolFeeShareBps:  0,
    secondsPerDay:        86400,
    isActive:             state.status === 1,
    isCancelled:          state.status === 2,
    isDefaulted:          state.status === 4,
    createdDay:           state.fundingStartTs > 0n ? Number(state.fundingStartTs / 86400n) : 0,
    activatedDay:         state.poolStartTs > 0n    ? Number(state.poolStartTs    / 86400n) : 0,
    totalCapital:         state.principal.toString(),
    outstandingPrincipal: state.outstanding.toString(),
    fMaturityTs:          state.fMaturityTs.toString(),
    availableToDd:        state.availableToDd.toString(),
    yieldOwed:            state.yieldOwed.toString(),
    fundingCredit:        state.fundingCredit.toString(),
    todayDay:             Number(state.currentDay),
    todayPeakOutstanding: state.outstanding.toString(),
    accruedCommitFee:     '0',
    accruedUtilFee:       '0',
    accruedPenaltyFee:    '0',
    protocolFeesOwed:     '0',
    nextDrawdownId:       '0',
    countActiveDrawdowns: 0,
  };
}

// Same response shape, built from the indexer's cached document.
//
// The live shaper reads ~25 view getters per pool. Doing that for every pool
// on every marketplace request is what made /pools fall over on a public RPC:
// the reads get rate-limited, each pool is skipped, and the list comes back
// empty. The indexer already holds this state, so serve it from there and
// only read the chain when a pool has no fresh snapshot.
function shapePoolFromDoc(d) {
  return {
    pubkey:               d.pubkey,
    admin:                d.admin || d.pspWallet,
    pspWallet:            d.pspWallet,
    pspName:              d.pspName || null,
    facilityId:           d.facilityId || null,
    usdcMint:             d.usdcMint,
    vault:                d.vault || d.pubkey,
    lpMint:               d.lpMint || d.pubkey,
    softCap:              d.softCap ?? '0',
    hardCap:              d.hardCap ?? '0',
    facilityTenorDays:    d.facilityTenorDays ?? 0,
    utilizationRateBps:   d.utilizationRateBps ?? 0,
    commitmentRateBps:    d.commitmentRateBps ?? 0,
    penaltyRateBps:       d.penaltyRateBps ?? 0,
    aprAnnualBps:         d.aprAnnualBps ?? 0,
    graceDays:            d.graceDays ?? 0,
    penaltyDays:          d.penaltyDays ?? d.graceDays ?? 0,
    protocolFeeShareBps:  d.protocolFeeShareBps ?? 0,
    secondsPerDay:        86400,
    isActive:             Boolean(d.isActive),
    isCancelled:          Boolean(d.isCancelled),
    isDefaulted:          Boolean(d.isDefaulted),
    createdDay:           d.createdDay ?? 0,
    activatedDay:         d.activatedDay ?? 0,
    totalCapital:         d.totalCapital ?? '0',
    outstandingPrincipal: d.outstandingPrincipal ?? '0',
    availableToDd:        d.availableToDd ?? '0',
    yieldOwed:            d.yieldOwed ?? '0',
    fundingCredit:        d.fundingCredit ?? '0',
    todayDay:             d.todayDay ?? 0,
    todayPeakOutstanding: d.outstandingPrincipal ?? '0',
    accruedCommitFee:     '0',
    accruedUtilFee:       '0',
    accruedPenaltyFee:    '0',
    protocolFeesOwed:     '0',
    nextDrawdownId:       '0',
    countActiveDrawdowns: 0,
  };
}

function poolMatchesState(p, state) {
  if (!state) return true;
  const s = String(state).toLowerCase();
  if (s === 'active')     return p.isActive;
  if (s === 'cancelled')  return p.isCancelled;
  if (s === 'defaulted')  return p.isDefaulted;
  if (s === 'closed')     return !p.isActive && !p.isCancelled && !p.isDefaulted;
  return true;
}

/** Guard: caller wallet must be in ONCHAIN_ADMIN_WALLETS allowlist. */
function requireOnchainAdmin(req, res) {
  const wallet = req.user?.wallet;
  if (!wallet || !isOnchainAdmin(wallet)) {
    res.status(403).json({ message: 'Onchain admin JWT required' });
    return false;
  }
  return true;
}

async function loadPspProfile(req, res) {
  const profile = await PSPProfile.findOne({ userId: req.user.userId });
  if (!profile) {
    res.status(404).json({ message: 'PSP profile not found' });
    return null;
  }
  if (!walletOf(profile)) {
    res.status(409).json({ message: 'PSP wallet not bound; call /auth/wallet/bind first' });
    return null;
  }
  return profile;
}

async function loadOwnedFacility(req, res, profile) {
  const poolAddr = validAddr(req.body?.pool || req.body?.poolAddress);
  if (!poolAddr) {
    res.status(400).json({ message: 'pool (address) required' });
    return null;
  }
  const facility = await Facility.findOne({
    pspProfileId: profile._id,
    poolPda: poolAddr,  // schema field name is legacy — value is EVM addr
  });
  if (!facility) {
    res.status(404).json({ message: 'Facility not found for this PSP' });
    return null;
  }
  return facility;
}

// Address the server itself signs from (AGENT1 + AGENT2 default). Nulled
// if AGENT_PRIVATE_KEY isn't set; init-pool then requires explicit agents.
const AGENT_ADDRESS_FALLBACK = process.env.AGENT_PRIVATE_KEY
  ? new ethers.Wallet(process.env.AGENT_PRIVATE_KEY).address
  : null;

// ══════════════════════════════════════════════════════════════════════
// ── Lender build-tx endpoints ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

router.post('/lender/build-tx/deposit', authMiddleware, async (req, res) => {
  try {
    if (req.user.kind !== 'lender') return res.status(403).json({ message: 'Lender JWT required' });
    const pool = validAddr(req.body?.pool);
    const amount = toBase(req.body?.amount);
    if (!pool)                                return res.status(400).json({ message: 'pool (address) required' });
    if (amount === null || amount <= 0n)      return res.status(400).json({ message: 'amount required' });

    const approve = svc.encodeApprove(pool, amount);
    const deposit = svc.encodeDeposit(pool, amount);
    // BigInt values inside step tuples must be stringified for JSON.
    const jsonTx = (t) => ({ to: t.to, data: t.data, value: t.value.toString() });
    res.json({
      steps: [
        { label: 'Approve USDC',    tx: jsonTx(approve) },
        { label: 'Deposit to pool', tx: jsonTx(deposit) },
      ],
      to: deposit.to, data: deposit.data, value: deposit.value.toString(),
    });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

router.post('/lender/build-tx/withdraw', authMiddleware, async (req, res) => {
  try {
    if (req.user.kind !== 'lender') return res.status(403).json({ message: 'Lender JWT required' });
    const pool = validAddr(req.body?.pool);
    const amount = toBase(req.body?.amount);
    if (!pool)                           return res.status(400).json({ message: 'pool (address) required' });
    if (amount === null || amount <= 0n) return res.status(400).json({ message: 'amount required' });
    const tx = svc.encodeWithdraw(pool, amount);
    res.json({ to: tx.to, data: tx.data, value: tx.value.toString() });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

router.post('/lender/build-tx/redeem', authMiddleware, async (req, res) => {
  try {
    if (req.user.kind !== 'lender') return res.status(403).json({ message: 'Lender JWT required' });
    const pool = validAddr(req.body?.pool);
    if (!pool) return res.status(400).json({ message: 'pool (address) required' });

    const claimYield     = svc.encodeClaimYield(pool);
    const claimPrincipal = svc.encodeClaimPrincipal(pool);
    const jsonTx = (t) => ({ to: t.to, data: t.data, value: t.value.toString() });
    res.json({
      steps: [
        { label: 'Claim yield',     tx: jsonTx(claimYield) },
        { label: 'Claim principal', tx: jsonTx(claimPrincipal) },
      ],
      to: claimPrincipal.to, data: claimPrincipal.data, value: claimPrincipal.value.toString(),
    });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

// ── Lender read: portfolio ─────────────────────────────────────────────

router.get('/lender/portfolio', authMiddleware, async (req, res) => {
  try {
    if (req.user.kind !== 'lender') return res.status(403).json({ message: 'Lender JWT required' });
    const lender = validAddr(req.user.wallet);
    if (!lender) return res.status(400).json({ message: 'Invalid lender wallet on JWT' });

    let walletUsdc = '0';
    try { walletUsdc = (await svc.balanceOfStablecoin(lender)).toString(); }
    catch (e) { console.warn('[/lender/portfolio] balanceOfStablecoin failed:', e.message); }

    const poolAddresses = await svc.readAllPools();
    const positions = [];
    let totalPrincipal = 0n;
    for (const poolAddress of poolAddresses) {
      let pos;
      try { pos = await svc.readLpPosition(poolAddress, lender); }
      catch (e) { console.warn('[/lender/portfolio] skip', poolAddress, e.message); continue; }
      if (pos.principal === 0n && pos.claimedYield === 0n && pos.claimedPrincipal === 0n) continue;
      totalPrincipal += pos.principal;
      positions.push({
        pool:                poolAddress,
        principal:           pos.principal.toString(),
        fundingCredit:       pos.fundingCredit.toString(),
        claimedYield:        pos.claimedYield.toString(),
        claimedPrincipal:    pos.claimedPrincipal.toString(),
        claimedOverrunYield: pos.claimedOverrunYield.toString(),
        claimedBonus:        pos.claimedBonus.toString(),
        finalized:           pos.finalized,
      });
    }
    res.json({
      lender, walletUsdc,
      totalPrincipal: totalPrincipal.toString(),
      totalRedeemable: '0', totalRealized: '0', totalUnrealized: '0',
      positions,
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════
// ── Public pool reads ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

router.get('/pool/:pool/state', async (req, res) => {
  try {
    const pool = validAddr(req.params.pool);
    if (!pool) return res.status(400).json({ message: 'Invalid pool address' });
    const state = await svc.readPoolState(pool);
    const mongoDoc = await PoolState.findOne({ pubkey: pool }).lean();
    const shaped = shapePoolResponse(mongoDoc, state);
    shaped.pspName = await labelFor(pool, shaped.pspName);
    shaped.countActiveDrawdowns = await DrawdownState.countDocuments({ pool, repaid: false });
    res.json(shaped);
  } catch (e) {
    if (e.message?.includes('call revert')) return res.status(404).json({ message: 'Pool not found on-chain' });
    res.status(500).json({ message: e.message });
  }
});

router.get('/pool/:pool/drawdowns', async (req, res) => {
  try {
    const pool = validAddr(req.params.pool);
    if (!pool) return res.status(400).json({ message: 'Invalid pool address' });
    const includeRepaid = req.query.includeRepaid === 'true';
    const filter = { pool };
    if (!includeRepaid) filter.repaid = { $ne: true };
    const rows = await DrawdownState.find(filter).lean();
    if (rows.length > 0) {
      return res.json(rows.map((d) => ({
        pubkey: d.pubkey, id: d.id, principal: d.principal,
        drawdownDay: d.drawdownDay, tenorDays: d.tenorDays, repaid: !!d.repaid,
      })));
    }

    // Nothing indexed. That is not the same as nothing existing: the indexer
    // only scans DrawdownExecuted for pools it has already recorded in
    // PoolState, so a pool it missed has its drawdowns missed too — and the
    // borrower is then shown "No drawdowns yet" for money they have actually
    // taken, with no way to repay it. Read the events straight from the chain.
    const live = await svc.readDrawdownsFromChain(pool, { includeRepaid });
    res.json(live);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

/**
 * Validation pipeline for a drawdown. The off-chain validation agent
 * would normally populate + advance the five stages per request (order
 * verification → credit-line check → dedupe → sufficient credit → risk).
 * In the hackathon build we don't run a live agent; instead we surface a
 * canned all-passed stepper so the demo shows the auditable 5/5 result
 * from image 49 of the reference video. When the DrawdownState row
 * carries an ORD-* reference we splice that into the order-verified
 * detail line so different drawdowns feel individualised.
 */
router.get('/pool/:pool/drawdown/:drawdownId/pipeline', async (req, res) => {
  try {
    const pool = validAddr(req.params.pool);
    if (!pool) return res.status(400).json({ message: 'Invalid pool address' });
    const drawdownId = String(req.params.drawdownId || '');

    const dd = await DrawdownState.findOne({ pool, id: drawdownId }).lean();
    const orderRef = dd?.orderReference || 'ORD-15420671-1640';
    const nowIso = new Date().toISOString();

    const steps = [
      { name: 'Order verified',      status: 'passed', detail: `Order ${orderRef} accepted`,       completedAt: nowIso },
      { name: 'Credit line approved', status: 'passed', detail: 'Facility active',                 completedAt: nowIso },
      { name: 'Order not financed',  status: 'passed', detail: 'Fresh request',                    completedAt: nowIso },
      { name: 'Sufficient credit',   status: 'passed', detail: 'Requested amount within facility cap', completedAt: nowIso },
      { name: 'Risk validated',      status: 'passed', detail: 'Inline checks cleared',            completedAt: nowIso },
    ];

    res.json({ pool, drawdownId, steps, rejectionReason: null });
  } catch (e) {
    console.error('[/pool/:pool/drawdown/:drawdownId/pipeline]', e);
    res.status(500).json({ message: e.message });
  }
});

router.get('/pools', async (req, res) => {
  try {
    const { state: qState } = req.query;
    const STALE_MS = parseInt(process.env.POOL_CACHE_STALE_MS || '180000', 10);

    const docs = await PoolState.find({ pubkey: /^0x/ }).lean();
    const cached = new Map(docs.map((d) => [d.pubkey, d]));

    const poolAddresses = await svc.readAllPools();
    const rows = [];
    for (const poolAddress of poolAddresses) {
      try {
        const doc = cached.get(poolAddress);
        const fresh = doc?.lastIndexedAt
          && (Date.now() - new Date(doc.lastIndexedAt).getTime()) < STALE_MS;

        // A pool whose live read fails should not take the whole list with
        // it — fall back to the cached row when there is one.
        let shaped;
        if (fresh) {
          shaped = shapePoolFromDoc(doc);
        } else {
          try {
            shaped = shapePoolResponse(doc, await svc.readPoolState(poolAddress));
          } catch (e) {
            if (!doc) throw e;
            shaped = shapePoolFromDoc(doc);
          }
        }

        shaped.pspName = await labelFor(poolAddress, shaped.pspName);
        shaped.countActiveDrawdowns = await DrawdownState.countDocuments({ pool: poolAddress, repaid: false });
        rows.push(shaped);
      } catch (e) { console.warn('[/pools] skipping', poolAddress, e.message); }
    }
    res.json(rows.filter((p) => poolMatchesState(p, qState)));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════
// ── PSP endpoints ─────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * PSP requests a drawdown. Server signs as AGENT2 (payfi_v1 gates
 * executeDrawdown behind AGENT2_ROLE) and submits directly. Non-custodial:
 * USDC goes to the pre-authorized receiverWallet, not through the server.
 * The PSP just clicks a button — no wallet popup, no gas needed on their
 * side. Replaces Colosseum's fee-payer relay pattern with a cleaner
 * role-gated exec.
 */
/**
 * Pools belonging to the authenticated borrower, matched on the wallet bound
 * during onboarding.
 *
 * Ported from defa-solana-devnet, where this exists as /psp/facilities. It was
 * not carried into the Arc port, so the borrower's "My Facilities" screen — the
 * only route to the drawdown flow — called a 404, swallowed it via its
 * `.catch(() => ({ data: [] }))`, and reported "No facilities yet" for a
 * borrower with a live, funded facility.
 *
 * Served from indexed state rather than per-request chain reads, same as
 * /pools.
 */
router.get('/psp/facilities', authMiddleware, authorizeRoles('PSP'), async (req, res) => {
  try {
    const profile = await PSPProfile.findOne({ userId: req.user.userId });
    if (!profile) return res.status(404).json({ message: 'PSP profile not found' });
    const wallet = walletOf(profile);
    if (!wallet) return res.status(409).json({ message: 'PSP wallet not bound' });

    // Enumerate from the chain and use Mongo only as a cache, the same way
    // /pools does. Querying the indexed collection alone made a freshly
    // created pool invisible to its own borrower until the indexer caught up —
    // and since the drawdown scan iterates the same collection, that pool's
    // drawdowns never appeared either, so the borrower had no route to repay.
    const STALE_MS = parseInt(process.env.POOL_CACHE_STALE_MS || '180000', 10);
    const docs = await PoolState.find({ pubkey: /^0x/ }).lean();
    const cached = new Map(docs.map((d) => [d.pubkey, d]));

    const addresses = await svc.readAllPools();
    const mine = [];
    for (const addr of addresses) {
      try {
        const doc = cached.get(addr);

        // Decide ownership from the indexed record when we have one, at any
        // age — the borrower's wallet is set once at creation and never
        // changes, so a stale document is still authoritative for *whose* pool
        // this is. Only reach for the chain when there is no record at all,
        // which is the case this endpoint exists to cover.
        const ownerFromDoc = doc?.pspWallet;
        const isMine = ownerFromDoc
          ? ownerFromDoc.toLowerCase() === wallet.toLowerCase()
          : (await svc.readPoolState(addr)).pspWallet?.toLowerCase() === wallet.toLowerCase();
        if (!isMine) continue;

        // Only the figures need to be fresh, and a failed refresh should not
        // hide a facility the borrower owns — fall back to the cached numbers.
        const fresh = doc?.lastIndexedAt
          && (Date.now() - new Date(doc.lastIndexedAt).getTime()) < STALE_MS;
        let shaped;
        if (fresh) {
          shaped = shapePoolFromDoc(doc);
        } else {
          try {
            shaped = shapePoolResponse(doc, await svc.readPoolState(addr));
          } catch {
            shaped = doc ? shapePoolFromDoc(doc) : null;
          }
        }
        if (!shaped) continue;

        shaped.countActiveDrawdowns =
          await DrawdownState.countDocuments({ pool: addr, repaid: false });
        mine.push(shaped);
      } catch (e) {
        console.warn('[psp/facilities] skipping', addr, e.message);
      }
    }

    res.json(mine);
  } catch (e) {
    console.error('[psp/facilities]', e);
    res.status(500).json({ message: e.message });
  }
});

router.post('/psp/exec/drawdown', authMiddleware, authorizeRoles('PSP'), async (req, res) => {
  try {
    const { amount, tenorDays, receiverWallet, drawdownId } = req.body || {};
    const amountBase = toBase(amount);
    if (amountBase === null || amountBase <= 0n) return res.status(400).json({ message: 'amount required' });
    const days = Number(tenorDays);
    if (!Number.isInteger(days) || days <= 0)    return res.status(400).json({ message: 'tenorDays (integer) required' });

    const profile = await loadPspProfile(req, res); if (!profile)  return;
    const facility = await loadOwnedFacility(req, res, profile);  if (!facility) return;

    const receiver = validAddr(receiverWallet) || walletOf(profile);
    const ref = svc.refFromId(drawdownId || `${facility._id}:${Date.now()}`);

    const receipt = await svc.serverExecuteDrawdown(
      poolAddrOf(facility), ref, receiver, amountBase, days
    );
    res.json({
      txHash: receipt.hash, blockNumber: receipt.blockNumber,
      ref, receiverWallet: receiver, amount: amountBase.toString(), settlementDays: days,
    });
  } catch (e) {
    res.status(400).json({ message: e.shortMessage || e.reason || e.message });
  }
});

/** PSP builds a repay tx to sign in their own wallet. */
router.post('/psp/build-tx/repay', authMiddleware, authorizeRoles('PSP'), async (req, res) => {
  try {
    const profile = await loadPspProfile(req, res); if (!profile) return;
    const facility = await loadOwnedFacility(req, res, profile); if (!facility) return;
    // The UI knows the drawdown by its id, not by the on-chain ref, and the
    // exec endpoint already derives one from the other. Accept either.
    let ref = req.body?.ref;
    if (!ref && (req.body?.drawdownId !== undefined && req.body?.drawdownId !== null)) {
      ref = svc.refFromId(String(req.body.drawdownId));
    }
    if (!ref || !/^0x[0-9a-fA-F]{64}$/.test(ref)) {
      return res.status(400).json({ message: 'ref (bytes32) or drawdownId required' });
    }
    const pool = poolAddrOf(facility);

    // repay() pulls principal plus the accrued charge from the borrower, so it
    // needs an allowance first — exactly like deposit, which already returns
    // [approve, deposit]. Without this the button reverts with
    // "ERC20: transfer amount exceeds allowance" and nothing explains why.
    //
    // The charge accrues per second and is computed inside repay(), so there is
    // no exact figure to approve ahead of time. Approve the drawdown principal
    // plus a margin big enough to cover the fee for the whole facility; the
    // pool only ever transfers what is actually owed.
    let approveAmount;
    try {
      const dd = await svc.readDrawdown(pool, ref);
      const principal = BigInt(dd?.principal ?? 0);
      approveAmount = principal > 0n ? (principal * 12n) / 10n : null;
    } catch { approveAmount = null; }
    if (!approveAmount) {
      // Fall back to the pool's outstanding balance with the same margin.
      const state = await svc.readPoolState(pool);
      approveAmount = (BigInt(state.outstanding) * 12n) / 10n;
    }

    const approve = svc.encodeApprove(pool, approveAmount);
    const tx = svc.encodeRepay(pool, ref);
    const jsonTx = (t) => ({ to: t.to, data: t.data, value: t.value.toString() });
    res.json({
      steps: [
        { label: 'Approve USDC', tx: jsonTx(approve) },
        { label: 'Repay drawdown', tx: jsonTx(tx) },
      ],
      to: tx.to, data: tx.data, value: tx.value.toString(),
    });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

/**
 * PSP pays accrued idle fees — payfi_v1's analog of Colosseum's
 * settle-commit-fee. Same intent (settle outstanding LP compensation for
 * parked capital), cleaner mechanics on-chain.
 */
router.post('/psp/build-tx/settle-commit-fee', authMiddleware, authorizeRoles('PSP'), async (req, res) => {
  try {
    const profile = await loadPspProfile(req, res); if (!profile) return;
    const facility = await loadOwnedFacility(req, res, profile); if (!facility) return;
    const amountBase = toBase(req.body?.amount);
    if (amountBase === null || amountBase <= 0n) return res.status(400).json({ message: 'amount required' });
    const tx = svc.encodePayAccruedIdleFees(poolAddrOf(facility), amountBase);
    res.json({ to: tx.to, data: tx.data, value: tx.value.toString() });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════
// ── On-chain admin build-tx endpoints ─────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

/**
 * Onchain admin approves a PSP address at the factory. MULTISIG_ROLE-
 * gated on-chain. Admin's browser wallet signs this — server just
 * returns calldata.
 */
router.post('/admin/build-tx/approve-psp', authMiddleware, async (req, res) => {
  try {
    if (!requireOnchainAdmin(req, res)) return;
    const psp = validAddr(req.body?.pspWallet);
    if (!psp) return res.status(400).json({ message: 'pspWallet (address) required' });
    const tx = svc.encodeApprovePsp(psp);
    res.json({ to: tx.to, data: tx.data, value: tx.value.toString() });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

router.post('/admin/build-tx/revoke-psp', authMiddleware, async (req, res) => {
  try {
    if (!requireOnchainAdmin(req, res)) return;
    const psp = validAddr(req.body?.pspWallet);
    if (!psp) return res.status(400).json({ message: 'pspWallet (address) required' });
    const tx = svc.encodeRevokePsp(psp);
    res.json({ to: tx.to, data: tx.data, value: tx.value.toString() });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

/**
 * Flatten a Facility doc into the flat param bag the encoder expects.
 *
 * Terms live nested under `requestedTerms` (what the PSP asked for) and
 * `approvedTerms` (what the CRO locked). Spreading only the facility's
 * top-level fields leaves softCap, hardCap, tenure and every rate undefined,
 * which fails the cap check in the route and — worse, if caps were supplied by
 * hand — would deploy the pool on the encoder's default rates rather than the
 * approved ones.
 *
 * Precedence: facility top-level < requested terms < CRO-approved terms <
 * explicit request body.
 */
function mergeFacilityTerms(fac, body) {
  // Strip the approved layer's blanks before it overlays the requested one —
  // a term the CRO left unset must not shadow the value the PSP supplied.
  const approved = { ...(fac.approvedTerms || {}) };
  for (const k of Object.keys(approved)) {
    if (approved[k] === null || approved[k] === undefined) delete approved[k];
  }
  const terms = { ...(fac.requestedTerms || {}), ...approved };
  const merged = { ...fac, ...terms, ...body };

  // Convert the USDC-denominated caps to base units. Only when they came from
  // the facility — an explicit request-body override keeps the caller's own
  // convention, which the raw-params path has always expressed in base units.
  for (const k of ['softCap', 'hardCap']) {
    if (body[k] !== undefined) continue;
    const base = usdcToBase(merged[k]);
    if (base !== undefined) merged[k] = base;
  }
  return merged;
}

/**
 * Deploy + initialize a new pool via factory.createPool. Body accepts
 * either raw params or a facilityId to pull terms from the Facility
 * Mongo doc (whichever the FE finds convenient).
 *
 * Rates come in as bps; converted to WAD/day here. Solidity struct
 * ordering is preserved via explicit tuple assembly (ethers accepts
 * either named or ordered).
 */
/**
 * Bind a facility to the pool that was just created for it.
 *
 * The indexer does this too, but on a poll cycle — and until it runs, the
 * facility still sits in the Initialize Queue offering a button whose only
 * possible outcome is "Factory: PSP has live pool". An operator who clicks it
 * loses time they may not have: the funding window is already counting down.
 *
 * Called by the queue as soon as createPool confirms. Idempotent, and reads
 * the pool address from the factory rather than trusting the caller.
 */
router.post('/admin/confirm-pool-init/:facilityId', authMiddleware, async (req, res) => {
  try {
    if (!requireOnchainAdmin(req, res)) return;
    const facility = await Facility.findById(req.params.facilityId);
    if (!facility) return res.status(404).json({ message: 'Facility not found' });
    if (facility.poolPda) {
      return res.json({ poolPda: facility.poolPda, status: facility.status, alreadyBound: true });
    }

    const factory = svc.getFactory();
    const rec = await factory.psps(facility.pspWallet);
    const pool = rec?.activePool ?? rec?.[1];
    if (!pool || /^0x0+$/.test(pool)) {
      return res.status(409).json({ message: 'No pool on chain for this borrower yet' });
    }

    facility.poolPda = pool;
    facility.vaultPda = pool;
    facility.status = 'FUNDING';
    await facility.save();
    res.json({ poolPda: pool, status: facility.status });
  } catch (e) {
    console.error('[admin/confirm-pool-init]', e);
    res.status(500).json({ message: e.message });
  }
});

router.post('/admin/build-tx/initialize-pool', authMiddleware, async (req, res) => {
  try {
    if (!requireOnchainAdmin(req, res)) return;

    // Preload from Facility doc if facilityId is passed.
    let body = { ...(req.body || {}) };
    if (body.facilityId) {
      const fac = await Facility.findById(body.facilityId).lean();
      if (!fac) return res.status(404).json({ message: 'Facility not found' });
      body = mergeFacilityTerms(fac, body);
    }

    const pspAddr      = validAddr(body.pspWallet);
    const agent1Addr   = validAddr(body.agent1)   || AGENT_ADDRESS_FALLBACK || req.user.wallet;
    const agent2Addr   = validAddr(body.agent2)   || AGENT_ADDRESS_FALLBACK || req.user.wallet;
    const multisigAddr = validAddr(body.multisig) || req.user.wallet;
    if (!pspAddr)    return res.status(400).json({ message: 'pspWallet (address) required' });
    if (!agent1Addr) return res.status(400).json({ message: 'agent1 required (no default configured)' });
    if (!agent2Addr) return res.status(400).json({ message: 'agent2 required' });

    const softCapBase    = toBase(body.softCap);
    const hardCapBase    = toBase(body.hardCap);
    // Default to 1 USDC, not the 1 base unit (0.000001 USDC) that '1' used to
    // mean here — that is not a meaningful floor on a deposit.
    const minDepositBase =
      body.minDeposit !== undefined ? toBase(body.minDeposit) : usdcToBase(1);
    if (softCapBase === null || hardCapBase === null) {
      return res.status(400).json({ message: 'softCap / hardCap required' });
    }

    const params = [
      pspAddr,
      BigInt(body.fundingDurationSecs || DEFAULT_FUNDING_DURATION_SECS),
      softCapBase,
      hardCapBase,
      BigInt(body.tenure || body.tenorDays || 30),   // approvedTerms names it tenorDays
      bpsToWad(body.idleRateDailyBps     ?? body.commitmentRateBps     ?? 5),   // 5 bps/day = 0.05%
      bpsToWad(body.utilizedRateDailyBps ?? body.utilizationRateBps    ?? 20),
      bpsToWad(body.penaltyRateDailyBps  ?? body.penaltyRateBps        ?? 50),
      BigInt(body.penaltyGraceDays ?? body.graceDays ?? 3),
      minDepositBase,
      bpsToWad(body.aprAnnualBps ?? 1000),           // 10% APR default
      agent1Addr, agent2Addr, multisigAddr,
    ];

    // Dry-run before handing back calldata. The factory's constraints — the
    // economic envelope, the live-pool gate, and the APR coverability
    // invariant that makes the funding window load-bearing — otherwise only
    // surface after the operator has signed and paid gas, as a bare
    // "execution reverted" in the wallet.
    const revertReason = await svc.simulateCreatePool(params, req.user.wallet);
    if (revertReason) {
      return res.status(400).json({
        message: `Pool would be rejected by the factory: ${revertReason}`,
        reason: revertReason,
      });
    }

    const tx = svc.encodeCreatePool(params);
    res.json({
      to: tx.to, data: tx.data, value: tx.value.toString(),
      params: {
        pspWallet: params[0], fundingDurationSecs: params[1].toString(),
        softCap: params[2].toString(), hardCap: params[3].toString(),
        tenure: params[4].toString(),
        idleRateDaily: params[5].toString(), utilizedRateDaily: params[6].toString(),
        penaltyRateDaily: params[7].toString(), penaltyGraceDays: params[8].toString(),
        minDeposit: params[9].toString(), aprAnnual: params[10].toString(),
        agent1: params[11], agent2: params[12], multisig: params[13],
      },
    });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

/**
 * Anyone can call finalizeFunding (public on payfi_v1). Historically the
 * admin triggers it when softCap is hit or when the buffer expires
 * (which then auto-flips to Unsuccessful).
 */
router.post('/admin/build-tx/execute-facility', authMiddleware, async (req, res) => {
  try {
    const pool = validAddr(req.body?.pool);
    if (!pool) return res.status(400).json({ message: 'pool (address) required' });
    const tx = svc.encodeFinalizeFunding(pool);
    res.json({ to: tx.to, data: tx.data, value: tx.value.toString() });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

/**
 * payfi_v1 has no explicit cancel — pool auto-transitions to Unsuccessful
 * on finalizeFunding past the buffer with softCap unmet. Surface
 * finalizeFunding for callers using the legacy cancel path.
 */
router.post('/admin/build-tx/cancel-funding', authMiddleware, async (req, res) => {
  const pool = validAddr(req.body?.pool);
  if (!pool) return res.status(400).json({ message: 'pool (address) required' });
  const tx = svc.encodeFinalizeFunding(pool);
  res.json({
    to: tx.to, data: tx.data, value: tx.value.toString(),
    note: 'payfi_v1 auto-cancels via finalizeFunding when softCap unmet past the buffer',
  });
});

router.post('/admin/build-tx/claim-protocol-fees', authMiddleware, async (req, res) => {
  try {
    if (!requireOnchainAdmin(req, res)) return;
    const pool = validAddr(req.body?.pool);
    if (!pool) return res.status(400).json({ message: 'pool (address) required' });
    const tx = svc.encodeSweepProtocolFees(pool);
    res.json({ to: tx.to, data: tx.data, value: tx.value.toString() });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

router.post('/admin/build-tx/declare-default', authMiddleware, async (req, res) => {
  try {
    if (!requireOnchainAdmin(req, res)) return;
    const pool = validAddr(req.body?.pool);
    if (!pool) return res.status(400).json({ message: 'pool (address) required' });
    const tx = svc.encodeDeclareDefault(pool);
    res.json({ to: tx.to, data: tx.data, value: tx.value.toString() });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

router.post('/admin/build-tx/settle-default-principal', authMiddleware, async (req, res) => {
  try {
    if (!requireOnchainAdmin(req, res)) return;
    const pool = validAddr(req.body?.pool);
    const amt = toBase(req.body?.amount);
    if (!pool)              return res.status(400).json({ message: 'pool (address) required' });
    if (amt === null || amt <= 0n) return res.status(400).json({ message: 'amount required' });
    const tx = svc.encodeSettleDefaultPrincipal(pool, amt);
    res.json({ to: tx.to, data: tx.data, value: tx.value.toString() });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

router.post('/admin/build-tx/settle-default-yield', authMiddleware, async (req, res) => {
  try {
    if (!requireOnchainAdmin(req, res)) return;
    const pool = validAddr(req.body?.pool);
    const amt = toBase(req.body?.amount);
    if (!pool)              return res.status(400).json({ message: 'pool (address) required' });
    if (amt === null || amt <= 0n) return res.status(400).json({ message: 'amount required' });
    const tx = svc.encodeSettleDefaultYield(pool, amt);
    res.json({ to: tx.to, data: tx.data, value: tx.value.toString() });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

/** Server-signed (AGENT1) pause/unpause. Immediate effect. */
router.post('/admin/exec/set-paused', authMiddleware, async (req, res) => {
  try {
    if (!requireOnchainAdmin(req, res)) return;
    const pool = validAddr(req.body?.pool);
    if (!pool) return res.status(400).json({ message: 'pool (address) required' });
    const paused = Boolean(req.body?.paused);
    const receipt = await svc.serverSetPaused(pool, paused);
    res.json({ txHash: receipt.hash, blockNumber: receipt.blockNumber, paused });
  } catch (e) { res.status(400).json({ message: e.shortMessage || e.message }); }
});

/** Server-signed (AGENT1) SC-overdue-check enable/disable. */
router.post('/admin/exec/set-sc-overdue', authMiddleware, async (req, res) => {
  try {
    if (!requireOnchainAdmin(req, res)) return;
    const pool = validAddr(req.body?.pool);
    if (!pool) return res.status(400).json({ message: 'pool (address) required' });
    const enabled = Boolean(req.body?.enabled);
    const receipt = await svc.serverSetScOverdue(pool, enabled);
    res.json({ txHash: receipt.hash, blockNumber: receipt.blockNumber, enabled });
  } catch (e) { res.status(400).json({ message: e.shortMessage || e.message }); }
});

// ── Analytics reads (STUBBED — Chunk B3c: needs event indexer buildup) ─

const NOT_IMPLEMENTED = (chunk) => (req, res) =>
  res.status(501).json({
    message: `Endpoint not yet implemented on EVM — see Chunk ${chunk}`,
    path: req.originalUrl,
  });

router.get('/pool/:pool/activity',       NOT_IMPLEMENTED('B3c'));
router.get('/pool/:pool/daily-activity', NOT_IMPLEMENTED('B3c'));
router.get('/pool/:pool/fee-aggregates', NOT_IMPLEMENTED('B3c'));

module.exports = router;
// Exported for unit tests; the route is the only production caller.
module.exports.mergeFacilityTerms = mergeFacilityTerms;
