/**
 * routes/lifecycle.js — admin-facing reconciled-lifecycle endpoint
 * ---------------------------------------------------------------
 *
 * WHAT THIS FILE IS
 *   A single GET endpoint mounted under the existing /admin namespace:
 *
 *     GET /admin/credit-lines/:reference/lifecycle
 *
 *   The admin UI calls it (with the standard JWT) to display a unified
 *   lifecycle view for one drawdown — combining what PayMate already
 *   knows (FinancingRequest + RepaymentRecord rows from MongoDB) with
 *   what the SAFE-Observer service has reconciled against the chain.
 *
 * WHY IT EXISTS
 *   The reconciled view lives in a SEPARATE Node service (the SAFE-Observer
 *   reconciliation service). PayMate's FE doesn't talk to that service
 *   directly — it talks to PayMate's BE, which calls the observer with the
 *   shared service key, merges the results with its own MongoDB rows, and
 *   returns one clean object to the FE.
 *
 *   This server-side merge keeps the shared secret out of the browser and
 *   gives us one place to evolve the public lifecycle response shape.
 *
 *   This route is in its own file (not in admin.js) on purpose: the user
 *   asked us to keep risk on the existing admin routes at zero. Express
 *   merges /admin mounts cleanly when two router files are mounted at the
 *   same prefix in index.js.
 *
 * RESPONSE SHAPE
 *   {
 *     reference: "ORD-2026-001",
 *     paymate: {
 *       financingRequestId, pspId, pspCompanyName, status, amount,
 *       requestedAt, validatedAt, disbursedAt, repaidAt, dueDate,
 *       utilizedBips, txHash, contractAddress,
 *       repaymentRecord: { ... } | null
 *     },
 *     observer: {
 *       available: boolean,         // false if the observer service is unreachable
 *       reason?: string,            // why it's unavailable
 *       activity?: { ... }          // raw response from observer when available
 *     }
 *   }
 *
 * AUTH
 *   Uses the existing JWT middleware (authMiddleware) — same as every
 *   other admin route. The shared service key is NEVER exposed to the FE.
 *
 * FAIL-SOFT
 *   If the SAFE-Observer service is down, mis-configured, or returns an
 *   error, the endpoint still returns 200 with PayMate-only data and
 *   `observer.available: false`. The admin UI can then show partial data
 *   instead of a hard failure. The only way this endpoint returns a 4xx
 *   is if the FinancingRequest itself doesn't exist (404).
 *
 * ADDED
 *   2026-04-11 — feat/observer-lifecycle-integration
 */

const express = require('express');
const router = express.Router();

const FinancingRequest = require('../models/FinancingRequest');
const RepaymentRecord = require('../models/RepaymentRecord');
const { authMiddleware } = require('../middleware/auth');
const observerClient = require('../services/observerClient');

/**
 * The actual route handler. Exported separately from the router so that
 * test/lifecycle.test.js can call it as a plain function with fake req/res
 * objects + injected dependencies — no supertest, no Express boot, no DB.
 *
 * Production code path goes through the `router.get(...)` registration
 * below, which wraps this handler with the existing JWT auth middleware.
 *
 * @param {object} deps - injectable dependencies for testing
 * @param {object} deps.financingModel - mongoose model with .findOne(...).populate(...)
 * @param {object} deps.repaymentModel - mongoose model with .findOne(...)
 * @param {object} deps.observer - { getActivity(reference) }
 */
