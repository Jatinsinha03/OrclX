/**
 * OrclX – Telegram Bot
 * Primary user interface for the prediction market.
 * Uses inline keyboards and conversational state for multi-step flows.
 */

const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const predictionService = require('../services/predictionService');
const blockchain = require('../services/blockchainService');

// ─── State management for multi-step flows ──────────────────────────
// Keyed by chatId, stores the current flow and step data
const userState = {};

function clearState(chatId) {
  delete userState[chatId];
}

// ─── Bot Initialization ─────────────────────────────────────────────

function initBot() {
  const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });

  console.log('🤖 Telegram bot started (polling)');

  // ─── Polling error handler ──────────────────────────────────────
  bot.on('polling_error', (err) => {
    console.error('❌ [Bot Polling Error]', err.code, err.message);
  });

  bot.on('error', (err) => {
    console.error('❌ [Bot Error]', err.message);
  });

  // ─── /start Command ─────────────────────────────────────────────
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`📩 [/start] from user ${msg.from.id} in chat ${chatId}`);
    clearState(chatId);

    try {
      await bot.sendMessage(chatId, '🔮 *Welcome to OrclX – Prediction Market*\n\nChoose an action:', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎲 Create Bet', callback_data: 'create_bet' }],
            [{ text: '💰 Place Bet', callback_data: 'place_bet' }],
            [{ text: '🔗 Chain Prediction', callback_data: 'chain_prediction' }],
            [{ text: '📋 View Predictions', callback_data: 'view_predictions' }],
            [{ text: '📂 My Bets', callback_data: 'my_bets' }],
            [{ text: '🏆 Claim Winnings', callback_data: 'claim_winnings' }],
          ],
        },
      });
      console.log(`✅ [/start] menu sent to chat ${chatId}`);
    } catch (err) {
      console.error(`❌ [/start] Failed to send menu:`, err.message);
    }
  });

  // ─── Callback Query Handler ─────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    console.log(`📩 [callback] "${data}" from user ${query.from.id} in chat ${chatId}`);

    bot.answerCallbackQuery(query.id);

    switch (data) {
      // ── Create Bet Flow ──
      case 'create_bet':
        userState[chatId] = { flow: 'create_bet', step: 'question' };
        bot.sendMessage(chatId, '📝 *Create a New Prediction*\n\nEnter the prediction question:', {
          parse_mode: 'Markdown',
        });
        break;

      // ── Place Bet Flow ──
      case 'place_bet':
        userState[chatId] = { flow: 'place_bet', step: 'id' };
        bot.sendMessage(chatId, '💰 *Place a Bet*\n\nEnter the prediction ID (on-chain):', {
          parse_mode: 'Markdown',
        });
        break;

      // ── Chain Prediction Flow ──
      case 'chain_prediction':
        userState[chatId] = { flow: 'chain_prediction', step: 'from_id' };
        bot.sendMessage(chatId, '🔗 *Chain Prediction*\n\nEnter the source prediction ID:', {
          parse_mode: 'Markdown',
        });
        break;

      // ── View Predictions ──
      case 'view_predictions':
        await handleViewPredictions(bot, chatId);
        break;

      // ── Claim Winnings Flow ──
      case 'claim_winnings':
        userState[chatId] = { flow: 'claim', step: 'id' };
        bot.sendMessage(chatId, '🏆 *Claim Winnings*\n\nEnter the prediction ID to claim:', {
          parse_mode: 'Markdown',
        });
        break;

      // ── Bet YES/NO callbacks ──
      case 'bet_yes':
      case 'bet_no':
        await handleBetChoice(bot, chatId, data === 'bet_yes', query.from.id);
        break;

      // ── Chain YES/NO callbacks ──
      case 'chain_yes':
      case 'chain_no':
        await handleChainChoice(bot, chatId, data === 'chain_yes');
        break;

      // ── My Bets ──
      case 'my_bets':
        await handleMyBets(bot, chatId, query.from.id);
        break;

      default:
        // Handle dynamic resolve/settle callbacks: resolve_<id> / settle_<id>
        if (data && data.startsWith('resolve_')) {
          const onchainId = parseInt(data.split('_')[1], 10);
          if (!isNaN(onchainId)) {
            await handleResolve(bot, chatId, onchainId, query.from.id);
          }
        } else if (data && data.startsWith('settle_')) {
          const onchainId = parseInt(data.split('_')[1], 10);
          if (!isNaN(onchainId)) {
            await handleSettle(bot, chatId, onchainId, query.from.id);
          }
        }
        break;
    }
  });

  // ─── Message Handler (conversational flows) ─────────────────────
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Ignore commands
    if (!text || text.startsWith('/')) return;

    const state = userState[chatId];
    if (!state) {
      console.log(`📩 [message] "${text}" from user ${msg.from.id} — no active flow, ignoring`);
      return;
    }
    console.log(`📩 [message] "${text}" from user ${msg.from.id} — flow: ${state.flow}, step: ${state.step}`);

    switch (state.flow) {
      case 'create_bet':
        await handleCreateBetFlow(bot, chatId, text, msg.from.id);
        break;
      case 'place_bet':
        await handlePlaceBetFlow(bot, chatId, text, msg.from.id);
        break;
      case 'chain_prediction':
        await handleChainPredictionFlow(bot, chatId, text, msg.from.id);
        break;
      case 'claim':
        await handleClaimFlow(bot, chatId, text, msg.from.id);
        break;
      default:
        break;
    }
  });

  return bot;
}

