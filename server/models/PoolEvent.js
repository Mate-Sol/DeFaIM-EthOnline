const mongoose = require('mongoose');

/**
 * Decoded on-chain event log, persisted by the pool aggregates indexer
 * during its signature scan. Replaces the per-request
 * getSignaturesForAddress + getTransaction loop that was previously
 * driving /activity, /daily-activity, and the per-lender pool history
 * scan inside /lender/portfolio.
 *
 * Storage strategy:
 *   - One doc per decoded program-data event.
 *   - `data` mirrors the anchor event payload, with PublicKeys stringified
 *     and BN/BigInt → decimal string so it round-trips through Mongo
 *     and JSON.
 *   - Hot lookup fields (`lender`, `drawdownPda`) denormalized to top-
 *     level so we can index them — the original `data.lender` style
 *     path indexes are clunky and fragile.
 *   - `(signature, eventIndex)` is unique so re-running the indexer is
 *     idempotent (a tx may emit multiple events; eventIndex disambiguates).
 */
const PoolEventSchema = new mongoose.Schema(
  {
    pool:       { type: String, required: true },
    signature:  { type: String, required: true },
    eventIndex: { type: Number, required: true, default: 0 },
    name:       { type: String, required: true },
    blockTime:  { type: Number, default: null },
    slot:       { type: Number, default: 0 },
    data:       { type: mongoose.Schema.Types.Mixed, default: {} },
    // Denormalized for filter speed.
    lender:      { type: String, default: null },
    drawdownPda: { type: String, default: null },
  },
  { timestamps: true }
);

// Idempotency: re-ingesting the same (signature, eventIndex) is a no-op.
PoolEventSchema.index({ signature: 1, eventIndex: 1 }, { unique: true });
// /activity: latest events per pool in time order.
PoolEventSchema.index({ pool: 1, blockTime: -1 });
// /lender/portfolio per-pool history: filter by lender + name.
PoolEventSchema.index({ pool: 1, lender: 1, name: 1 });
// Daily-activity replay: oldest-first per pool.
PoolEventSchema.index({ pool: 1, slot: 1 });

module.exports = mongoose.model('PoolEvent', PoolEventSchema);
