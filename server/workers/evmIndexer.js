/**
 * EVM indexer — polls the payfi_v1 factory + every deployed pool for
 * lifecycle events and view-getter state, mirrors into Mongo (PoolState /
 * DrawdownState collections).
 *
 * Indexes Arc pool events and view state into Mongo. Same output
 * schemas so existing /pool/* read endpoints keep working without change;
 * the payloads just source from ethers instead of Anchor now.
 *
 * Strategy — combined event log + view snapshot:
 *   1. Every tick, query the last WINDOW_BLOCKS blocks for PoolCreated
 *      events on the factory. Upsert new pools we haven't seen.
 *   2. For every known pool, batch-read all view getters (readPoolState)
 *      and upsert into PoolState. Cheap enough at hackathon scale (few
 *      pools × ~25 view calls × 1 RPC call each).
 *   3. For every known pool, query DrawdownExecuted + Repaid events in
 *      the same block window; upsert DrawdownState rows.
 *
 * Idempotency: every write is findOneAndUpdate({...}, ..., {upsert:true}).
 * Re-processing the same event window is safe — no dup rows, no cursor
 * bookkeeping. Cursor-less design trades a little RPC overhead for zero
 * state-management bugs — matches the demo scale we care about.
 *
 * The indexer is NOT wired into index.js startup by default. Enable via
 *   const { start } = require('./workers/evmIndexer');
 *   start();
 * once the factory + pool addresses are set in .env (otherwise every
 * tick throws PAYFI_FACTORY_ADDRESS not set).
 */

const { ethers } = require('ethers');
const { getProvider, getFactoryAddress } = require('../config/chain');
const {
  readPoolState,
  readAllPools,
  getFactory,
  getPool,
} = require('../services/poolServiceEvm');

const { PoolState, DrawdownState } = require('../models/PoolState');
const Facility = require('../models/Facility');

const INTERVAL_MS   = parseInt(process.env.EVM_INDEXER_INTERVAL_MS  || '30000', 10);
const WINDOW_BLOCKS = parseInt(process.env.EVM_INDEXER_WINDOW_BLOCKS || '5000',  10);
const RATE_LIMIT_BACKOFF_MS = parseInt(process.env.EVM_INDEXER_429_BACKOFF_MS || '15000', 10);

let inFlight = false;
let cooldownUntil = 0;
let intervalHandle = null;

// Detect provider rate-limit or transient errors. Anything vaguely
// "too many requests" flavoured pushes the next tick out by
// RATE_LIMIT_BACKOFF_MS.
const isRateLimited = (e) =>
  /429|too many requests|rate limit|timeout|econnreset/i.test(e?.message || '');

// ── Field mapping helpers ──────────────────────────────────────────────
// The PoolState / DrawdownState schemas predate Arc; we map
// EVM state into semantically-equivalent fields where possible and leave
// legacy fields unset. See docs/EVM_SCHEMA_MAP.md (todo) for the
// full mapping.

// WAD (1e18) fixed-point rate -> basis points.
function _wadToBps(wad) {
  return Number((BigInt(wad) * 10000n) / 1000000000000000000n);
}

function poolStateToDoc(state, extras = {}) {
  return {
    // Identity
    pubkey: state.poolAddress,        // 0x… EVM pool contract address
    pspWallet: state.pspWallet,
    usdcMint: state.stablecoin,       // ERC20 stablecoin address
    vault: state.poolAddress,         // payfi_v1: pool == vault (holds USDC)
    lpMint: state.poolAddress,        // LP shares are internal storage; use pool addr as proxy

    // Config
    softCap: state.softCap.toString(),
    hardCap: state.hardCap.toString(),
    facilityTenorDays: Number(state.tenure),
    graceDays: Number(state.penaltyGraceDays),
    penaltyDays: Number(state.penaltyGraceDays),

    // Terms, as basis points. Cached so /pools can answer from Mongo
    // instead of reading every pool's getters on each request.
    aprAnnualBps:       _wadToBps(state.aprAnnual),
    utilizationRateBps: _wadToBps(state.utilizedRateDaily),
    commitmentRateBps:  _wadToBps(state.idleRateDaily),
    penaltyRateBps:     _wadToBps(state.penaltyRateDaily),

    // Live economics
    availableToDd:  state.availableToDd.toString(),
    yieldOwed:      state.yieldOwed.toString(),
    fundingCredit:  state.fundingCredit.toString(),
    fundingStartTs: state.fundingStartTs.toString(),
    fMaturityTs:    state.fMaturityTs.toString(),
    poolStartTs:    state.poolStartTs.toString(),
    poolFinalityTs: state.poolFinalityTs.toString(),
    isDrawdownAllowed: Boolean(state.isDrawdownAllowed),
    status: state.status,

    // Lifecycle bits mapped to bool flags for the old schema.
    // payfi_v1 Status enum: 0=Funding,1=Active,2=Unsuccessful,3=Closed,4=Default
    isActive:    state.status === 1,
    isCancelled: state.status === 2,
    isDefaulted: state.status === 4,

    // Economics
    totalCapital:         state.principal.toString(),
    outstandingPrincipal: state.outstanding.toString(),
    todayDay:             Number(state.currentDay),

    // Timestamps: fold `activatedDay` into JS Number of the pool
    // start ts / 86400 so downstream day-index math stays comparable.
    activatedDay: state.poolStartTs > 0n ? Number(state.poolStartTs / 86400n) : 0,
    createdDay:   state.fundingStartTs > 0n ? Number(state.fundingStartTs / 86400n) : 0,

    // Metadata
    lastIndexedAt: new Date(),
    ...extras,
  };
}

