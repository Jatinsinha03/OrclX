/**
 * OrclX – Entry Point
 * Initializes Express server and Telegram bot.
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const config = require('./config');
const predictionRoutes = require('./routes/predictionRoutes');
const aiRoutes = require('./routes/aiRoutes');
const aiAutoRoutes = require('./routes/aiAutoRoutes');
const agentRoutes = require('./routes/agentRoutes');
const { initBot } = require('./bot');
const { initScheduler } = require('./services/schedulerService');

const app = express();

// ─── Middleware ──────────────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());

// ─── Health Check ───────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'OrclX – Prediction Market',
    status: 'running',
    chain: 'Monad Testnet',
    chainId: config.CHAIN_ID,
  });
});

// ─── API Routes ─────────────────────────────────────────────────────
app.use('/', predictionRoutes);
app.use('/', aiRoutes);
app.use('/webhooks/agent', agentRoutes);

// ─── Start Server & Bot ─────────────────────────────────────────────
app.listen(config.PORT, () => {
  console.log(`🚀 OrclX server running on port ${config.PORT}`);
  console.log(`⛓️  Chain: Monad Testnet (${config.CHAIN_ID})`);
  console.log(`📄 Contract: ${config.CONTRACT_ADDRESS}`);

  // Start Telegram bot
  initBot();

  // Initialize Auto-Trading Scheduler
  initScheduler();
});