function buildLifecycleHandler({ financingModel, repaymentModel, observer }) {
  return async (req, res) => {
    const { reference } = req.params;
    if (!reference) {
      return res.status(400).json({ message: 'reference is required' });
    }

    try {
      // -- 1. Look up PayMate's view of this drawdown -----------------------
      const financingQuery = financingModel.findOne({
        orderReference: reference,
      });
      // Some mocks may not implement .populate(); guard defensively.
      const financing =
        typeof financingQuery.populate === 'function'
          ? await financingQuery.populate('pspId', 'companyName')
          : await financingQuery;

      if (!financing) {
        return res
          .status(404)
          .json({ message: `No FinancingRequest found for orderReference="${reference}"` });
      }

      const repayment = await repaymentModel.findOne({
        financingRequestId: financing._id,
      });

      const paymateBlock = {
        financingRequestId: financing._id,
        pspId: financing.pspId?._id || financing.pspId,
        pspCompanyName: financing.pspId?.companyName || null,
        status: financing.status,
        amount: financing.amount,
        requestedAt: financing.createdAt,
        validatedAt: financing.validatedAt || null,
        disbursedAt: financing.disbursedAt || null,
        dueDate: financing.dueDate || null,
        repaidAt: financing.repaidAt || null,
        utilizedBips: financing.utilizedBips || null,
        unutilizedBips: financing.unutilizedBips || null,
        txHash: financing.txHash || null,
        contractAddress: financing.contractAddress || null,
        repaymentRecord: repayment
          ? {
              _id: repayment._id,
              principalAmount: repayment.principalAmount,
              expectedInterest: repayment.expectedInterest,
              actualInterestPaid: repayment.actualInterestPaid,
              totalRepayment: repayment.totalRepayment,
              repaymentDate: repayment.repaymentDate,
              txHash: repayment.txHash || null,
              status: repayment.status,
            }
          : null,
      };

      // -- 2. Try to fetch the observer's reconciled view ------------------
      let observerBlock;
      try {
        const activity = await observer.getActivity(reference);
        if (activity == null) {
          observerBlock = {
            available: true,
            reason: 'Observer has no reconciled data for this reference yet',
            activity: null,
          };
        } else {
          observerBlock = { available: true, activity };
        }
      } catch (err) {
        // Fail soft: log it server-side but still return PayMate's data.
        console.warn(
          `[lifecycle] observer call failed for ${reference}:`,
          err.message,
        );
        observerBlock = {
          available: false,
          reason: err.message,
        };
      }

      return res.json({
        reference,
        paymate: paymateBlock,
        observer: observerBlock,
      });
    } catch (error) {
      console.error('[lifecycle] handler error:', error);
      return res.status(500).json({ message: 'Server error' });
    }
  };
}

// Production wiring — uses real Mongoose models + the real observer client.
const productionHandler = buildLifecycleHandler({
  financingModel: FinancingRequest,
  repaymentModel: RepaymentRecord,
  observer: observerClient,
});

router.get(
  '/credit-lines/:reference/lifecycle',
  authMiddleware,
  productionHandler,
);

/**
 * Per-drawdown lifecycle handler. Same response shape as the orderRef
 * version above but unambiguous when an orderReference has multiple
 * drawdowns under it (PayMate's revolving-credit flow). Looks up the
 * FinancingRequest by _id and asks the observer for THAT specific
 * drawdown's reconciled activity.
 */
function buildLifecycleByDrawdownIdHandler({ financingModel, repaymentModel, observer }) {
  return async (req, res) => {
    const { drawdownId } = req.params;
    if (!drawdownId) {
      return res.status(400).json({ message: 'drawdownId is required' });
    }

    try {
      const financingQuery = financingModel.findById(drawdownId);
      const financing =
        typeof financingQuery.populate === 'function'
          ? await financingQuery.populate('pspId', 'companyName')
          : await financingQuery;

      if (!financing) {
        return res
          .status(404)
          .json({ message: `No FinancingRequest found for _id="${drawdownId}"` });
      }

      const repayment = await repaymentModel.findOne({
        financingRequestId: financing._id,
      });

      const paymateBlock = {
        financingRequestId: financing._id,
        pspId: financing.pspId?._id || financing.pspId,
        pspCompanyName: financing.pspId?.companyName || null,
        status: financing.status,
        amount: financing.amount,
        requestedAt: financing.createdAt,
        validatedAt: financing.validatedAt || null,
        disbursedAt: financing.disbursedAt || null,
        dueDate: financing.dueDate || null,
        repaidAt: financing.repaidAt || null,
        utilizedBips: financing.utilizedBips || null,
        unutilizedBips: financing.unutilizedBips || null,
        txHash: financing.txHash || null,
        contractAddress: financing.contractAddress || null,
        repaymentRecord: repayment
          ? {
              _id: repayment._id,
              principalAmount: repayment.principalAmount,
              expectedInterest: repayment.expectedInterest,
              actualInterestPaid: repayment.actualInterestPaid,
              totalRepayment: repayment.totalRepayment,
              repaymentDate: repayment.repaymentDate,
              txHash: repayment.txHash || null,
              status: repayment.status,
            }
          : null,
      };

      let observerBlock;
      try {
        const activity = await observer.getActivityByDrawdownId(String(financing._id));
        if (activity == null) {
          observerBlock = {
            available: true,
            reason: 'Observer has no reconciled data for this drawdown yet',
            activity: null,
          };
        } else {
          observerBlock = { available: true, activity };
        }
      } catch (err) {
        console.warn(
          `[lifecycle] observer call failed for drawdown ${drawdownId}:`,
          err.message,
        );
        observerBlock = {
          available: false,
          reason: err.message,
        };
      }

      return res.json({
        drawdownId: String(financing._id),
        reference: financing.orderReference,
        paymate: paymateBlock,
        observer: observerBlock,
      });
    } catch (error) {
      console.error('[lifecycle by drawdownId] handler error:', error);
      return res.status(500).json({ message: 'Server error' });
    }
  };
}

const productionByDrawdownIdHandler = buildLifecycleByDrawdownIdHandler({
  financingModel: FinancingRequest,
  repaymentModel: RepaymentRecord,
  observer: observerClient,
});

