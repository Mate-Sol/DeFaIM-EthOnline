const mongoose = require('mongoose');

/**
 * On-chain Pool snapshot, mirrored by `solanaIndexer` worker.
 *
 * This collection is the local cache of authoritative on-chain state. It
 * lets API endpoints respond fast without hitting RPC, and the
 * reconciliation worker compares this against `FinancingRequest` /
 * `PSPProfile` to flag drift.
 *
 * Numeric fields that exceed JS-safe integer range (u64 lamports/USDC
 * base units) are stored as strings; the frontend parses them as BigInt.
 */
const PoolStateSchema = new mongoose.Schema(
  {
    pubkey: { type: String, required: true, unique: true, index: true },
    admin: String,
    pspWallet: { type: String, index: true },
    pspName: String,
    facilityId: String,
    usdcMint: String,
    vault: String,
    lpMint: String,

    softCap: String,
    hardCap: String,
    maxDrawdownAmount: String,
    facilityTenorDays: Number,
    utilizationRateBps: Number,
    commitmentRateBps: Number,
    penaltyRateBps: Number,
    graceDays: Number,
    penaltyDays: Number,
    protocolFeeShareBps: Number,

    isActive: Boolean,
    isCancelled: Boolean,
    isDefaulted: Boolean,
    createdDay: Number,
    activatedDay: Number,

    totalCapital: String,
    outstandingPrincipal: String,
    todayDay: Number,
    todayPeakOutstanding: String,

    accruedCommitFee: String,
    accruedUtilFee: String,
    accruedPenaltyFee: String,
    protocolFeesOwed: String,

    nextDrawdownId: String,
    countActiveDrawdowns: Number,

    lastIndexedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

const DrawdownStateSchema = new mongoose.Schema(
  {
    pubkey: { type: String, required: true, unique: true, index: true },
    pool: { type: String, required: true, index: true },
    id: String,
    principal: String,
    drawdownDay: Number,
    tenorDays: Number,
    repaid: { type: Boolean, index: true },
    lastIndexedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = {
  PoolState: mongoose.model('PoolState', PoolStateSchema),
  DrawdownState: mongoose.model('DrawdownState', DrawdownStateSchema),
};