// ─── Flow Handlers ──────────────────────────────────────────────────

async function handleCreateBetFlow(bot, chatId, text, telegramUserId) {
  const state = userState[chatId];

  switch (state.step) {
    case 'question':
      state.question = text;
      state.step = 'stake';
      bot.sendMessage(chatId, '💎 Enter the stake amount (in MON, e.g., `0.01`):', {
        parse_mode: 'Markdown',
      });
      break;

    case 'stake':
      const stakeNum = parseFloat(text);
      if (isNaN(stakeNum) || stakeNum <= 0) {
        bot.sendMessage(chatId, '❌ Invalid stake. Please enter a positive number:');
        return;
      }
      const { ethers } = require('ethers');
      state.stakeWei = ethers.parseEther(text).toString();
      state.step = 'tags';
      bot.sendMessage(chatId, '🏷️ Enter tags (comma-separated, or type `none`):', {
        parse_mode: 'Markdown',
      });
      break;

    case 'tags':
      const tags = text.toLowerCase() === 'none'
        ? []
        : text.split(',').map((t) => t.trim()).filter(Boolean);

      bot.sendMessage(chatId, '⏳ Creating prediction on-chain...');

      try {
        const result = await predictionService.createPrediction(
          state.question,
          state.stakeWei,
          tags,
          String(telegramUserId)
        );

        bot.sendMessage(
          chatId,
          `✅ *Prediction Created!*\n\n` +
            `📌 On-chain ID: \`${result.onchainId}\`\n` +
            `❓ Question: ${state.question}\n` +
            `💎 Stake: ${text} MON\n` +
            `🔗 Tx: \`${result.txHash}\``,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        bot.sendMessage(chatId, `❌ Failed to create prediction:\n\`${err.message}\``, {
          parse_mode: 'Markdown',
        });
      }

      clearState(chatId);
      break;
  }
}

async function handlePlaceBetFlow(bot, chatId, text, telegramUserId) {
  const state = userState[chatId];

  switch (state.step) {
    case 'id':
      const id = parseInt(text, 10);
      if (isNaN(id) || id <= 0) {
        bot.sendMessage(chatId, '❌ Invalid ID. Enter a positive integer:');
        return;
      }

      // Show prediction info
      try {
        const p = await blockchain.getPrediction(id);
        state.predictionId = id;
        state.step = 'choice';

        bot.sendMessage(
          chatId,
          `📊 *Prediction #${id}*\n\n` +
            `❓ ${p.question}\n` +
            `💎 Stake: ${require('ethers').formatEther(p.stake)} MON\n` +
            `👍 Total YES: ${require('ethers').formatEther(p.totalYes)} MON\n` +
            `👎 Total NO: ${require('ethers').formatEther(p.totalNo)} MON\n\n` +
            `Choose your side:`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '👍 YES', callback_data: 'bet_yes' },
                  { text: '👎 NO', callback_data: 'bet_no' },
                ],
              ],
            },
          }
        );
      } catch (err) {
        bot.sendMessage(chatId, `❌ Could not fetch prediction #${id}:\n\`${err.message}\``, {
          parse_mode: 'Markdown',
        });
        clearState(chatId);
      }
      break;
  }
}