// New per-drawdown endpoint. Use this when you have a specific
// FinancingRequest._id and need its lifecycle unambiguously — eg. when
// rendering a row in the repayments / financings table where the orderRef
// might repeat across rows.
router.get(
  '/drawdowns/:drawdownId/lifecycle',
  authMiddleware,
  productionByDrawdownIdHandler,
);

/**
 * List ALL drawdowns under an orderReference, each with its full lifecycle.
 * Convenience wrapper for the duplicate-orderRef case so the FE can render
 * every draw in one fetch.
 */
async function listLifecyclesByReferenceHandler(req, res) {
  const { reference } = req.params;
  if (!reference) {
    return res.status(400).json({ message: 'reference is required' });
  }

  try {
    const financings = await FinancingRequest.find({ orderReference: reference })
      .populate('pspId', 'companyName')
      .sort({ createdAt: -1 });

    if (financings.length === 0) {
      return res.json({ reference, count: 0, lifecycles: [] });
    }

    const lifecycles = await Promise.all(
      financings.map(async (financing) => {
        const repayment = await RepaymentRecord.findOne({
          financingRequestId: financing._id,
        });

        const paymateBlock = {
          financingRequestId: financing._id,
          pspId: financing.pspId?._id || financing.pspId,
          pspCompanyName: financing.pspId?.companyName || null,
          status: financing.status,
          amount: financing.amount,
          requestedAt: financing.createdAt,
          validatedAt: financing.validatedAt || null,
          disbursedAt: financing.disbursedAt || null,
          dueDate: financing.dueDate || null,
          repaidAt: financing.repaidAt || null,
          utilizedBips: financing.utilizedBips || null,
          unutilizedBips: financing.unutilizedBips || null,
          txHash: financing.txHash || null,
          contractAddress: financing.contractAddress || null,
          repaymentRecord: repayment
            ? {
                _id: repayment._id,
                principalAmount: repayment.principalAmount,
                expectedInterest: repayment.expectedInterest,
                actualInterestPaid: repayment.actualInterestPaid,
                totalRepayment: repayment.totalRepayment,
                repaymentDate: repayment.repaymentDate,
                txHash: repayment.txHash || null,
                status: repayment.status,
              }
            : null,
        };

        let observerBlock;
        try {
          const activity = await observerClient.getActivityByDrawdownId(
            String(financing._id),
          );
          observerBlock = activity == null
            ? { available: true, reason: 'Observer has no reconciled data for this drawdown yet', activity: null }
            : { available: true, activity };
        } catch (err) {
          observerBlock = { available: false, reason: err.message };
        }

        return {
          drawdownId: String(financing._id),
          paymate: paymateBlock,
          observer: observerBlock,
        };
      }),
    );

    return res.json({
      reference,
      count: lifecycles.length,
      lifecycles,
    });
  } catch (error) {
    console.error('[lifecycle list] handler error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
}

router.get(
  '/credit-lines/:reference/lifecycles',
  authMiddleware,
  listLifecyclesByReferenceHandler,
);

// ---------------------------------------------------------------------------
// GET /admin/unmatched-vault-activity
//
// Returns Safe vault transactions that have NOT been matched to any PayMate
// drawdown or repayment. These are flagged as "unusual activity" for the
// admin to investigate — money moved on the vault but PayMate has no record.
//
// Added 2026-04-12 per Ali: "transactions that don't match with PayMate —
// you should view that as well and flag it."
// ---------------------------------------------------------------------------
router.get('/unmatched-vault-activity', authMiddleware, async (req, res) => {
  try {
    const axios = require('axios');
    const baseURL = process.env.OBSERVER_BASE_URL;
    const serviceKey = process.env.OBSERVER_SERVICE_KEY;

    if (!baseURL || !serviceKey) {
      return res.json({ available: false, reason: 'Observer not configured', events: [], total: 0 });
    }

    const response = await axios.get(`${baseURL.replace(/\/$/, '')}/api/unmatched-events`, {
      headers: { 'X-Service-Key': serviceKey },
      timeout: 5000,
      validateStatus: (s) => s < 500,
    });

    if (response.status === 401) {
      return res.json({ available: false, reason: 'Observer auth failed', events: [], total: 0 });
    }

    return res.json({
      available: true,
      total: response.data.total,
      events: response.data.events,
    });
  } catch (err) {
    return res.json({ available: false, reason: err.message, events: [], total: 0 });
  }
});

module.exports = router;
// Exported for unit tests — see test/lifecycle.test.js
module.exports.buildLifecycleHandler = buildLifecycleHandler;
module.exports.buildLifecycleByDrawdownIdHandler = buildLifecycleByDrawdownIdHandler;