function drawdownEventToDoc(poolAddress, evt) {
  const { ref, receiverWallet, principal, expiryTs } = evt.args;
  return {
    // Composite key so multiple pools' drawdowns coexist. bytes32 refs are
    // globally unique per pool but not across pools — prefix with pool addr.
    pubkey: `${poolAddress}:${ref}`,
    pool: poolAddress,
    id: ref,
    principal: principal.toString(),
    drawdownDay: Math.floor(Date.now() / 86_400_000),   // approx — updated on next state sync
    tenorDays: Number((expiryTs - BigInt(Math.floor(Date.now() / 1000))) / 86400n),
    repaid: false,
    lastIndexedAt: new Date(),
  };
}

// ── Tick ────────────────────────────────────────────────────────────────

async function tick() {
  if (inFlight) return;
  if (Date.now() < cooldownUntil) return;
  inFlight = true;
  try {
    const provider = getProvider();
    const factory = getFactory();
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - WINDOW_BLOCKS);

    // 1. Discover new pools from PoolCreated events
    const poolCreatedEvents = await factory.queryFilter(
      factory.filters.PoolCreated(),
      fromBlock,
      latest
    );
    for (const evt of poolCreatedEvents) {
      const { pool: poolAddr, pspWallet } = evt.args;
      // Idempotent — sets pubkey + pspWallet at minimum. Full state
      // sync below overwrites with fuller data.
      await PoolState.findOneAndUpdate(
        { pubkey: poolAddr },
        {
          $set: {
            pubkey: poolAddr,
            pspWallet,
            usdcMint: '', // filled by state sync
            lastIndexedAt: new Date(),
          },
        },
        { upsert: true }
      );

      // Mirror the new pool onto the Facility that asked for it.
      //
      // Nothing else does this. The CRO step blanks poolPda and no later write
      // ever fills it, which breaks two things: the facility never leaves the
      // on-chain admin's Initialize Queue, so a deployed facility keeps
      // inviting a second createPool that can only fail with "PSP has live
      // pool"; and /psp/exec/drawdown resolves the pool address off this
      // field, so drawdowns against a freshly created pool have nowhere to go.
      //
      // Matched on the borrower's wallet, narrowed to a facility still waiting
      // for its pool, so re-indexing an old event cannot rebind a facility
      // that already has one.
      // One pool belongs to exactly one facility. Without this check a PSP
      // with two facilities awaiting init gets both bound to the same pool:
      // the second silently leaves the Initialize Queue, shows someone else's
      // funding progress, and can never be deployed.
      const claimant = await Facility.findOne({ poolPda: poolAddr }).select('_id').lean();
      if (canClaimPool({ poolAddr, claimedByFacilityId: claimant?._id })) {
        await Facility.findOneAndUpdate(
          { pspWallet, poolPda: '', status: 'AWAITING_POOL_INIT' },
          { $set: { poolPda: poolAddr, vaultPda: poolAddr, status: 'FUNDING' } }
        );
      }
    }

    // 1b. Reconcile facilities whose pool was created outside the event window.
    //
    // Step 1 only sees PoolCreated inside the last WINDOW_BLOCKS. That is a
    // rolling ~45 minutes, so a pool created while the indexer was down, or
    // before this binding existed, is never bound — and because
    // /psp/exec/drawdown resolves the pool from Facility.poolPda, that
    // borrower can never draw down, with nothing to indicate why.
    //
    // The factory's psps() mapping is authoritative and has no such window, so
    // ask it directly for anything still unbound.
    const unbound = await Facility.find({
      status: 'AWAITING_POOL_INIT',
      poolPda: '',
      pspWallet: { $nin: [null, ''] },
    }).select('_id pspWallet').lean();

    for (const fac of unbound) {
      try {
        const rec = await factory.psps(fac.pspWallet);
        const activePool = rec?.activePool ?? rec?.[1];
        if (!activePool || activePool === ethers.ZeroAddress) continue;
        // psps() returns the PSP's one live pool, so every unbound facility of
        // theirs matches it. Claim it only if no facility holds it already —
        // otherwise a second facility is hijacked onto the first one's pool.
        const holder = await Facility.findOne({ poolPda: activePool }).select('_id').lean();
        if (!canClaimPool({ poolAddr: activePool, claimedByFacilityId: holder?._id, facilityId: fac._id })) continue;
        await Facility.updateOne(
          { _id: fac._id, poolPda: '' },
          { $set: { poolPda: activePool, vaultPda: activePool, status: 'FUNDING' } }
        );
        console.log(`[evmIndexer] bound facility ${fac._id} -> pool ${activePool}`);
      } catch (e) {
        console.warn(`[evmIndexer] reconcile failed for ${fac._id}: ${e.message}`);
      }
    }

    // 2. Snapshot state for every known pool
    // Snapshot every pool the factory has ever created, not only the ones a
    // PoolCreated event happened to land in the rolling window. A pool the
    // indexer never recorded has no cached row, and /pool/pools then has
    // nothing to serve for it — which is what left the lender marketplace
    // reading seventeen pools live and spinning for two minutes.
    try {
      const all = await readAllPools();
      const seen = new Set(
        (await PoolState.find({}).select('pubkey').lean()).map((d) => d.pubkey),
      );
      for (const addr of all) {
        if (seen.has(addr)) continue;
        await PoolState.updateOne({ pubkey: addr }, { $setOnInsert: { pubkey: addr } }, { upsert: true });
        console.log(`[evmIndexer] discovered unindexed pool ${addr}`);
      }
    } catch (e) {
      console.warn('[evmIndexer] pool discovery failed:', e.message);
    }

    const knownPools = await PoolState.find({}).select('pubkey').lean();
    for (const { pubkey } of knownPools) {
      if (!pubkey || !pubkey.startsWith('0x')) continue; // skip non-EVM rows
      let state;
      try {
        state = await readPoolState(pubkey);
      } catch (e) {
        // Skip pools the RPC can't read (bad address, network flap, etc.)
        // and continue with the rest. Log for observability.
        console.warn(`[evmIndexer] readPoolState(${pubkey}) failed:`, e.message);
        continue;
      }
      await PoolState.findOneAndUpdate(
        { pubkey },
        { $set: poolStateToDoc(state) },
        { upsert: true }
      );

      // 3. Ingest drawdown events for this pool
      const pool = getPool(pubkey);
      const drawdownEvents = await pool.queryFilter(
        pool.filters.DrawdownExecuted(),
        fromBlock,
        latest
      );
      for (const evt of drawdownEvents) {
        const doc = drawdownEventToDoc(pubkey, evt);
        await DrawdownState.findOneAndUpdate(
          { pubkey: doc.pubkey },
          { $set: doc },
          { upsert: true }
        );
      }
      // Flip repaid=true for any Repaid events in the window
      const repaidEvents = await pool.queryFilter(pool.filters.Repaid(), fromBlock, latest);
      for (const evt of repaidEvents) {
        await DrawdownState.findOneAndUpdate(
          { pubkey: `${pubkey}:${evt.args.ref}` },
          { $set: { repaid: true, lastIndexedAt: new Date() } }
        );
      }
    }
  } catch (e) {
    if (isRateLimited(e)) {
      cooldownUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      console.warn('[evmIndexer] rate-limited; cooling down', RATE_LIMIT_BACKOFF_MS, 'ms');
    } else {
      console.error('[evmIndexer] tick failed:', e.message);
    }
  } finally {
    inFlight = false;
  }
}

