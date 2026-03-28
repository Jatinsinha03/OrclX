/**
 * OrclX – Configuration
 * Loads environment variables and exports config constants.
 */

const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  // Telegram
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,

  // Database
  DATABASE_URL: process.env.DATABASE_URL,

  // Blockchain – Monad Testnet
  RPC_URL: process.env.RPC_URL || 'https://testnet-rpc.monad.xyz',
  CHAIN_ID: parseInt(process.env.CHAIN_ID || '10143', 10),
  PRIVATE_KEY: process.env.PRIVATE_KEY,

  // Smart Contract
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,

  // Server
  PORT: parseInt(process.env.PORT || '3000', 10),
};
