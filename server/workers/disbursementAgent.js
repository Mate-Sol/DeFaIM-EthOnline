/**
 * Disbursement Agent (Background Worker)
 *
 * Solana migration note: drawdowns are now PSP-signed on-chain via the Anchor
 * program (`request_drawdown` in `solana/code/paymate-pool-v2`). The server no
 * longer performs the disbursement; it validates the request and transitions
 * to `AwaitingDrawdown` so the PSP portal surfaces a "Sign Drawdown" action.
 */

const FinancingRequest = require('../models/FinancingRequest');
const PSPProfile = require('../models/PSPProfile');
const { createNotification } = require('../services/notificationService');
const { sendEmail } = require('../services/emailService');

/**
 * Disburse financing via smart contract
 * @param {String} requestId - FinancingRequest ID
 */
async function disburseFinancing(requestId) {
  try {
    console.log(`[Disbursement Agent] Starting disbursement for request: ${requestId}`);

    // Get the financing request with populated PSP and User data
    const request = await FinancingRequest.findById(requestId).populate({
      path: 'pspId',
      populate: { path: 'userId' }
    });

    if (!request || request.status !== 'Validated') {
      console.error(`[Disbursement Agent] Invalid request status: ${request?.status}`);
      return;
    }

    const psp = request.pspId;

    // Ensure PSP has deployed contract and wallet address
    if (!psp.assignedPoolAddress) {
      await FinancingRequest.findByIdAndUpdate(requestId, {
        status: 'Failed',
        failureReason: 'PSP does not have deployed contract or wallet address'
      });
      console.log(`[Disbursement Agent] FAILED - No contract/wallet`);
      return;
    }

    // Get recipient wallet (first whitelisted wallet)
    const recipientAddress = Array.isArray(psp.walletAddress) && psp.walletAddress.length > 0
      ? psp.walletAddress[0].address
      : (typeof psp.walletAddress === 'string' ? psp.walletAddress : '');

    if (!recipientAddress) {
      await FinancingRequest.findByIdAndUpdate(requestId, {
        status: 'Failed',
        failureReason: 'PSP has no wallet address for receiving funds'
      });
      console.log(`[Disbursement Agent] FAILED - No recipient wallet`);
      return;
    }

    // Validate against drawable credit limit
    const drawableLimit = (psp.approvedCreditLine || psp.approvedAmount || 0) - (psp.creditReserve || 0);
    const currentlyUtilized = psp.currentlyUtilized || 0;
    const availableCredit = drawableLimit - currentlyUtilized;

    if (request.amount > availableCredit) {
      await FinancingRequest.findByIdAndUpdate(requestId, {
        status: 'Failed',
        failureReason: `Requested $${request.amount} exceeds available drawable credit $${availableCredit} (drawable limit: $${drawableLimit}, utilized: $${currentlyUtilized})`
      });
      console.log(`[Disbursement Agent] FAILED - Exceeds drawable credit`);
      return;
    }

    // Solana model: PSP self-serves the drawdown. Server transitions to
    // AwaitingDrawdown and notifies the PSP to sign in their portal.
    console.log(`[Disbursement Agent] Marking request as AwaitingDrawdown...`);
    console.log(`  Amount: $${request.amount}`);
    console.log(`  Recipient: ${recipientAddress}`);
    console.log(`  Drawable Limit: $${drawableLimit} | Used: $${currentlyUtilized} | Available: $${availableCredit}`);

    await FinancingRequest.findByIdAndUpdate(requestId, {
      status: 'AwaitingDrawdown',
      utilizedBips: psp.utilizedBips,
      unutilizedBips: psp.unutilizedBips,
      approvedAmount: psp.approvedAmount
    });

    try {
      if (psp && psp.userId) {
        await createNotification(psp.userId._id, {
          title: 'Drawdown Ready to Sign',
          message: `Order ${request.orderReference} is approved for $${request.amount.toLocaleString()}. Connect your wallet and sign the drawdown to receive funds.`,
          type: 'info'
        });

        await sendEmail({
          to: psp.userId.email,
          subject: 'Action Required: Sign Drawdown',
          title: 'Drawdown Ready',
          body: `<p>Your financing request for order <strong>${request.orderReference}</strong> is approved and ready to draw on-chain.</p>
                 <div style="background-color: rgba(255, 255, 255, 0.05); padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid rgba(255, 255, 255, 0.05);">
                   <p style="margin: 5px 0;"><strong>Amount:</strong> $${request.amount.toLocaleString()}</p>
                   <p style="margin: 5px 0;"><strong>Recipient Wallet:</strong> ${recipientAddress}</p>
                 </div>
                 <p>Open your dashboard, connect your wallet, and sign the drawdown to release funds.</p>`
        });
      }
    } catch (notifyError) {
      console.error('[Disbursement Agent] Notification error:', notifyError);
    }

  } catch (error) {
    console.error(`[Disbursement Agent] Error disbursing request ${requestId}:`, error);
    await FinancingRequest.findByIdAndUpdate(requestId, {
      status: 'Failed',
      failureReason: 'Disbursement error: ' + error.message
    });
  }
}

module.exports = {
  disburseFinancing
};