function start() {
  if (intervalHandle) return; // idempotent
  // Guard: refuse to start until factory addr is set — avoids a noisy
  // stream of PAYFI_FACTORY_ADDRESS-not-set throws every 30s in dev.
  try {
    getFactoryAddress();
  } catch (e) {
    console.warn('[evmIndexer] not starting:', e.message);
    return;
  }
  console.log(`[evmIndexer] starting; interval=${INTERVAL_MS}ms window=${WINDOW_BLOCKS} blocks`);
  intervalHandle = setInterval(tick, INTERVAL_MS);
  // Kick off an immediate tick so we don't wait a full interval on boot.
  setImmediate(tick);
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/**
 * May this facility claim this pool?
 *
 * A pool belongs to exactly one facility. The factory's psps() mapping returns
 * the PSP's single live pool, so *every* unbound facility of theirs matches it
 * — bind without checking and a PSP's second facility is hijacked onto the
 * first one's pool. It then vanishes from the Initialize Queue, displays the
 * other facility's funding progress, and can never be deployed, with nothing
 * on screen to explain why.
 */
function canClaimPool({ poolAddr, claimedByFacilityId, facilityId }) {
  if (!poolAddr || /^0x0+$/i.test(poolAddr)) return false;
  if (!claimedByFacilityId) return true;
  return String(claimedByFacilityId) === String(facilityId);
}

module.exports = {
  canClaimPool,
  start,
  stop,
  tick,           // exported for tests / manual runs
  poolStateToDoc, // exported for tests
};
