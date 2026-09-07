/**
 * routes/observer.js — read-only data feeds for the SAFE-Observer service
 * -----------------------------------------------------------------------
 *
 * WHAT THIS FILE IS
 *   Two HTTP GET endpoints under the new `/observer` namespace, both
 *   protected by `observerAuth` (X-Service-Key header). They mirror the
 *   data shape that /admin/all-financings and /admin/repayment-history
 *   already return — but skip the JWT auth path so a backend-to-backend
 *   service can fetch the same data without faking a user session.
 *
 * WHY IT EXISTS
 *   The SAFE-Observer reconciliation service (a separate Node process,
 *   in its own repo) needs a steady feed of PayMate's drawdowns and
 *   repayments so it can join them against on-chain Safe events for
 *   reconciliation. The cleanest way to expose that data is a parallel,
 *   service-key-only namespace — without touching any of the existing
 *   admin routes.
 *
 *   Result: zero risk to the working admin UI flow. Existing /admin/*
 *   routes are unchanged. New /observer/* routes are completely additive.
 *
 * SHAPE NOTES
 *   - GET /observer/financings   → returns RAW Mongoose FinancingRequest
 *     documents (with `pspId` populated to `{ _id, companyName }`). The
 *     SAFE-Observer's TypeScript types (src/paymate/types.ts) expect this
 *     exact shape.
 *   - GET /observer/repayments   → returns RAW Mongoose RepaymentRecord
 *     documents (with `pspId` and `financingRequestId` populated).
 *
 *   We deliberately do NOT use the reformatted "{ orderReference, principal,
 *   psp }" shape that /admin/repayment-history uses for its UI. The observer
 *   wants raw documents so it can store them as-is.
 *
 * QUERY PARAMETERS
 *   Both endpoints accept:
 *     ?page=N        (default 1)
 *     ?limit=N       (default 100, max 500)
 *
 * AUTH
 *   Every route in this file is gated by `observerAuth`. Requests without
 *   a valid `X-Service-Key` header get 401 (or 503 if the env var isn't
 *   configured).
 *
 * ADDED
 *   2026-04-11 — feat/observer-lifecycle-integration
 */

const express = require('express');
const router = express.Router();

const FinancingRequest = require('../models/FinancingRequest');
const RepaymentRecord = require('../models/RepaymentRecord');
const { observerAuth } = require('../middleware/observerAuth');

// Apply service-key auth to every route in this file.
router.use(observerAuth);

// Helper: clamp limit so a misbehaving client can't pull the entire DB.
function clampLimit(raw, defaultValue, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(n, max);
}

// ---------------------------------------------------------------------------
// GET /observer/financings
// ---------------------------------------------------------------------------
router.get('/financings', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = clampLimit(req.query.limit, 100, 500);
    const skip = (page - 1) * limit;

    // Match the SAME default status filter that /admin/all-financings uses,
    // so the observer sees the same "active" set of drawdowns the admin UI
    // sees. (Repaid + Rejected + Failed are excluded — they show up via
    // /observer/repayments.)
    // Include 'Repaid' so the observer can verify existing repayments against
    // on-chain data. Without this, Repaid drawdowns are invisible to the
    // observer and their lifecycle returns null. (Fixed 2026-04-14.)
    const query = {
      status: {
        $in: [
          'Pending',
          'Validated',
          'Disbursed',
          'Repaid',
          'Overdue',
          'PenaltyApplied',
          'RepaymentPending',
          'ProcessingRepayment',
        ],
      },
    };

    const total = await FinancingRequest.countDocuments(query);
    const financings = await FinancingRequest.find(query)
      .populate('pspId', 'companyName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      financings,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      currentPage: page,
      // The observer doesn't need the `psps` dropdown helper or `summary`
      // aggregate that /admin/all-financings includes for the UI, so we
      // omit them to keep payloads small.
    });
  } catch (error) {
    console.error('[observer] /financings error:', error);
    res
      .status(500)
      .json({ message: 'Server error fetching financings for observer' });
  }
});

// ---------------------------------------------------------------------------
// GET /observer/repayments
// ---------------------------------------------------------------------------
router.get('/repayments', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = clampLimit(req.query.limit, 100, 500);
    const skip = (page - 1) * limit;

    // Mirror the existing admin route's filter: only Completed repayments.
    const query = { status: 'Completed' };

    const total = await RepaymentRecord.countDocuments(query);
    const repayments = await RepaymentRecord.find(query)
      .populate('pspId', 'companyName')
      .populate('financingRequestId', 'orderReference')
      .sort({ repaymentDate: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      repayments,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      currentPage: page,
    });
  } catch (error) {
    console.error('[observer] /repayments error:', error);
    res
      .status(500)
      .json({ message: 'Server error fetching repayments for observer' });
  }
});

module.exports = router;
