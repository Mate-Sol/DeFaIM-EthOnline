/**
 * Scheduled Jobs for Credit Maintenance
 * Runs daily maintenance calculations and overdue checking
 */

const cron = require('node-cron');
const { processDailyMaintenance, markOverdueCharges } = require('../workers/creditMaintenanceWorker');
const { startOrderbookScheduler } = require('../workers/orderbookGenerator');

/**
 * Schedule daily maintenance calculation
 * Runs every day at midnight (00:00)
 */
function scheduleDailyMaintenance() {
  // Cron format: second minute hour day month weekday
  // '0 0 * * *' = Every day at midnight
  cron.schedule('0 0 * * *', async () => {
    console.log('[Scheduler] Running daily maintenance calculation...');
    try {
      const result = await processDailyMaintenance();
      console.log('[Scheduler] Daily maintenance complete:', result);
    } catch (error) {
      console.error('[Scheduler] Error in daily maintenance:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Karachi" // Adjust to your timezone
  });

  console.log('[Scheduler] Daily maintenance job scheduled (runs at midnight)');
}

/**
 * Schedule overdue charge marking
 * Runs every day at noon (12:00)
 */
function scheduleOverdueChecking() {
  // '0 12 * * *' = Every day at noon
  cron.schedule('0 12 * * *', async () => {
    console.log('[Scheduler] Checking for overdue charges...');
    try {
      const result = await markOverdueCharges();
      console.log('[Scheduler] Overdue check complete:', result);
    } catch (error) {
      console.error('[Scheduler] Error checking overdue charges:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Karachi"
  });

  console.log('[Scheduler] Overdue checking job scheduled (runs at noon)');
}

/**
 * Initialize all scheduled jobs
 */
function initializeScheduledJobs() {
  console.log('[Scheduler] Initializing scheduled jobs...');

  scheduleDailyMaintenance();
  scheduleOverdueChecking();

  // Start orderbook generator for external PSP
  // startOrderbookScheduler();

  console.log('[Scheduler] All jobs initialized successfully');
}

module.exports = {
  initializeScheduledJobs,
  scheduleDailyMaintenance,
  scheduleOverdueChecking
};
