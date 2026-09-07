const mongoose = require('mongoose');

// One-time access codes minted by on-chain admins for prospective lenders.
// Once redeemed, the code is permanently consumed (usedAt is set) and
// bound to the Lender record that redeemed it. The lender then signs in
// via wallet on subsequent visits — no code needed again.
const AccessCodeSchema = new mongoose.Schema(
  {
    code:        { type: String, required: true, unique: true, uppercase: true, index: true },
    label:       { type: String, default: '' },        // optional admin-side note ("for Alice")
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByEmail: { type: String, default: '' },     // denormalized for the admin UI
    expiresAt:   { type: Date, default: null },        // null = never expires

    // Redemption side — populated on first use, never overwritten.
    usedAt:           { type: Date, default: null, index: true },
    usedByLenderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Lender', default: null },
    usedByWallet:     { type: String, default: '' },
    usedByName:       { type: String, default: '' },
    usedByEmail:      { type: String, default: '' },
  },
  { timestamps: true }
);

AccessCodeSchema.index({ usedAt: 1, createdAt: -1 });

module.exports = mongoose.model('AccessCode', AccessCodeSchema);
