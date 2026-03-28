/**
 * OrclX – Auto Trading Controller
 */

const autoTradingService = require('../services/autoTradingService');
const historyService = require('../services/historyService');

async function getConfig(req, res) {
  const { telegramId } = req.query;
  if (!telegramId) return res.status(400).json({ success: false, message: 'Missing telegramId.' });

  try {
    const settings = await autoTradingService.getSettings(telegramId);
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function updateConfig(req, res) {
  const { telegramId, enabled, intervalHours } = req.body;
  if (!telegramId) return res.status(400).json({ success: false, message: 'Missing telegramId.' });

  try {
    const settings = await autoTradingService.updateSettings(telegramId, { enabled, intervalHours });
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getHistory(req, res) {
  const { telegramId } = req.query;
  if (!telegramId) return res.status(400).json({ success: false, message: 'Missing telegramId.' });

  try {
    const history = await historyService.getHistory(telegramId);
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getConfig,
  updateConfig,
  getHistory,
};
