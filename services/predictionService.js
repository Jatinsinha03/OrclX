/**
 * OrclX – Prediction Service
 * Orchestrates blockchain calls + Prisma DB persistence.
 */

const prisma = require('../db/prisma');
const blockchain = require('./blockchainService');

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Find or create a user by Telegram ID.
 * @param {string} telegramId
 * @returns {Promise<object>} User record
 */
async function findOrCreateUser(telegramId) {
  let user = await prisma.user.findUnique({ where: { telegramId: String(telegramId) } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        telegramId: String(telegramId),
        walletAddress: blockchain.getWalletAddress(),
      },
    });
  }
  return user;
}

// ─── Create Prediction ──────────────────────────────────────────────

/**
 * Create a new prediction on-chain and persist it locally.
 * @param {string} question
 * @param {string} stakeWei - Stake in wei
 * @param {string[]} tags
 * @param {string} telegramId - Creator's Telegram ID
 */
async function createPrediction(question, stakeWei, tags, telegramId) {
  const user = await findOrCreateUser(telegramId);

  // Record pending transaction
  const txRecord = await prisma.transaction.create({
    data: {
      type: 'create',
      status: 'pending',
      userId: user.id,
      data: { question, stakeWei, tags },
    },
  });

  try {
    // Send on-chain
    const { tx, receipt } = await blockchain.createPrediction(question, stakeWei, tags);

    // Get the on-chain prediction count (== new ID)
    const onchainId = await blockchain.getPredictionCount();

    // Persist prediction
    const prediction = await prisma.prediction.upsert({
      where: { onchainId },
      update: {
        txHash: tx.hash, // Link the latest hash
        question,
        stake: stakeWei,
        tags,
      },
      create: {
        onchainId,
        question,
        stake: stakeWei,
        creatorAddress: user.walletAddress || blockchain.getWalletAddress(),
        tags,
        txHash: tx.hash,
      },
    });

    // Update transaction
    await prisma.transaction.update({
      where: { id: txRecord.id },
      data: { status: 'success', txHash: tx.hash },
    });

    return { prediction, txHash: tx.hash, onchainId };
  } catch (err) {
    await prisma.transaction.update({
      where: { id: txRecord.id },
      data: { status: 'fail', data: { error: err.message } },
    });
    throw err;
  }
}

// ─── Place Bet ──────────────────────────────────────────────────────

/**
 * Place a bet on an existing prediction.
 * @param {number} onchainId - On-chain prediction ID
 * @param {boolean} isYes - Bet YES or NO
 * @param {string} telegramId - Bettor's Telegram ID
 */
async function placeBet(onchainId, isYes, telegramId) {
  const user = await findOrCreateUser(telegramId);

  // Get stake from on-chain
  const onchainPrediction = await blockchain.getPrediction(onchainId);
  const stakeWei = onchainPrediction.stake;

  // Find local prediction
  let prediction = await prisma.prediction.findUnique({ where: { onchainId } });
  if (!prediction) {
    // Index it if missing
    prediction = await prisma.prediction.create({
      data: {
        onchainId,
        question: onchainPrediction.question,
        stake: stakeWei,
        creatorAddress: onchainPrediction.setter,
        resolved: onchainPrediction.resolved,
      },
    });
  }

  const txRecord = await prisma.transaction.create({
    data: {
      type: 'bet',
      status: 'pending',
      userId: user.id,
      data: { onchainId, isYes, stakeWei },
    },
  });

  try {
    const { tx } = await blockchain.bet(onchainId, isYes, stakeWei);

    await prisma.bet.create({
      data: {
        predictionId: prediction.id,
        userId: user.id,
        isYes,
        amount: stakeWei,
        txHash: tx.hash,
      },
    });

    await prisma.transaction.update({
      where: { id: txRecord.id },
      data: { status: 'success', txHash: tx.hash },
    });

    return { txHash: tx.hash, onchainId, isYes, stakeWei };
  } catch (err) {
    await prisma.transaction.update({
      where: { id: txRecord.id },
      data: { status: 'fail', data: { error: err.message } },
    });
    throw err;
  }
}

// ─── Branch Prediction (Chain) ──────────────────────────────────────

/**
 * Branch exposure from one prediction to another.
 * @param {number} fromId - Source on-chain ID
 * @param {number} toId - Target on-chain ID
 * @param {boolean} yesOnTarget
 * @param {string} amountWei
 * @param {string} telegramId
 */
