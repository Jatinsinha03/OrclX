/**
 * OrclX – Agent Webhook Routes
 * Handles callbacks from Dockerized OpenClaw agents.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../db/prisma');
const predictionService = require('../services/predictionService');

/**
 * webhook/agent-decision
 * Triggered by an AI agent container when a decision is made.
 */
router.post('/agent-decision', async (req, res) => {
  const { userId, sessionKey, onchainId, decision, confidence, reasoning } = req.body;

  console.log(`📡 [Webhook] Received decision from agent for user ${userId}: ${decision}`);

  try {
    // 1. Validate Session Key
    const agent = await prisma.agent.findFirst({
      where: { userId, sessionKey, status: 'running' },
      include: { user: true }
    });

    if (!agent) {
      console.warn(`⚠️ [Webhook] Invalid session or inactive agent for user ${userId}`);
      return res.status(403).json({ error: 'Unauthorized: Invalid session key' });
    }

    // 2. Validate Decision
    if (decision === 'SKIP') {
      console.log(`💤 [Webhook] Agent skipped market #${onchainId}`);
      return res.json({ status: 'skipped' });
    }

    // 3. Execute Bet
    // Note: In a real app, we'd use the user's delegated wallet.
    // Here we use the backend relayer on their behalf.
    const isYes = decision === 'YES';
    
    const result = await predictionService.placeBet(
      onchainId,
      isYes,
      agent.user.telegramId // Using the stored telegramId for betting logic
    );

    // 4. Notify User
    const botModule = require('../bot');
    await botModule.handleDecisionNotification(
      agent.user.telegramId,
      onchainId,
      decision,
      result.txHash
    );

    console.log(`✅ [Webhook] Bet executed for user ${userId}. Tx: ${result.txHash}`);
    res.json({ status: 'success', txHash: result.txHash });

  } catch (err) {
    console.error(`❌ [Webhook] Error processing decision:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
