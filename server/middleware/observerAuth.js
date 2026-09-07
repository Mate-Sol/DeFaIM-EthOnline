/**
 * observerAuth.js — service-to-service authentication middleware
 * ----------------------------------------------------------------
 *
 * WHAT THIS IS
 *   A standalone Express middleware that authenticates incoming requests
 *   from the SAFE-Observer reconciliation service (a separate Node process
 *   that watches a Gnosis Safe on-chain and joins its activity against
 *   PayMate's drawdown / repayment data).
 *
 * WHY IT EXISTS
 *   PayMate's existing authMiddleware (./auth.js) is JWT-based, expecting
 *   a real human user to be logged in. The SAFE-Observer is a backend
 *   service — it has no user, no session, no JWT. Without this middleware,
 *   the observer would have no way to call our admin endpoints to read
 *   FinancingRequest / RepaymentRecord data for reconciliation.
 *
 *   We deliberately did NOT modify the existing JWT middleware or any
 *   existing admin route. Instead, this middleware protects a NEW set of
 *   "observer-only" routes mounted under /observer (see ../routes/observer.js).
 *   Existing admin routes remain JWT-only and behave exactly as before.
 *
 * HOW IT WORKS
 *   - Reads the `X-Service-Key` header from the incoming request.
 *   - Compares it to `process.env.OBSERVER_SERVICE_KEY` using constant-time
 *     comparison (resists timing attacks even though the key is short).
 *   - If they match, calls next().
 *   - If the env var is not set, refuses every request with 503 — fail
 *     closed by default. To run locally without the observer integration,
 *     simply leave OBSERVER_SERVICE_KEY unset and don't call /observer/*.
 *   - On any other failure path, returns 401.
 *
 * REQUIRED ENV VAR
 *   OBSERVER_SERVICE_KEY — shared secret with the SAFE-Observer service.
 *   Set this to the SAME value as the observer's PAYMATE_SERVICE_KEY env
 *   var, so both ends of the link agree.
 *
 *   Example:
 *     OBSERVER_SERVICE_KEY=local-dev-shared-secret-please-change
 *
 * ADDED
 *   2026-04-11 — as part of feat/observer-lifecycle-integration.
 */

const crypto = require('crypto');

/**
 * Constant-time string compare. Avoids early-exit timing leaks. We pad to a
 * common length so the comparison cost doesn't vary with input length either.
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  const aBuf = Buffer.alloc(len);
  const bBuf = Buffer.alloc(len);
  aBuf.write(a);
  bBuf.write(b);
  // timingSafeEqual throws on length mismatch — we already padded, so safe.
  return crypto.timingSafeEqual(aBuf, bBuf) && a.length === b.length;
}

const observerAuth = (req, res, next) => {
  const expected = process.env.OBSERVER_SERVICE_KEY;

  if (!expected) {
    // Fail closed: if the operator hasn't configured the shared secret, we
    // do NOT silently allow the route. Better to surface the misconfig.
    return res.status(503).json({
      message:
        'Observer integration not configured. Set OBSERVER_SERVICE_KEY in the server env.',
    });
  }

  const provided = req.header('X-Service-Key');
  if (!provided) {
    return res
      .status(401)
      .json({ message: 'Missing X-Service-Key header' });
  }

  if (!safeCompare(provided, expected)) {
    return res.status(401).json({ message: 'Invalid X-Service-Key' });
  }

  // Mark the request so downstream code knows it's a service call (not a
  // human user). Mirrors the convention used by partnerauth.js.
  req.isServiceCall = true;
  return next();
};

module.exports = { observerAuth, safeCompare };
