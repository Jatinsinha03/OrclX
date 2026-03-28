/**
 * OrclX – Prediction Controller
 * Handles HTTP request validation & response formatting.
 */

const predictionService = require('../services/predictionService');

// ─── POST /prediction/create ────────────────────────────────────────

async function createPrediction(req, res) {
  try {
    const { question, stakeWei, tags, telegramId } = req.body;

    if (!question || !stakeWei) {
      return res.status(400).json({ error: 'question and stakeWei are required.' });
    }
    if (!telegramId) {
      return res.status(400).json({ error: 'telegramId is required.' });
    }

    const result = await predictionService.createPrediction(
      question,
      stakeWei,
      tags || [],
      String(telegramId)
    );

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error('[createPrediction]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── POST /prediction/bet ───────────────────────────────────────────

async function placeBet(req, res) {
  try {
    const { onchainId, isYes, telegramId } = req.body;

    if (onchainId == null || isYes == null) {
      return res.status(400).json({ error: 'onchainId and isYes are required.' });
    }
    if (!telegramId) {
      return res.status(400).json({ error: 'telegramId is required.' });
    }

    const result = await predictionService.placeBet(
      Number(onchainId),
      Boolean(isYes),
      String(telegramId)
    );

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error('[placeBet]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── POST /prediction/branch ────────────────────────────────────────

async function branchPrediction(req, res) {
  try {
    const { fromId, toId, yesOnTarget, amountWei, telegramId } = req.body;

    if (fromId == null || toId == null || yesOnTarget == null || !amountWei) {
      return res.status(400).json({ error: 'fromId, toId, yesOnTarget, amountWei are required.' });
    }
    if (!telegramId) {
      return res.status(400).json({ error: 'telegramId is required.' });
    }

    const result = await predictionService.branchPrediction(
      Number(fromId),
      Number(toId),
      Boolean(yesOnTarget),
      amountWei,
      String(telegramId)
    );

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error('[branchPrediction]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ─── GET /predictions ───────────────────────────────────────────────

async function getPredictions(req, res) {
  try {
    const predictions = await predictionService.getAllPredictions();
    return res.status(200).json({ success: true, data: predictions });
  } catch (err) {
    console.error('[getPredictions]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  createPrediction,
  placeBet,
  branchPrediction,
  getPredictions,
};
