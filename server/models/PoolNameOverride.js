const mongoose = require('mongoose');

/**
 * Display-name override per pool. The on-chain `Pool.psp_name` field is
 * immutable (no update instruction), so to relabel a pool for demo /
 * branding purposes we store a Mongo override and substitute it in the
 * server's serializers before responding. Lookup is keyed by the pool's
 * PDA pubkey (base58).
 */
const PoolNameOverrideSchema = new mongoose.Schema(
  {
    poolPda:     { type: String, required: true, unique: true, index: true },
    displayName: { type: String, required: true, trim: true },
    setBy:       { type: String, default: '' }, // admin email/wallet for audit
  },
  { timestamps: true }
);

module.exports = mongoose.model('PoolNameOverride', PoolNameOverrideSchema);