async function handleBetChoice(bot, chatId, isYes, telegramUserId) {
  const state = userState[chatId];
  if (!state || state.flow !== 'place_bet') return;

  bot.sendMessage(chatId, `⏳ Placing ${isYes ? 'YES' : 'NO'} bet on prediction #${state.predictionId}...`);

  try {
    const result = await predictionService.placeBet(
      state.predictionId,
      isYes,
      String(telegramUserId)
    );

    bot.sendMessage(
      chatId,
      `✅ *Bet Placed!*\n\n` +
        `📌 Prediction #${state.predictionId}\n` +
        `🎯 Side: ${isYes ? 'YES' : 'NO'}\n` +
        `🔗 Tx: \`${result.txHash}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(chatId, `❌ Bet failed:\n\`${err.message}\``, {
      parse_mode: 'Markdown',
    });
  }

  clearState(chatId);
}

async function handleChainPredictionFlow(bot, chatId, text) {
  const state = userState[chatId];

  switch (state.step) {
    case 'from_id':
      const fromId = parseInt(text, 10);
      if (isNaN(fromId) || fromId <= 0) {
        bot.sendMessage(chatId, '❌ Invalid ID. Enter a positive integer:');
        return;
      }
      state.fromId = fromId;
      state.step = 'to_id';
      bot.sendMessage(chatId, '🎯 Enter the target prediction ID:');
      break;

    case 'to_id':
      const toId = parseInt(text, 10);
      if (isNaN(toId) || toId <= 0) {
        bot.sendMessage(chatId, '❌ Invalid ID. Enter a positive integer:');
        return;
      }
      state.toId = toId;
      state.step = 'direction';
      bot.sendMessage(chatId, '🔮 Bet YES or NO on the target?', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '👍 YES', callback_data: 'chain_yes' },
              { text: '👎 NO', callback_data: 'chain_no' },
            ],
          ],
        },
      });
      break;

    case 'amount':
      const { ethers } = require('ethers');
      const amtNum = parseFloat(text);
      if (isNaN(amtNum) || amtNum <= 0) {
        bot.sendMessage(chatId, '❌ Invalid amount. Enter a positive number:');
        return;
      }
      state.amountWei = ethers.parseEther(text).toString();
      state.step = 'execute';

      bot.sendMessage(chatId, '⏳ Chaining prediction on-chain...');

      try {
        const result = await predictionService.branchPrediction(
          state.fromId,
          state.toId,
          state.yesOnTarget,
          state.amountWei,
          String(chatId) // use chatId as fallback telegramId
        );

        bot.sendMessage(
          chatId,
          `✅ *Prediction Chained!*\n\n` +
            `📌 From #${state.fromId} → To #${state.toId}\n` +
            `🎯 Side: ${state.yesOnTarget ? 'YES' : 'NO'}\n` +
            `💎 Amount: ${text} MON\n` +
            `🔗 Tx: \`${result.txHash}\``,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        bot.sendMessage(chatId, `❌ Chain failed:\n\`${err.message}\``, {
          parse_mode: 'Markdown',
        });
      }

      clearState(chatId);
      break;
  }
}

async function handleChainChoice(bot, chatId, yesOnTarget) {
  const state = userState[chatId];
  if (!state || state.flow !== 'chain_prediction') return;

  state.yesOnTarget = yesOnTarget;
  state.step = 'amount';
  bot.sendMessage(chatId, '💎 Enter the amount to chain (in MON, e.g., `0.005`):', {
    parse_mode: 'Markdown',
  });
}

async function handleClaimFlow(bot, chatId, text, telegramUserId) {
  const state = userState[chatId];

  const id = parseInt(text, 10);
  if (isNaN(id) || id <= 0) {
    bot.sendMessage(chatId, '❌ Invalid ID. Enter a positive integer:');
    return;
  }

  bot.sendMessage(chatId, `⏳ Claiming winnings for prediction #${id}...`);

  try {
    const result = await predictionService.claimWinnings(id, String(telegramUserId));

    bot.sendMessage(
      chatId,
      `✅ *Winnings Claimed!*\n\n` +
        `📌 Prediction #${id}\n` +
        `🔗 Tx: \`${result.txHash}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(chatId, `❌ Claim failed:\n\`${err.message}\``, {
      parse_mode: 'Markdown',
    });
  }

  clearState(chatId);
}

