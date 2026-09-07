/**
 * Overdue Watcher — Background Worker
 *
 * Polls every hour for disbursed financing requests that are past due.
 * Sends due-soon and overdue notifications.
 *
 * Solana migration note: penalty fees are now computed automatically by the
 * Anchor program inside `repay` (utilization rate for grace day, then penalty
 * rate per day after). There is no on-chain pause concept — the program blocks
 * new drawdowns while any prior drawdown is past `tenor + grace + penalty`
 * via the `remaining_accounts` overdue check. So this worker is now a pure
 * notifier; no on-chain side effects.
 */

const FinancingRequest = require('../models/FinancingRequest');
const PSPProfile = require('../models/PSPProfile');
const { notifyAdmins } = require('../services/notificationService');
const { sendEmail } = require('../services/emailService');

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Check a single financing request for due-soon and overdue status.
 */
async function checkRequestAlerts(request, psp) {
  try {
    if (!request.dueDate || !request.disbursedAt) return;

    const now = new Date();
    const dueDate = new Date(request.dueDate);
    const msToDue = dueDate - now;
    const hoursToDue = msToDue / (1000 * 60 * 60);

    // ── 1. Due Soon Alert (24 Hours) ─────────────────────────────
    if (msToDue > 0 && hoursToDue <= 24 && !request.dueSoonEmailSent) {
      console.log(`[OverdueWatcher] Request ${request._id} is DUE SOON (${Math.floor(hoursToDue)}h)`);
      
      const pspUser = await require('../models/User').findById(psp.userId);
      if (pspUser) {
        await sendEmail({
          to: pspUser.email,
          subject: "Upcoming Payment Due",
          title: "Payment Reminder",
          body: `
            <p>This is a reminder that your financing repayment for order <strong>${request.orderReference}</strong> is due in less than 24 hours.</p>
            <div style="background-color: #fffbeb; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b;">
              <p style="margin: 0;"><strong>Order Reference:</strong> ${request.orderReference}</p>
              <p style="margin: 0;"><strong>Amount Due:</strong> $${request.amount.toLocaleString()}</p>
              <p style="margin: 0;"><strong>Due Date:</strong> ${dueDate.toLocaleString()}</p>
            </div>
            <p>Please ensure you have sufficient funds in your wallet to avoid penalties.</p>
          `,
          actionText: "View Dashboard",
          actionLink: `${process.env.FRONTEND_URL}/psp/dashboard`
        });
      }

      request.dueSoonEmailSent = true;
      await request.save();
    }

    // ── 2. Overdue Logic ──────────────────────────────────────────
    if (now > dueDate) {
      const overdueMs = now - dueDate;
      const overdueHours = overdueMs / (1000 * 60 * 60);
      const overdueDays = overdueMs / (1000 * 60 * 60 * 24);

      const gracePeriodHours = psp.penaltyGracePeriodHours || 24;
      const pauseThresholdDays = psp.pauseAfterDays || 3;
      const penaltyBips = psp.penaltyBips || 0;

      // Mark overdue if past grace period
      if (overdueHours >= gracePeriodHours && !request.isOverdue) {
        request.isOverdue = true;
        request.overdueAt = dueDate;
        request.status = 'Overdue';
        await request.save();

        console.log(`[OverdueWatcher] Request ${request._id} marked OVERDUE (${Math.floor(overdueHours)}h)`);

        // Notify admins (In-App)
        await notifyAdmins(null, {
          type: 'danger',
          title: 'Financing Request Overdue',
          message: `Request ${request.orderReference} for ${psp.companyName} is overdue by ${Math.floor(overdueHours)} hours.`
        });
      }

      // Send Overdue Email (Once)
      if (request.isOverdue && !request.overdueEmailSent) {
        const pspUser = await require('../models/User').findById(psp.userId);
        
        // Notify PSP
        if (pspUser) {
          await sendEmail({
            to: pspUser.email,
            subject: "URGENT: Financing Repayment Overdue",
            title: "Overdue Notice",
            body: `
              <p>Your financing repayment for order <strong>${request.orderReference}</strong> is now overdue.</p>
              <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; border-left: 4px solid #ef4444;">
                <p style="margin: 0; color: #991b1b;"><strong>Status:</strong> OVERDUE</p>
                <p style="margin: 0;"><strong>Order Reference:</strong> ${request.orderReference}</p>
                <p style="margin: 0;"><strong>Overdue Since:</strong> ${dueDate.toLocaleString()}</p>
              </div>
              <p>Please settle this immediately. Note that penalties are now being applied per day as per your agreement.</p>
            `,
            actionText: "Repay Now",
            actionLink: `${process.env.FRONTEND_URL}/psp/dashboard`
          });
        }

        // Notify Admins (Email)
        const User = require('../models/User');
        const admins = await User.find({ role: { $in: ['CRO', 'CFO', 'KAM'] } });
        for (const admin of admins) {
          await sendEmail({
            to: admin.email,
            subject: `Alert: ${psp.companyName} Overdue`,
            title: "PSP Overdue Alert",
            body: `<p>PSP <strong>${psp.companyName}</strong> has an overdue financing request (Ref: ${request.orderReference}).</p>
                   <p>Overdue by ${Math.floor(overdueHours)} hours.</p>`,
            actionText: "View Application",
            actionLink: `${process.env.FRONTEND_URL}/admin/application/${psp._id}`
          });
        }

        request.overdueEmailSent = true;
        await request.save();
      }

      // Mirror on-chain penalty accrual into Mongo for UX/reporting only.
      // The Anchor program is the authoritative source — it computes penalty
      // automatically inside `repay`. We track an estimate here so the admin
      // dashboard can show overdue exposure without waiting for the indexer.
      if (request.isOverdue && penaltyBips > 0) {
        const fullOverdueDays = Math.floor(overdueDays);
        const dailyPenalty = (request.amount * penaltyBips) / 10000;
        const estimatedPenalty = dailyPenalty * fullOverdueDays;
        if (estimatedPenalty > (request.penaltyAmount || 0)) {
          request.penaltyAmount = estimatedPenalty;
          request.status = 'PenaltyApplied';
          await request.save();
        }
      }

      // Auto-pause threshold → admin alert. The Solana program has no pause
      // instruction; the contract blocks new draws automatically once a
      // drawdown is past tenor+grace+penalty, so the operational signal here
      // is "alert admin" rather than "call pausePool".
      if (overdueDays >= pauseThresholdDays) {
        await notifyAdmins(null, {
          type: 'danger',
          title: 'PSP Past Pause Threshold',
          message: `${psp.companyName} is ${Math.floor(overdueDays)} days overdue. New drawdowns will be blocked on-chain until cleared.`
        });
      }
    }
  } catch (err) {
    console.error(`[OverdueWatcher] Error checking request ${request._id}:`, err.message);
  }
}

