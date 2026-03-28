/**
 * OrclX – AI Auto Trading Routes
 */

const { Router } = require('express');
const controller = require('../controllers/autoTradingController');

const router = Router();

router.get('/ai/auto/config', controller.getConfig);
router.post('/ai/auto/config', controller.updateConfig);
router.get('/ai/auto/history', controller.getHistory);

module.exports = router;
