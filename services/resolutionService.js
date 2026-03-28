/**
 * OrclX – Resolution Service
 * Orchestrates AI-driven prediction verification and on-chain payouts.
 */

const prisma = require('../db/prisma');
const aiService = require('./aiService');
const blockchainService = require('./blockchainService');

/**
 * Scans for unresolved predictions and uses AI to settle them.
 * @returns {Promise<Array<object>>} Summary of resolutions
 */
async function runAutoResolution() {
  console.log('⚖️ [Resolution] Starting auto-resolution cycle...');

  // 1. Fetch all unresolved predictions from DB
  const unresolved = await prisma.prediction.findMany({
    where: { resolved: false },
  });

  if (unresolved.length === 0) {
    console.log('⚖️ [Resolution] No unresolved predictions found.');
    return [];
  }

  // 2. Use AI to check if events have finished
  console.log(`⚖️ [Resolution] Checking ${unresolved.length} predictions via AI...`);
  const AIResults = await aiService.checkEventStatus(unresolved);

  const summary = [];

  // 3. Process finished events
  for (const res of AIResults) {
    if (res.isFinished && (res.outcome === 'YES' || res.outcome === 'NO')) {
      try {
        const outcomeBool = res.outcome === 'YES';
        console.log(`⚖️ [Resolution] Resolving ID ${res.onchainId} (Outcome: ${res.outcome})...`);

        // Trigger on-chain resolution and payouts
        const tx = await blockchainService.adminResolveAndDistribute(
          res.onchainId,
          outcomeBool
        );

        // Update DB
        await prisma.prediction.update({
          where: { id: res.predictionId },
          data: {
            resolved: true,
            result: res.outcome,
          },
        });

        summary.push({
          id: res.predictionId,
          question: unresolved.find(p => p.id === res.predictionId).question,
          outcome: res.outcome,
          reasoning: res.reasoning,
          txHash: tx.tx.hash,
        });

      } catch (err) {
        console.error(`❌ [Resolution] Failed to resolve ID ${res.onchainId}:`, err.message);
      }
    }
  }

  console.log(`⚖️ [Resolution] Cycle finished. Resolved ${summary.length} predictions.`);
  return summary;
}

module.exports = {
  runAutoResolution,
};