/**
 * Main poll: find all disbursed requests past due or due within 24h.
 */
async function pollOverdueRequests() {
  try {
    // Look for requests that are either already past due OR due within the next 24 hours
    const tomorrow = new Date();
    tomorrow.setHours(tomorrow.getHours() + 24);

    const activeRequests = await FinancingRequest.find({
      status: { $in: ['Disbursed', 'Overdue', 'PenaltyApplied', 'ProcessingRepayment'] },
      dueDate: { $lt: tomorrow },
      createdAt: { $gte: new Date('2026-04-02') } // Safety buffer
    });

    if (activeRequests.length === 0) return;

    console.log(`[OverdueWatcher] Polling ${activeRequests.length} active requests for alerts`);

    for (const request of activeRequests) {
      const psp = await PSPProfile.findById(request.pspId);
      if (!psp) continue;
      await checkRequestAlerts(request, psp);
    }
  } catch (err) {
    console.error('[OverdueWatcher] Poll error:', err.message);
  }
}

/**
 * Start the watcher loop.
 */
function startOverdueWatcher() {
  console.log('[OverdueWatcher] Started — polling every 1 hour');
  setTimeout(pollOverdueRequests, 30000);
  setInterval(pollOverdueRequests, POLL_INTERVAL_MS);
}

module.exports = { startOverdueWatcher, pollOverdueRequests };
