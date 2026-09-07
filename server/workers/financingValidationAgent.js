/**
 * Financing Validation Agent (Background Worker)
 * Validates financing requests asynchronously without blocking user
 */

const FinancingRequest = require('../models/FinancingRequest');
const PSPProfile = require('../models/PSPProfile');
const OrderBook = require('../models/OrderBook');
const ExternalOrderBook = require('../models/ExternalOrderBook');
const { disburseFinancing } = require('./disbursementAgent');
const { createNotification } = require('../services/notificationService');
const { sendEmail } = require('../services/emailService');
const EfficientDeposit = require('../models/EfficientDeposit');

// Step labels in the order they're shown in the pipeline UI. Pre-staged
// when validation kicks off so the visualization renders the full chain
// even before the agent has gotten through it.
const PIPELINE_STEPS = [
  { name: 'Order verified',       key: 'orderExists' },
  { name: 'Credit line approved', key: 'hasCreditLine' },
  { name: 'Order not financed',   key: 'notAlreadyFinanced' },
  { name: 'Sufficient credit',    key: 'sufficientCredit' },
  { name: 'Risk validated',       key: 'validated' },
];

async function seedPipeline(requestId) {
  await FinancingRequest.findByIdAndUpdate(requestId, {
    validationSteps: PIPELINE_STEPS.map((s) => ({ name: s.name, status: 'pending' })),
  });
}

// Update one step. Idempotent: matches on name + array position.
async function markStep(requestId, stepName, status, detail = '') {
  const update = {
    [`validationSteps.$[s].status`]: status,
    [`validationSteps.$[s].detail`]: detail,
  };
  if (status === 'running') update[`validationSteps.$[s].startedAt`] = new Date();
  if (status === 'passed' || status === 'failed' || status === 'skipped') {
    update[`validationSteps.$[s].completedAt`] = new Date();
  }
  await FinancingRequest.updateOne(
    { _id: requestId },
    { $set: update },
    { arrayFilters: [{ 's.name': stepName }] }
  );
}

/**
 * Send notification to PSP about rejection
 */
async function notifyRejection(request, reason) {
  try {
    const psp = request.pspId;
    if (psp && psp.userId) {
      await createNotification(psp.userId._id, {
        title: 'Financing Request Rejected',
        message: `Your request for order ${request.orderReference} was rejected. Reason: ${reason}`,
        type: 'danger'
      });

      await sendEmail({
        to: psp.userId.email,
        subject: 'Financing Request Rejected',
        title: 'Financing Request Rejected',
        body: `<p>Your financing request for order <strong>${request.orderReference}</strong> has been rejected.</p>
               <div style="background-color: rgba(255, 255, 255, 0.05); padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid rgba(255, 255, 255, 0.05);">
                 <p style="margin: 0 0 5px 0; font-weight: bold; color: #ffffff;">Reason:</p>
                     <p style="margin: 0; color: #ebdffc;">${reason}</p>
               </div>`
      });
    }
  } catch (err) {
    console.error('[Validation Agent] Notification error:', err);
  }
}

/**
 * Validate a financing request in the background
 * @param {String} requestId - FinancingRequest ID
 */
