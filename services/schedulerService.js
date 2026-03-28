/**
 * OrclX – Scheduler Service
 * Manages automated AI betting via background cron jobs.
 */

const cron = require('node-cron');
const autoTradingService = require('./autoTradingService');
const aiService = require('./aiService');
const predictionService = require('./predictionService');
const historyService = require('./historyService');
const resolutionService = require('./resolutionService');

/**
 * Initialize the cron scheduler.
 * Runs every 15 minutes to check for eligible auto-traders.
 */
function initScheduler() {
  console.log('⏰ [Scheduler] Initializing auto-trading cron job...');

  // Run every 15 minutes: */15 * * * *
  cron.schedule('*/15 * * * *', async () => {
    console.log('⏰ [Scheduler] Running auto-trading cycle...');
    await processAutoTrading();
  });

  console.log('⏰ [Scheduler] Initializing AI auto-resolution cron job...');
  // Every day at midnight
  cron.schedule('0 0 * * *', async () => {
    try {
      await resolutionService.runAutoResolution();
    } catch (err) {
      console.error('❌ [Scheduler] AI Resolution failed:', err.message);
    }
  });
}

/**
 * Main execution loop for automated trading.
 */
async function processAutoTrading() {
  try {
    const enabledUsers = await autoTradingService.getEnabledUsers();
    console.log(`⏰ [Scheduler] Found ${enabledUsers.length} users with auto-trading enabled.`);

    const now = new Date();

    for (const settings of enabledUsers) {
      const lastRun = settings.lastRunAt ? new Date(settings.lastRunAt) : new Date(0);
      const diffHours = (now - lastRun) / (1000 * 60 * 60);

      if (diffHours >= settings.intervalHours) {
        console.log(`🤖 [AutoTrade] Executing for user ${settings.user.telegramId} (Interval: ${settings.intervalHours}h)`);
        await executeUserBets(settings);
      }
    }
  } catch (err) {
    console.error('❌ [Scheduler] Error in processAutoTrading:', err.message);
  }
}

/**
 * Fetches predictions and executes AI bets for a specific user.
 */
async function executeUserBets(settings) {
  const { user } = settings;
  const telegramId = user.telegramId;

  try {
    const predictions = await predictionService.getAllPredictions();
    const activePredictions = predictions.slice(0, 5); // Take top 5 for analysis

    if (activePredictions.length === 0) {
      console.log(`🤖 [AutoTrade] No predictions found for user ${telegramId}`);
      return;
    }

    const evaluations = await aiService.evaluatePredictions(activePredictions, telegramId, settings.useMoltbook);
    const amountStr = '10000000000000000'; // 0.01 MON (fixed stake)

    for (const ev of evaluations) {
      const isYes = ev.decision.toUpperCase() === 'YES';
      
      console.log(`🤖 [AutoTrade] Placing ${ev.decision} bet for user ${telegramId} on prediction ${ev.id}`);
      
      try {
        const betRes = await predictionService.placeBet(ev.id, isYes, telegramId);
        
        // Log to history
        await historyService.logBet(
          user.id,
          ev.id,
          ev.decision,
          amountStr,
          betRes.txHash
        );
        
        console.log(`✅ [AutoTrade] Bet successful: ${betRes.txHash}`);
      } catch (betErr) {
        console.error(`❌ [AutoTrade] Bet failed for user ${telegramId} on ${ev.id}:`, betErr.message);
      }
    }

    // Update last run timestamp
    await autoTradingService.markLastRun(user.id);

  } catch (err) {
    console.error(`❌ [AutoTrade] Error for user ${telegramId}:`, err.message);
  }
}

module.exports = {
  initScheduler,
};
