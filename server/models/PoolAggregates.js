const mongoose = require('mongoose');

/**
 * Lifetime event-derived aggregates per pool. Maintained incrementally
 * by `workers/poolAggregatesIndexer.js`, which scans new signatures and
 * applies deltas. Endpoints read from here instead of paginating
 * thousands of getTransaction calls per request.
 *
 * BigInt fields are stored as decimal strings so they round-trip
 * losslessly through Mongo and JSON.
 *
 * The cursor (`lastSyncedSignature`) is the newest signature already
 * processed. The next tick fetches signatures with `until` set to this
 * value to get only the newer ones. If the cursor is purged from the
 * RPC's history, the worker falls back to a full rebuild.
 */
const PoolAggregatesSchema = new mongoose.Schema(
  {
    pubkey: { type: String, required: true, unique: true, index: true },

    // Lifetime sums of event amounts.
    settledCommitLifetime:        { type: String, default: '0' },  // Σ CommitFeeSettled.amount
    protocolClaimedLifetime:      { type: String, default: '0' },  // Σ ProtocolFeesClaimed.amount
    lenderRedeemedYieldLifetime:  { type: String, default: '0' },  // Σ max(0, LpRedeemed.usdcPaid - lpBurned)

    // Cursor for incremental sync.
    lastSyncedSignature: { type: String, default: null },
    lastSyncedSlot:      { type: Number, default: 0 },
    lastSyncedAt:        { type: Date,   default: null },

    // True once we've completed at least one full historical pass.
    // Endpoints can fall back to inline scan when this is false.
    bootstrapped:        { type: Boolean, default: false },

    // Diagnostic counters.
    totalSigsSeen:       { type: Number, default: 0 },
    eventsByName:        { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PoolAggregates', PoolAggregatesSchema);
