const mongoose = require('mongoose');

const segmentSchema = new mongoose.Schema({
    key: { type: String, unique: true }, // e.g. "CORPORATE", "SME"
    name: String,

    onboardingEnabled: { type: Boolean, default: true },

    features: {
        thirdPartyApi: Boolean,
    },

    flowConfig: {
        apiEndpoint: String, // "example.com/api/v1/psp/onboarding"
        authApi: String, // "example.com/api/v1/psp/auth"
    }
});

module.exports = mongoose.model('Segment', segmentSchema);