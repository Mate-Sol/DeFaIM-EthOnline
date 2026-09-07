const mongoose = require('mongoose');

const UsedTokenSchema = new mongoose.Schema({
  jti: {
    type: String,
    required: true,
    unique: true
  },
  expiresAt: {
    type: Date,
    required: true
  }
}, { 
  timestamps: true,
  collection: 'used_tokens'
});

// TTL Index to automatically delete documents after they expire
// This ensures the DB doesn't grow infinitely with old tokens
UsedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('UsedToken', UsedTokenSchema);
