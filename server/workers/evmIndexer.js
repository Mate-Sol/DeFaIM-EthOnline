/**
 * EVM indexer — polls the payfi_v1 factory + every deployed pool for
 * lifecycle events and view-getter state, mirrors into Mongo (PoolState /
 * DrawdownState collections).
 *
 * Analog of the old solanaIndexer.js, retargeted for EVM. Same output
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
  getFactory,
  getPool,
} = require('../services/poolServiceEvm');

const { PoolState, DrawdownState } = require('../models/PoolState');

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
// The PoolState / DrawdownState schemas were designed for Solana; we map
// EVM state into semantically-equivalent fields where possible and leave
// Solana-only fields unset. See docs/EVM_SCHEMA_MAP.md (todo) for the
// full mapping.

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

    // Lifecycle bits mapped to bool flags for the old schema.
    // payfi_v1 Status enum: 0=Funding,1=Active,2=Unsuccessful,3=Closed,4=Default
    isActive:    state.status === 1,
    isCancelled: state.status === 2,
    isDefaulted: state.status === 4,

    // Economics
    totalCapital:         state.principal.toString(),
    outstandingPrincipal: state.outstanding.toString(),
    todayDay:             Number(state.currentDay),

    // Timestamps: fold Solana `activatedDay` into JS Number of the pool
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
    }

    // 2. Snapshot state for every known pool
    const knownPools = await PoolState.find({}).select('pubkey').lean();
    for (const { pubkey } of knownPools) {
      if (!pubkey || !pubkey.startsWith('0x')) continue; // skip old Solana rows
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

module.exports = {
  start,
  stop,
  tick,           // exported for tests / manual runs
  poolStateToDoc, // exported for tests
};
