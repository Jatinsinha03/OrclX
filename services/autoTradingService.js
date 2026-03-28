/**
 * OrclX – Auto Trading Service
 * Manages user settings for automated AI betting.
 */

const prisma = require('../db/prisma');

/**
 * Get auto trading settings for a user.
 * Creates default settings if not exists.
 */
async function getSettings(telegramId) {
  const user = await prisma.user.findUnique({
    where: { telegramId: String(telegramId) },
    include: { autoTrading: true },
  });

  if (!user) throw new Error('User not found.');

  if (!user.autoTrading) {
    return await prisma.autoTradingSettings.create({
      data: { userId: user.id },
    });
  }

  return user.autoTrading;
}

/**
 * Update auto trading settings.
 */
async function updateSettings(telegramId, { enabled, intervalHours }) {
  const user = await prisma.user.findUnique({
    where: { telegramId: String(telegramId) },
  });

  if (!user) throw new Error('User not found.');

  return await prisma.autoTradingSettings.upsert({
    where: { userId: user.id },
    update: {
      enabled: enabled !== undefined ? enabled : undefined,
      intervalHours: intervalHours !== undefined ? intervalHours : undefined,
    },
    create: {
      userId: user.id,
      enabled: enabled || false,
      intervalHours: intervalHours || 2,
    },
  });
}

/**
 * Get all users with auto trading enabled.
 */
async function getEnabledUsers() {
  return await prisma.autoTradingSettings.findMany({
    where: { enabled: true },
    include: { user: true },
  });
}

/**
 * Mark auto trading as run for a user.
 */
async function markLastRun(userId) {
  return await prisma.autoTradingSettings.update({
    where: { userId },
    data: { lastRunAt: new Date() },
  });
}

module.exports = {
  getSettings,
  updateSettings,
  getEnabledUsers,
  markLastRun,
};
