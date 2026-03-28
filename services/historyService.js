/**
 * OrclX – AI Bet History Service
 */

const prisma = require('../db/prisma');

async function logBet(userId, predictionId, decision, amount, txHash) {
  return await prisma.aIBetHistory.create({
    data: {
      userId,
      predictionId,
      decision,
      amount: String(amount),
      txHash,
    },
  });
}

async function getHistory(telegramId, limit = 10) {
  const user = await prisma.user.findUnique({
    where: { telegramId: String(telegramId) },
  });

  if (!user) return [];

  return await prisma.aIBetHistory.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

module.exports = {
  logBet,
  getHistory,
};
