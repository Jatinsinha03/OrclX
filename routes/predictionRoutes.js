/**
 * OrclX – Prediction Routes
 */

const { Router } = require('express');
const controller = require('../controllers/predictionController');

const router = Router();

router.post('/prediction/create', controller.createPrediction);
router.post('/prediction/bet', controller.placeBet);
router.post('/prediction/branch', controller.branchPrediction);
router.get('/predictions', controller.getPredictions);

module.exports = router;