async function branchPrediction(fromId, toId, yesOnTarget, amountWei, telegramId) {
  const user = await findOrCreateUser(telegramId);

  const txRecord = await prisma.transaction.create({
    data: {
      type: 'branch',
      status: 'pending',
      userId: user.id,
      data: { fromId, toId, yesOnTarget, amountWei },
    },
  });

  try {
    const { tx } = await blockchain.branchPrediction(fromId, toId, yesOnTarget, amountWei);

    await prisma.transaction.update({
      where: { id: txRecord.id },
      data: { status: 'success', txHash: tx.hash },
    });

    return { txHash: tx.hash, fromId, toId, yesOnTarget, amountWei };
  } catch (err) {
    await prisma.transaction.update({
      where: { id: txRecord.id },
      data: { status: 'fail', data: { error: err.message } },
    });
    throw err;
  }
}

// ─── Claim ──────────────────────────────────────────────────────────

/**
 * Claim winnings from a resolved prediction.
 * @param {number} onchainId
 * @param {string} telegramId
 */
async function claimWinnings(onchainId, telegramId) {
  const user = await findOrCreateUser(telegramId);

  const txRecord = await prisma.transaction.create({
    data: {
      type: 'claim',
      status: 'pending',
      userId: user.id,
      data: { onchainId },
    },
  });

  try {
    const { tx } = await blockchain.claim(onchainId);

    await prisma.transaction.update({
      where: { id: txRecord.id },
      data: { status: 'success', txHash: tx.hash },
    });

    return { txHash: tx.hash, onchainId };
  } catch (err) {
    await prisma.transaction.update({
      where: { id: txRecord.id },
      data: { status: 'fail', data: { error: err.message } },
    });
    throw err;
  }
}

// ─── Queries ────────────────────────────────────────────────────────

/**
 * Get all predictions from the local DB.
 */
async function getAllPredictions() {
  return prisma.prediction.findMany({
    orderBy: { createdAt: 'desc' },
    include: { bets: true },
  });
}

/**
 * Get a single prediction by on-chain ID.
 */
async function getPredictionByOnchainId(onchainId) {
  return prisma.prediction.findUnique({
    where: { onchainId },
    include: { bets: true },
  });
}

/**
 * Get predictions created by a specific user (by Telegram ID).
 * @param {string} telegramId
 */
async function getMyPredictions(telegramId) {
  const user = await findOrCreateUser(telegramId);
  const walletAddress = user.walletAddress || blockchain.getWalletAddress();

  return prisma.prediction.findMany({
    where: { creatorAddress: walletAddress },
    orderBy: { createdAt: 'desc' },
    include: { bets: true },
  });
}

// ─── Resolve Prediction ─────────────────────────────────────────────

/**
 * Request oracle resolution for a prediction on-chain.
 * @param {number} onchainId
 * @param {string} telegramId
 */
async function requestResolution(onchainId, telegramId) {
  const user = await findOrCreateUser(telegramId);

  const txRecord = await prisma.transaction.create({
    data: {
      type: 'resolve_request',
      status: 'pending',
      userId: user.id,
      data: { onchainId },
    },
  });

  try {
    const { tx } = await blockchain.requestResolution(onchainId);

    await prisma.transaction.update({
      where: { id: txRecord.id },
      data: { status: 'success', txHash: tx.hash },
    });

    return { txHash: tx.hash, onchainId };
  } catch (err) {
    await prisma.transaction.update({
      where: { id: txRecord.id },
      data: { status: 'fail', data: { error: err.message } },
    });
    throw err;
  }
}

/**
 * Settle oracle resolution for a prediction on-chain and update local DB.
 * @param {number} onchainId
 * @param {string} telegramId
 */
async function settleResolution(onchainId, telegramId) {
  const user = await findOrCreateUser(telegramId);

  const txRecord = await prisma.transaction.create({
    data: {
      type: 'resolve_settle',
      status: 'pending',
      userId: user.id,
      data: { onchainId },
    },
  });

  try {
    const { tx } = await blockchain.settleResolution(onchainId);

    // Read updated state from chain
    const onchainData = await blockchain.getPrediction(onchainId);
    const resultStr = onchainData.result === 1 ? 'Yes' : 'No';

    // Update local prediction
    await prisma.prediction.updateMany({
      where: { onchainId },
      data: { resolved: true, result: resultStr },
    });

    await prisma.transaction.update({
      where: { id: txRecord.id },
      data: { status: 'success', txHash: tx.hash },
    });

    return { txHash: tx.hash, onchainId, result: resultStr };
  } catch (err) {
    await prisma.transaction.update({
      where: { id: txRecord.id },
      data: { status: 'fail', data: { error: err.message } },
    });
    throw err;
  }
}

module.exports = {
  findOrCreateUser,
  createPrediction,
  placeBet,
  branchPrediction,
  claimWinnings,
  getAllPredictions,
  getPredictionByOnchainId,
  getMyPredictions,
  requestResolution,
  settleResolution,
};