async function handleViewPredictions(bot, chatId) {
  try {
    const predictions = await predictionService.getAllPredictions();

    if (predictions.length === 0) {
      bot.sendMessage(chatId, '📭 No predictions yet. Create one with /start!');
      return;
    }

    const { formatEther } = require('ethers');

    let message = '📋 *Active Predictions*\n\n';
    for (const p of predictions.slice(0, 10)) {
      const status = p.resolved ? (p.result === 'Yes' ? '✅ YES' : '❌ NO') : '⏳ Pending';
      message +=
        `*#${p.onchainId || '?'}* – ${p.question}\n` +
        `   💎 Stake: ${formatEther(p.stake)} MON | Status: ${status}\n` +
        `   👍 YES: ${formatEther(p.bets.filter((b) => b.isYes).reduce((s, b) => s + BigInt(b.amount), 0n).toString())} | ` +
        `👎 NO: ${formatEther(p.bets.filter((b) => !b.isYes).reduce((s, b) => s + BigInt(b.amount), 0n).toString())}\n\n`;
    }

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `❌ Failed to load predictions:\n\`${err.message}\``, {
      parse_mode: 'Markdown',
    });
  }
}

// ─── My Bets ────────────────────────────────────────────────────────

async function handleMyBets(bot, chatId, telegramUserId) {
  console.log(`📂 [my_bets] user ${telegramUserId} in chat ${chatId}`);

  try {
    const predictions = await predictionService.getMyPredictions(String(telegramUserId));

    if (predictions.length === 0) {
      bot.sendMessage(chatId, '📭 You haven\'t created any predictions yet.\n\nUse /start → Create Bet to get started!');
      return;
    }

    const { formatEther } = require('ethers');

    for (const p of predictions.slice(0, 10)) {
      const status = p.resolved ? (p.result === 'Yes' ? '✅ YES' : '❌ NO') : '⏳ Pending';
      const totalBets = p.bets.length;

      let text =
        `📌 *Prediction #${p.onchainId || '?'}*\n` +
        `❓ ${p.question}\n` +
        `💎 Stake: ${formatEther(p.stake)} MON\n` +
        `🎯 Status: ${status}\n` +
        `👥 Total Bets: ${totalBets}`;

      const buttons = [];

      // Show Resolve button only for unresolved predictions
      if (!p.resolved && p.onchainId) {
        buttons.push([
          { text: '⚖️ Request Resolution', callback_data: `resolve_${p.onchainId}` },
        ]);
        buttons.push([
          { text: '✅ Settle Resolution', callback_data: `settle_${p.onchainId}` },
        ]);
      }

      const opts = { parse_mode: 'Markdown' };
      if (buttons.length > 0) {
        opts.reply_markup = { inline_keyboard: buttons };
      }

      bot.sendMessage(chatId, text, opts);
    }
  } catch (err) {
    console.error(`❌ [my_bets] Error:`, err.message);
    bot.sendMessage(chatId, `❌ Failed to load your bets:\n\`${err.message}\``, {
      parse_mode: 'Markdown',
    });
  }
}

// ─── Resolve Prediction ─────────────────────────────────────────────

async function handleResolve(bot, chatId, onchainId, telegramUserId) {
  console.log(`⚖️ [resolve] request for prediction #${onchainId} by user ${telegramUserId}`);

  bot.sendMessage(chatId, `⏳ Requesting resolution for prediction #${onchainId} on-chain...`);

  try {
    const result = await predictionService.requestResolution(onchainId, String(telegramUserId));

    bot.sendMessage(
      chatId,
      `✅ *Resolution Requested!*\n\n` +
        `📌 Prediction #${onchainId}\n` +
        `🔗 Tx: \`${result.txHash}\`\n\n` +
        `_The oracle will now evaluate this prediction. Once ready, use "Settle Resolution" to finalize._`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error(`❌ [resolve] Error:`, err.message);
    bot.sendMessage(chatId, `❌ Resolution request failed:\n\`${err.message}\``, {
      parse_mode: 'Markdown',
    });
  }
}

async function handleSettle(bot, chatId, onchainId, telegramUserId) {
  console.log(`✅ [settle] settling prediction #${onchainId} by user ${telegramUserId}`);

  bot.sendMessage(chatId, `⏳ Settling resolution for prediction #${onchainId}...`);

  try {
    const result = await predictionService.settleResolution(onchainId, String(telegramUserId));

    bot.sendMessage(
      chatId,
      `✅ *Prediction Resolved!*\n\n` +
        `📌 Prediction #${onchainId}\n` +
        `🎯 Result: *${result.result}*\n` +
        `🔗 Tx: \`${result.txHash}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error(`❌ [settle] Error:`, err.message);
    bot.sendMessage(chatId, `❌ Settlement failed:\n\`${err.message}\``, {
      parse_mode: 'Markdown',
    });
  }
}

module.exports = { initBot };

