const FinancingRequest = require('../models/FinancingRequest');
const RepaymentRecord = require('../models/RepaymentRecord');
const PSPProfile = require('../models/PSPProfile');
const { createNotification } = require('../services/notificationService');
const { sendEmail } = require('../services/emailService');
const { isRealTxHash: looksLikeRealTxHash } = require('../utils/txHash');

/**
 * Repayment Agent - Processes PSP repayments and restores credit lines
 * Triggered when PSP repays a financing request
 */

/**
 * Process a repayment for a financing request
 * @param {string} requestId - FinancingRequest ID
 * @param {object} repaymentData - Repayment details from blockchain or manual input
 */
async function processRepayment(requestId, repaymentData) {
  try {
    console.log(`[Repayment Agent] Processing repayment for request: ${requestId}`);

    // 1. Find and validate financing request
    const financing = await FinancingRequest.findById(requestId).populate({
      path: 'pspId',
      populate: { path: 'userId' }
    });

    if (!financing) {
      throw new Error(`Financing request ${requestId} not found`);
    }

    const repayableStatuses = ['Disbursed', 'Overdue', 'PenaltyApplied', 'RepaymentPending', 'ProcessingRepayment'];
    if (!repayableStatuses.includes(financing.status)) {
      throw new Error(`Financing request ${requestId} is not in a repayable status (current: ${financing.status})`);
    }

    const psp = financing.pspId;

    if (!psp) {
      throw new Error(`PSP not found for financing request ${requestId}`);
    }

    // 2. Extract repayment data
    const {
      principalAmount = 0, // This is the principal PART of this specific repayment
      actualInterestPaid = 0, // This is the interest PART of this specific repayment
      txHash,
      blockNumber
    } = repaymentData;

    // Current state before this payment
    const currentRemainingPrincipal = financing.remainingPrincipal !== undefined ? financing.remainingPrincipal : financing.amount;
    const currentTotalInterestSettled = financing.totalInterestSettled || 0;
    const interestDays = financing.interestDays;

    // Expected interest FOR THE REPAID PORTION
    const calculatedRepaymentInterest = (principalAmount * (financing.utilizedBips || 0) * interestDays) / 10000;
    const expectedInterest = Math.round(calculatedRepaymentInterest * 100) / 100;

    console.log(`[Repayment Agent] Processing Payment - Principal: ${principalAmount}, Interest: ${actualInterestPaid}, Proportional Interest Expected: ${expectedInterest}`);

    // 4. Update financing request tracking
    financing.remainingPrincipal = Math.max(0, currentRemainingPrincipal - principalAmount);
    financing.totalInterestSettled = currentTotalInterestSettled + actualInterestPaid;
    
    // Check if fully repaid
    if (financing.remainingPrincipal <= 0.01) { // Rounding threshold
      financing.status = 'Repaid';
      financing.repaidAt = new Date();
      financing.remainingPrincipal = 0;
    } else {
      // Still active, but partially repaid
      financing.status = 'Disbursed'; // Keep in Disbursed state (or move from Overdue/Penalty back to Disbursed?)
      // Note: If they pay off overdue amount but not full principal, we might want to reset the status
    }

    // Only persist a real 0x… on-chain hash. Avoid the historical
    // OFFCHAIN-… placeholder pattern and avoid clobbering a previously
    // recorded real hash with a null/empty value.
    const isRealTxHash = looksLikeRealTxHash(txHash);
    if (isRealTxHash) {
      financing.repaymentTxHash = txHash;
    }
    financing.actualInterestPaid = (financing.actualInterestPaid || 0) + actualInterestPaid; // Total interest paid across life
    financing.expectedInterestAtRepayment = expectedInterest; // Record what was expected at this last payment point

    await financing.save();

    console.log(`[Repayment Agent] Updated FinancingRequest ${requestId}: Remaining Principal: ${financing.remainingPrincipal}, Status: ${financing.status}`);

    // 5. Create/Update repayment record for audit trail
    let repaymentRecord;
    // ... (rest of the logic for creating/updating repayment records)
    // We stay with existing logic but ensure principalAmount is correctly passed as the PART restored.
    
    if (repaymentData.repaymentRecordId) {
      repaymentRecord = await RepaymentRecord.findById(repaymentData.repaymentRecordId);
      if (repaymentRecord) {
        repaymentRecord.status = 'Completed';
        // Same guard as above — only persist a real 0x… hash, don't clobber
        // an existing real hash with null/empty/OFFCHAIN-…
        if (isRealTxHash) {
          repaymentRecord.txHash = txHash;
          repaymentRecord.blockNumber = blockNumber;
        }
        repaymentRecord.actualInterestPaid = actualInterestPaid;
        repaymentRecord.principalAmount = principalAmount;
        repaymentRecord.penaltyFee = financing.penaltyAmount || 0;
        repaymentRecord.totalRepayment = principalAmount + actualInterestPaid + (repaymentRecord.penaltyFee || 0);
        await repaymentRecord.save();
      }
    }

    if (!repaymentRecord) {
      repaymentRecord = new RepaymentRecord({
        financingRequestId: financing._id,
        pspId: psp._id,
        principalAmount,
        expectedInterest, // This is a bit ambiguous for partials - maybe record delta interest expected?
        actualInterestPaid,
        penaltyFee: financing.penaltyAmount || 0,
        totalRepayment: principalAmount + actualInterestPaid + (financing.penaltyAmount || 0),
        repaymentDate: new Date(),
        // Only set when the caller supplied a real on-chain hash; null is
        // preferred over the historical OFFCHAIN-… placeholder.
        txHash: isRealTxHash ? txHash : null,
        blockNumber: isRealTxHash ? blockNumber : null,
        creditLineRestored: principalAmount,
        status: 'Completed'
      });
      await repaymentRecord.save();
    }

    console.log(`[Repayment Agent] Finalized RepaymentRecord ${repaymentRecord._id}`);

    // 6. Restore PSP credit line (revolving credit model)
    // Reduce currently utilized amount by the principal amount REPAID IN THIS STEP
    if (psp.currentlyUtilized >= principalAmount) {
      psp.currentlyUtilized -= principalAmount;
      await psp.save();

      console.log(`[Repayment Agent] Restored ${principalAmount} to PSP ${psp.companyName}'s available credit`);
    } else {
      console.warn(`[Repayment Agent] Warning: PSP currentlyUtilized (${psp.currentlyUtilized}) is less than principal repayment (${principalAmount})`);
      psp.currentlyUtilized = 0;
      await psp.save();
    }

    // Trigger Repayment Notification
    try {
      if (psp && psp.userId) {
        await createNotification(psp.userId._id, {
          title: 'Repayment Successful!',
          message: `Repayment of $${(principalAmount + actualInterestPaid).toLocaleString()} for order ${financing.orderReference} was successful.`,
          type: 'success'
        });

        await sendEmail({
          to: psp.userId.email,
          subject: 'Repayment Received - Confirmation',
          title: 'Repayment Received',
          body: `<p>We have successfully processed your repayment for order <strong>${financing.orderReference}</strong>.</p>
                 <div style="background: rgba(255, 255, 255, 0.05); padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid rgba(255, 255, 255, 0.05);">
                   <p style="margin: 5px 0;"><strong>Principal:</strong> $${principalAmount.toLocaleString()}</p>
                   <p style="margin: 5px 0;"><strong>Interest Paid:</strong> $${actualInterestPaid.toLocaleString()}</p>
                   ${financing.penaltyAmount > 0 ? `<p style="margin: 5px 0;"><strong>Penalty:</strong> $${financing.penaltyAmount.toLocaleString()}</p>` : ''}
                   <p style="margin: 5px 0;"><strong>Total Repaid:</strong> $${(principalAmount + actualInterestPaid + (financing.penaltyAmount || 0)).toLocaleString()}</p>
                 </div>
                 <p>Your available credit line has been restored by $${principalAmount.toLocaleString()}.</p>`
        });
      }
    } catch (notifyError) {
      console.error('[Repayment Agent] Success notification error:', notifyError);
    }

    // 7. Return success result
    return {
      success: true,
      financing,
      repaymentRecord,
      creditRestored: principalAmount,
      variance: actualInterestPaid - expectedInterest,
      variancePercentage: expectedInterest > 0
        ? ((actualInterestPaid - expectedInterest) / expectedInterest) * 100
        : 0
    };

  } catch (error) {
    console.error(`[Repayment Agent] Error processing repayment for ${requestId}:`, error);

    // Create failed repayment record if not already in a failed state
    try {
      if (repaymentData.repaymentRecordId) {
        await RepaymentRecord.findByIdAndUpdate(repaymentData.repaymentRecordId, {
          status: 'Failed'
        });
      } else {
        const failedRecord = new RepaymentRecord({
          financingRequestId: requestId,
          pspId: repaymentData.pspId,
          principalAmount: repaymentData.principalAmount || 0,
          expectedInterest: 0,
          actualInterestPaid: repaymentData.actualInterestPaid || 0,
          totalRepayment: 0,
          repaymentDate: new Date(),
          txHash: repaymentData.txHash || 'FAILED',
          creditLineRestored: 0,
          status: 'Failed'
        });
        await failedRecord.save();
      }
    } catch (recordError) {
      console.error('[Repayment Agent] Failed to update/create failed repayment record:', recordError);
    }

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Request a repayment for a financing request (PSP side, no SC call)
 * @param {string} requestId - FinancingRequest ID
 * @param {string} pspId - PSP Profile ID
 */
async function requestRepayment(requestId, pspId, repaymentData = {}) {
  try {
    console.log(`[Repayment Agent] Requesting repayment for request: ${requestId}`);

    const financing = await FinancingRequest.findById(requestId).populate('pspId');
    if (!financing) throw new Error('Financing request not found');
    if (!['Disbursed', 'Overdue', 'PenaltyApplied', 'RepaymentPending'].includes(financing.status)) {
      throw new Error(`Invalid status for repayment request: ${financing.status}`);
    }

    const currentPrincipal = financing.remainingPrincipal !== undefined ? financing.remainingPrincipal : financing.amount;
    const interestDays = financing.interestDays;

    // Default proportional interest calculation
    const defaultProportionalInterest = (currentPrincipal * (financing.utilizedBips || 0) * interestDays) / 10000;
    const expectedInterest = Math.round(defaultProportionalInterest * 100) / 100;

    // Use requested amounts if provided (for partials), otherwise default to current full principal/interest
    const principalToRepay = repaymentData.principalAmount !== undefined ? repaymentData.principalAmount : currentPrincipal;
    const interestToRepay = repaymentData.actualInterestPaid !== undefined ? repaymentData.actualInterestPaid : expectedInterest;

    // Update status to RepaymentPending
    financing.status = 'RepaymentPending';
    await financing.save();

    // Create pending record
    const repaymentRecord = new RepaymentRecord({
      financingRequestId: financing._id,
      pspId: pspId,
      receiptId: financing.orderReference,
      principalAmount: principalToRepay,
      expectedInterest: expectedInterest, // Baseline for comparison
      actualInterestPaid: interestToRepay,
      penaltyFee: financing.penaltyAmount || 0,
      totalRepayment: principalToRepay + interestToRepay + (financing.penaltyAmount || 0),
      repaymentDate: new Date(),
      creditLineRestored: 0,
      status: 'Pending Confirmation'
    });

    await repaymentRecord.save();

    // Notify admins (CRO specifically)
    const { notifyAdmins } = require('../services/notificationService');
    await notifyAdmins(null, {
      type: 'warning',
      title: 'Repayment Confirmation Required',
      message: `PSP ${financing.pspId.companyName} has marked order ${financing.orderReference} as repaid. Please confirm receipt of funds.`
    });

    return {
      success: true,
      financing,
      repaymentRecord
    };
  } catch (error) {
    console.error(`[Repayment Agent] Error requesting repayment:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Get repayment quote for a financing request
 * @param {string} requestId - FinancingRequest ID
 */
async function getRepaymentQuote(requestId) {
  try {
    const financing = await FinancingRequest.findById(requestId).populate('pspId');

    if (!financing) {
      throw new Error('Financing request not found');
    }

    if (!['Disbursed', 'Overdue', 'PenaltyApplied'].includes(financing.status)) {
      throw new Error(`Cannot repay request with status: ${financing.status}`);
    }

    const principal = financing.remainingPrincipal !== undefined ? financing.remainingPrincipal : financing.amount;
    const interestDays = financing.interestDays;
    const expectedInterest = financing.accruedInterest?.total || 0;
    const penaltyAmount = financing.penaltyAmount || 0;
    const totalDue = principal + expectedInterest + penaltyAmount;
    const daysElapsed = financing.daysElapsed;

    return {
      success: true,
      quote: {
        requestId: financing._id,
        orderReference: financing.orderReference,
        initialAmount: financing.amount,
        principal, // This is now remaining principal
        expectedInterest, // Total interest for remaining principal
        interestDays,
        penaltyAmount,
        penaltyTriggeredAt: financing.penaltyTriggeredAt,
        totalDue,
        daysElapsed,
        utilizedBips: financing.utilizedBips,
        poolAddress: financing.pspId.assignedPoolAddress,
        disbursedAt: financing.disbursedAt,
        dueDate: financing.dueDate,
        totalInterestSettled: financing.totalInterestSettled || 0
      }
    };
  } catch (error) {
    console.error('[Repayment Agent] Error generating quote:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  processRepayment,
  getRepaymentQuote,
  requestRepayment
};
