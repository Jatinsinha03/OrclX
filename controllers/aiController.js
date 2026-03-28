/**
 * OrclX – AI Controller
 * Handles routes for AI-assisted prediction evaluation.
 */

const aiService = require('../services/aiService');
const predictionService = require('../services/predictionService');

/**
 * GET /ai/evaluate
 * Fetches top 5 predictions and returns AI decisions.
 */
async function evaluateAll(req, res) {
  const { telegramId } = req.query;
  try {
    const list = await predictionService.getAllPredictions();
    const top5 = list.slice(0, 5);
    
    if (top5.length === 0) {
      return res.status(404).json({ success: false, message: 'No predictions found.' });
    }

    const evaluations = await aiService.evaluatePredictions(top5, telegramId);
    res.json({ success: true, evaluations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /ai/execute
 * Executes multiple bets based on user's confirmation.
 * Expects { userId, bets: Array<{ onchainId, isYes, stakeWei }> }
 */
async function executeBets(req, res) {
  const { telegramId, bets } = req.body;
  
  if (!telegramId || !Array.isArray(bets)) {
    return res.status(400).json({ success: false, message: 'Invalid data.' });
  }

  try {
    const results = [];
    for (const b of bets) {
      const resVal = await predictionService.placeBet(b.onchainId, b.isYes, telegramId);
      results.push(resVal);
    }
    
    res.json({ success: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  evaluateAll,
  executeBets,
};