async function validateFinancingRequest(requestId) {

  let request;
  try {
    console.log(`[Validation Agent] Starting validation for request: ${requestId}`);

    // Get the financing request with nested user population
    request = await FinancingRequest.findById(requestId).populate({
      path: 'pspId',
      populate: { path: 'userId' }
    });

    if (!request) {
      console.error(`[Validation Agent] Request not found: ${requestId}`);
      return;
    }

    const psp = request.pspId;
    console.log(`[Validation Agent] Validating request for PSP: ${psp}`);

    // Pre-stage the pipeline so the UI shows the full chain immediately.
    await seedPipeline(requestId);

    // Validation checks
    const validationResults = {
      hasCreditLine: false,
      orderExists: false,
      sufficientCredit: false,
      notAlreadyFinanced: false
    };

    // Check 1: PSP has approved credit line
    await markStep(requestId, 'Credit line approved', 'running');
    if (psp.creditLineStatus !== 'Approved' || !psp.approvedAmount) {
      const rejectionReason = 'No approved credit line available';
      await markStep(requestId, 'Credit line approved', 'failed', rejectionReason);
      await FinancingRequest.findByIdAndUpdate(requestId, {
        status: 'Rejected',
        rejectionReason
      });

      await notifyRejection(request, rejectionReason);

      // Reset EfficientDeposit status
      await EfficientDeposit.findOneAndUpdate(
        { "payload.unique_id": request.orderReference },
        { status: 'None' }
      );

      // Update External PSP orderbook if applicable
      if (request.isExternalPSP && (request.externalOrderId || request.orderReference)) {
        await ExternalOrderBook.findOneAndUpdate(
          {
            $or: [
              { _id: request.externalOrderId },
              { orderReference: request.orderReference }
            ]
          },
          {
            loanStatus: 'Rejected',
            notes: rejectionReason
          }
        );
        console.log(`[Validation Agent] Updated External PSP orderbook: ${request.orderReference || request.externalOrderId} -> Rejected`);
      }

      console.log(`[Validation Agent] REJECTED - No credit line`);
      return;
    }
    validationResults.hasCreditLine = true;
    await markStep(requestId, 'Credit line approved', 'passed', `Approved $${(psp.approvedAmount || 0).toLocaleString()}`);

    // Check 2: Order reference exists in OrderBook for this PSP
    await markStep(requestId, 'Order verified', 'running');
    const order = await EfficientDeposit.findOne({
      "metadata.partnerId": psp.userId._id,
      "payload.unique_id": request.orderReference
    });
    console.log("🚀 ~ validateFinancingRequest ~ order:", order, psp.userId._id, request.orderReference)
    if (!order) {
      const rejectionReason = `Order reference '${request.orderReference}' not found in your order book`;
      await markStep(requestId, 'Order verified', 'failed', rejectionReason);
      await FinancingRequest.findByIdAndUpdate(requestId, {
        status: 'Rejected',
        rejectionReason
      });

      await notifyRejection(request, rejectionReason);

      // Reset EfficientDeposit status
      await EfficientDeposit.findOneAndUpdate(
        { "payload.unique_id": request.orderReference },
        { status: 'None' }
      );

      // Update External PSP orderbook if applicable
      // if (request.isExternalPSP && (request.externalOrderId || request.orderReference)) {
      //   await ExternalOrderBook.findOneAndUpdate(
      //     {
      //       $or: [
      //         { _id: request.externalOrderId },
      //         { orderReference: request.orderReference }
      //       ]
      //     },
      //     {
      //       loanStatus: 'Rejected',
      //       notes: rejectionReason
      //     }
      //   );
      //   console.log(`[Validation Agent] Updated External PSP orderbook: ${request.orderReference || request.externalOrderId} -> Rejected`);
      // }

      console.log(`[Validation Agent] REJECTED - Order not found`);
      return;
    }
    validationResults.orderExists = true;
    await markStep(requestId, 'Order verified', 'passed', `Order ${request.orderReference} found in book`);

    // Check 3: Order not already financed
    await markStep(requestId, 'Order not financed', 'running');
    if (order.status === 'Financed') {
      const rejectionReason = `Order '${request.orderReference}' is already financed`;
      await markStep(requestId, 'Order not financed', 'failed', rejectionReason);
      await FinancingRequest.findByIdAndUpdate(requestId, {
        status: 'Rejected',
        rejectionReason
      });

      await notifyRejection(request, rejectionReason);

      // Update External PSP orderbook if applicable
      if (request.isExternalPSP && (request.externalOrderId || request.orderReference)) {
        await ExternalOrderBook.findOneAndUpdate(
          {
            $or: [
              { _id: request.externalOrderId },
              { orderReference: request.orderReference }
            ]
          },
          {
            loanStatus: 'Rejected',
            notes: rejectionReason
          }
        );
        console.log(`[Validation Agent] Updated External PSP orderbook: ${request.orderReference || request.externalOrderId} -> Rejected`);
      }

      console.log(`[Validation Agent] REJECTED - Order already financed`);
      return;
    }
    validationResults.notAlreadyFinanced = true;
    await markStep(requestId, 'Order not financed', 'passed', 'Order is open');

    // Check 4: Requested amount ≤ available credit
    await markStep(requestId, 'Sufficient credit', 'running');
    // Calculate current drawdown from active financings
    const activeFinancings = await FinancingRequest.find({
      pspId: psp._id,
      status: 'Disbursed'
    });
    const currentDrawdown = activeFinancings.reduce((sum, f) => sum + f.amount, 0);
    const availableCredit = psp.approvedAmount - currentDrawdown;

    if (request.amount > availableCredit) {
      const rejectionReason = `Insufficient credit. Requested: $${request.amount.toLocaleString()}, Available: $${availableCredit.toLocaleString()}`;
      await markStep(requestId, 'Sufficient credit', 'failed', rejectionReason);
      await FinancingRequest.findByIdAndUpdate(requestId, {
        status: 'Rejected',
        rejectionReason
      });

      await notifyRejection(request, rejectionReason);

      // Reset EfficientDeposit status
      await EfficientDeposit.findOneAndUpdate(
        { "payload.unique_id": request.orderReference },
        { status: 'None' }
      );

      // Update External PSP orderbook if applicable
      if (request.isExternalPSP && (request.externalOrderId || request.orderReference)) {
        await ExternalOrderBook.findOneAndUpdate(
          {
            $or: [
              { _id: request.externalOrderId },
              { orderReference: request.orderReference }
            ]
          },
          {
            loanStatus: 'Rejected',
            notes: rejectionReason
          }
        );
        console.log(`[Validation Agent] Updated External PSP orderbook: ${request.orderReference || request.externalOrderId} -> Rejected`);
      }

      console.log(`[Validation Agent] REJECTED - Insufficient credit`);
      return;
    }
    validationResults.sufficientCredit = true;
    await markStep(requestId, 'Sufficient credit', 'passed',
      `Requested $${request.amount.toLocaleString()} ≤ $${availableCredit.toLocaleString()} available`);

    // All checks passed - Mark as validated
    await markStep(requestId, 'Risk validated', 'passed', 'All gates cleared');
    await FinancingRequest.findByIdAndUpdate(requestId, {
      status: 'Validated',
      validatedAt: new Date()
    });

    // Trigger Success Notification
    try {
      const psp = request.pspId;
      if (psp && psp.userId) {
        await createNotification(psp.userId._id, {
          title: 'Financing Request Validated',
          message: `Your request for order ${request.orderReference} has been validated and disbursement is underway.`,
          type: 'success'
        });
      }
    } catch (notifyError) {
      console.error('[Validation Agent] Success notification error:', notifyError);
    }

    console.log(`[Validation Agent] VALIDATED ✓ - Triggering disbursement`);

    // Trigger disbursement agent (also async, doesn't block)
    disburseFinancing(requestId).catch(err => {
      console.error(`[Validation Agent] Error triggering disbursement:`, err);
    });

  } catch (error) {
    console.error(`[Validation Agent] Error validating request ${requestId}:`, error);
    await FinancingRequest.findByIdAndUpdate(requestId, {
      status: 'Failed',
      failureReason: 'Validation error: ' + error.message
    });

    // Reset EfficientDeposit status on unexpected error
    await EfficientDeposit.findOneAndUpdate(
      { "payload.unique_id": request.orderReference },
      { status: 'Rejected' }
    );
  }
}

module.exports = {
  validateFinancingRequest
};
