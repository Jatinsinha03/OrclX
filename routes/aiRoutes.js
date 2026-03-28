/**
 * OrclX – AI Routes
 */

const { Router } = require('express');
const controller = require('../controllers/aiController');

const router = Router();

router.get('/ai/evaluate', controller.evaluateAll);
router.post('/ai/execute', controller.executeBets);

module.exports = router;
