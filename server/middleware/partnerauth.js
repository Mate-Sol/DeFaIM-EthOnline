const jwt = require('jsonwebtoken');
const UsedToken = require('../models/UsedToken');
const ExternalPSPUser = require('../models/ExternalPSPUser');
const User = require('../models/User');

const verifyPartnerAuth = async (req, res, next) => {
    try {
        const apiKey = req.header('X-API-Key');
        const authHeader = req.header('Authorization');
        const token = authHeader ? authHeader.replace('Bearer ', '') : null;

        if (!apiKey || !token) {
            return res.status(401).json({
                message: 'Authentication required. Provide X-API-Key and Authorization: Bearer <token>'
            });
        }

        // 1. Verify JWT
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ message: 'Invalid or expired access token' });
        }

        // 2. Validate payload
        if (
            decoded.role !== 'PSP' ||
            !decoded.partnerId ||
            !decoded.jti
        ) {
            return res.status(403).json({
                message: 'Access denied: Valid single-use partner token required'
            });
        }

        // 3. Check single-use token
        const alreadyUsed = await UsedToken.findOne({ jti: decoded.jti });
        if (alreadyUsed) {
            return res.status(401).json({
                message: 'This token has already been used. Please log in again.'
            });
        }

        // 4. Mark token as used (race-condition safe enough for most cases)
        await UsedToken.create({
            jti: decoded.jti,
            expiresAt: new Date(decoded.exp * 1000)
        });

        // 5. Validate partner
        const partner = await User.findById(decoded.partnerId);

        if (!partner || !partner.isActive) {
            return res.status(403).json({
                message: 'Partner account not found or inactive'
            });
        }

        if (partner.apiKey !== apiKey) {
            return res.status(403).json({
                message: 'API Key mismatch for this session'
            });
        }

        // ✅ Attach to request (VERY IMPORTANT)
        req.partner = partner;
        req.tokenData = decoded;

        next();

    } catch (error) {
        console.error('[Middleware] Auth Error:', error);
        res.status(500).json({
            message: 'Server error during authentication',
            error: error.message
        });
    }
};

module.exports = verifyPartnerAuth;