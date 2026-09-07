const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Lender = require('../models/Lender');

/**
 * authMiddleware accepts two token shapes:
 *   - User token (PSP/admin): { userId } — looked up in `User` collection.
 *   - Lender token (wallet-only): { kind: 'lender', lenderId, wallet } —
 *     looked up in `Lender` collection. role is set to 'LENDER'.
 *
 * `req.user` is normalized so downstream handlers can use the same shape
 * regardless of identity source.
 */
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No authentication token, access denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.kind === 'lender') {
      const lender = await Lender.findById(decoded.lenderId);
      if (!lender) return res.status(401).json({ message: 'Lender not found' });
      req.user = {
        kind: 'lender',
        lenderId: lender._id,
        wallet: lender.wallet,
        role: 'LENDER',
      };
      return next();
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    req.user = {
      kind: 'user',
      userId: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      // Expose the wallet bound to this user so poolTx.requireOnchainAdmin
      // can gate on it. Field name is `solanaWallet` for legacy reasons —
      // its value is a 20-byte EVM address in prod. Undefined for
      // password-only users; that's fine, requireOnchainAdmin also runs
      // isOnchainAdmin() which rejects empty.
      wallet: user.solanaWallet || undefined,
    };
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Role ${req.user.role} is not authorized to access this resource`,
      });
    }
    next();
  };
};

module.exports = { authMiddleware, authorizeRoles };
