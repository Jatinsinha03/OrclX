/**
 * OrclX – Telegram Bot
 * Primary user interface for the prediction market.
 * Uses inline keyboards and conversational state for multi-step flows.
 */

const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const predictionService = require('../services/predictionService');
const blockchain = require('../services/blockchainService');
const moltbookService = require('../services/moltbookService');
const aiService = require('../services/aiService');
const autoTradingService = require('../services/autoTradingService');
const historyService = require('../services/historyService');

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
      // Check Moltbook status
      const moltData = await moltbookService.getMoltbookApiKey(String(msg.from.id));
      const moltStatusText = moltData?.moltbookApiKey 
        ? (moltData.moltbookVerified ? '✅ Moltbook: Verified' : '⏳ Moltbook: Pending')
        : '❌ Moltbook: Not Connected';

      let moltButton;
      if (!moltData?.moltbookApiKey) {
        moltButton = { text: '🔗 Connect Moltbook', callback_data: 'moltbook_connect_help' };
      } else if (!moltData.moltbookVerified) {
        moltButton = { text: '✅ Verify Moltbook Agent', callback_data: 'moltbook_verify' };
      } else {
        moltButton = { text: '✅ Moltbook: Verified', callback_data: 'moltbook_status' };
      }

      await bot.sendMessage(chatId, `🔮 *Welcome to OrclX – Prediction Market*\n\nYour status:\n${moltStatusText}\n\nChoose an action:`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎲 Create Bet', callback_data: 'create_bet' }],
            [{ text: '💰 Place Bet', callback_data: 'place_bet' }],
            [{ text: '🔗 Chain Prediction', callback_data: 'chain_prediction' }],
            [{ text: '📋 View Predictions', callback_data: 'view_predictions' }],
            [{ text: '📂 My Bets', callback_data: 'my_bets' }],
            [{ text: '🔮 Gemini + Moltbook AI', callback_data: 'ai_prediction' }],
            [{ text: '🤖 Auto AI Trading', callback_data: 'ai_auto_config' }],
            [{ text: '📜 AI Bet History', callback_data: 'ai_history' }],
            [moltButton],
            [{ text: '🏆 Claim Winnings', callback_data: 'claim_winnings' }],
          ],
        },
      });
      console.log(`✅ [/start] menu sent to chat ${chatId}`);
    } catch (err) {
      console.error(`❌ [/start] Failed to send menu:`, err.message);
    }
  });

  bot.onText(/\/ai_history/, async (msg) => {
    await handleAIHistory(bot, msg.chat.id, msg.from.id);
  });

  // ─── /connect_moltbook Command ──────────────────────────────────
  bot.onText(/\/connect_moltbook\s+(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const agentName = match[1].trim();
    console.log(`📡 [/connect_moltbook] user ${msg.from.id} → "${agentName}"`);

    try {
      // Ensure user exists
      await predictionService.findOrCreateUser(String(msg.from.id));

      bot.sendMessage(chatId, `⏳ Registering agent "${agentName}" on Moltbook...`);

      const result = await moltbookService.registerAgent(agentName, `OrclX prediction agent: ${agentName}`);

      // Store credentials
      await moltbookService.saveMoltbookCredentials(String(msg.from.id), result.api_key, result.claim_url);

      // Escape HTML for claim_url if it contains & or other sensitive chars
      const escapedUrl = result.claim_url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      bot.sendMessage(
        chatId,
        `✅ <b>Agent Registered on Moltbook!</b>\n\n` +
          `🤖 Name: ${agentName}\n\n` +
          `🔗 <b>To verify:</b>\n1. Tap the 🐦 button below to tweet your verification link.\n` +
          `2. Once tweeted, tap the ✅ button to confirm.\n\n` +
          `Or manually tweet this link:\n<code>${escapedUrl}</code>`,
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🐦 Tweet on X', url: result.claim_url }],
              [{ text: '✅ Verify My Tweet', callback_data: 'moltbook_verify' }]
            ]
          }
        }
      );
    } catch (err) {
      console.error(`❌ [/connect_moltbook] Error:`, err.message);
      const errorMsg = err.response?.data?.message || err.message;
      bot.sendMessage(chatId, `❌ Registration failed:\n\`${errorMsg}\``, {
        parse_mode: 'Markdown',
      });
    }
  });

  bot.onText(/\/verify\_moltbook/, async (msg) => {
    executeVerification(bot, msg.chat.id, msg.from.id);
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

      // ── Moltbook ──
      case 'moltbook_status':
        await handleMoltbookStatus(bot, chatId, query.from.id);
        break;

      case 'moltbook_verify':
        await executeVerification(bot, chatId, query.from.id);
        break;

      // ── AI Prediction ──
      case 'ai_prediction':
        await handleAIPrediction(bot, chatId);
        break;

      case 'ai_confirm':
        await handleAIConfirm(bot, chatId, query.from.id);
        break;

      case 'ai_cancel':
        await handleAICancel(bot, chatId);
        break;

      // ── Auto AI Trading ──
      case 'ai_auto_config':
        await handleAutoConfig(bot, chatId, query.from.id);
        break;

      case 'ai_auto_enable':
        await handleAutoToggle(bot, chatId, query.from.id, true);
        break;

      case 'ai_auto_disable':
        await handleAutoToggle(bot, chatId, query.from.id, false);
        break;

      case 'ai_history':
        await handleAIHistory(bot, chatId, query.from.id);
        break;

      case 'moltbook_connect_help':
        await bot.sendMessage(chatId, 'To connect your Moltbook agent, use the command:\n\n`/connect_moltbook <your_agent_name>`', {
          parse_mode: 'Markdown'
        });
        break;

      default:
        // Handle dynamic callbacks: resolve_<id> / settle_<id> / news_<id>
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
        } else if (data && data.startsWith('news_')) {
          const onchainId = parseInt(data.split('_')[1], 10);
          if (!isNaN(onchainId)) {
            await handleRelatedNews(bot, chatId, onchainId, query.from.id);
          }
        } else if (data && data.startsWith('ai_auto_freq_')) {
          const hours = parseInt(data.split('_')[3], 10);
          await handleAutoFreq(bot, chatId, query.from.id, hours);
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
                [
                  { text: '📰 Related News', callback_data: `news_${id}` },
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

// ─── Related News (Moltbook) ────────────────────────────────────────

async function handleRelatedNews(bot, chatId, onchainId, telegramUserId) {
  console.log(`📰 [news] fetching for prediction #${onchainId} by user ${telegramUserId}`);

  try {
    // Check if user has Moltbook connected
    const moltData = await moltbookService.getMoltbookApiKey(String(telegramUserId));

    if (!moltData || !moltData.moltbookApiKey) {
      bot.sendMessage(
        chatId,
        '❌ *Moltbook Not Connected*\n\n' +
          'To see related news, connect your Moltbook agent first:\n' +
          '`/connect_moltbook <agent_name>`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Get prediction question from chain
    const prediction = await blockchain.getPrediction(onchainId);
    const question = prediction.question;

    // Extract keywords
    const keywords = moltbookService.extractKeywords(question);
    console.log(`📰 [news] Keywords from "${question}": [${keywords.join(', ')}]`);

    if (keywords.length === 0) {
      bot.sendMessage(chatId, '⚠️ Could not extract keywords from this prediction.');
      return;
    }

    bot.sendMessage(chatId, `🔍 Searching Moltbook for: _${keywords.join(', ')}_...`, {
      parse_mode: 'Markdown',
    });

    // Fetch filtered news
    const posts = await moltbookService.fetchNewsByKeywords(moltData.moltbookApiKey, keywords);

    if (posts.length === 0) {
      bot.sendMessage(
        chatId,
        `📭 No related news found for prediction #${onchainId}.\n\n` +
          `Keywords searched: _${keywords.join(', ')}_`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Format and send posts
    let message = `📰 *Related News for Prediction #${onchainId}*\n`;
    message += `🔑 Keywords: _${keywords.join(', ')}_\n\n`;

    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      message +=
        `*${i + 1}.* ${p.content}\n` +
        `   👤 ${p.author} | 📁 ${p.submolt} | ⬆️ ${p.karma}\n\n`;
    }

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(`❌ [news] Error:`, err.message);
    const errorMsg = err.response?.data?.message || err.message;
    bot.sendMessage(chatId, `❌ Failed to fetch news:\n\`${errorMsg}\``, {
      parse_mode: 'Markdown',
    });
  }
}

async function handleMoltbookStatus(bot, chatId, telegramUserId) {
  console.log(`📡 [moltbook_status] user ${telegramUserId}`);

  try {
    const moltData = await moltbookService.getMoltbookApiKey(String(telegramUserId));

    if (!moltData || !moltData.moltbookApiKey) {
      bot.sendMessage(chatId, '❌ Your Moltbook agent is <b>not connected</b>.\n\nUse <code>/connect_moltbook &lt;agent_name&gt;</code> to connect.', { parse_mode: 'HTML' });
      return;
    }

    let message = `📊 <b>Moltbook Connection Status</b>\n\n`;
    message += `✅ <b>Connected</b>\n`;
    message += `📝 <b>Status:</b> ${moltData.moltbookVerified ? 'Verified' : 'Pending Verification'}\n\n`;

    if (!moltData.moltbookVerified) {
      message += `To verify, ensure you have tweeted the claim link and then tap the button below or call /verify_moltbook.`;
    } else {
      message += `Your agent is active and fetching news!`;
    }

    const opts = { parse_mode: 'HTML' };
    if (!moltData.moltbookVerified) {
      opts.reply_markup = {
        inline_keyboard: [[{ text: '✅ Verify Now', callback_data: 'moltbook_verify' }]]
      };
    }

    bot.sendMessage(chatId, message, opts);
  } catch (err) {
    console.error(`❌ [moltbook_status] Error:`, err.message);
    bot.sendMessage(chatId, `❌ Failed to fetch Moltbook status:\n<code>${err.message}</code>`, { parse_mode: 'HTML' });
  }
}

async function executeVerification(bot, chatId, telegramUserId) {
  console.log(`📡 [executeVerification] user ${telegramUserId}`);

  try {
    const moltData = await moltbookService.getMoltbookApiKey(String(telegramUserId));

    if (!moltData || !moltData.moltbookApiKey) {
      bot.sendMessage(chatId, '❌ You haven\'t connected to Moltbook yet.\n\nUse `/connect_moltbook <agent_name>` first.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    if (moltData.moltbookVerified) {
      bot.sendMessage(chatId, '✅ Your Moltbook agent is already verified!');
      return;
    }

    bot.sendMessage(chatId, '⏳ Checking verification status...');

    const status = await moltbookService.checkVerification(moltData.moltbookApiKey);

    if (status.verified) {
      await moltbookService.markVerified(String(telegramUserId));
      bot.sendMessage(
        chatId,
        `✅ <b>Moltbook Agent Verified!</b>\n\n` +
          (status.profileUrl ? `🔗 Profile: ${status.profileUrl}` : 'Your agent is now active on Moltbook.'),
        { parse_mode: 'HTML' }
      );
    } else {
      const escapedUrl = moltData.moltbookClaimUrl?.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || 'No link found';
      
      bot.sendMessage(
        chatId,
        `⏳ <b>Verification still pending</b>\n\n` +
        `Make sure you have tweeted the link. If you haven't, tap the 🐦 button below:\n\n` +
        `<code>${escapedUrl}</code>`,
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🐦 Tweet on X', url: moltData.moltbookClaimUrl || 'https://x.com' }],
              [{ text: '✅ Verify My Tweet', callback_data: 'moltbook_verify' }]
            ]
          }
        }
      );
    }
  } catch (err) {
    console.error(`❌ [executeVerification] Error:`, err.message);
    bot.sendMessage(chatId, `❌ Verification check failed:\n<code>${err.message}</code>`, {
      parse_mode: 'HTML',
    });
  }
}

async function handleAIPrediction(bot, chatId) {
  console.log(`🤖 [AI] starting evaluation for chat ${chatId}`);
  bot.sendMessage(chatId, '🤖 <b>OrclX AI is analyzing the market...</b>\n\nFetching top predictions and performing web research via Gemini.', { parse_mode: 'HTML' });

  try {
    const list = await predictionService.getAllPredictions();
    const top5 = list.slice(0, 5);

    if (top5.length === 0) {
      bot.sendMessage(chatId, '⚠️ No predictions available for AI analysis.');
      return;
    }

    const evaluations = await aiService.evaluatePredictions(top5, String(chatId));
    
    // Store in userState for confirm flow
    userState[chatId] = { flow: 'ai_confirm', evaluations };

    let message = `🚀 <b>AI Prediction Report</b>\n\n`;
    
    for (const ev of evaluations) {
      const pred = top5.find(p => p.onchainId === ev.id);
      const question = pred ? pred.question : `Prediction #${ev.id}`;
      
      message += `📌 <b>${question}</b>\n`;
      message += `➡️ AI Decision: <b>${ev.decision} (${Math.round(ev.confidence * 100)}%)</b>\n`;
      message += `💡 Reason: <i>${ev.reason}</i>\n\n`;
    }

    message += `<b>Do you want to place these bets?</b>\n`;
    message += `(Uses fixed stake of 0.01 MON per prediction)`;

    bot.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Confirm Bets', callback_data: 'ai_confirm' }],
          [{ text: '❌ Cancel', callback_data: 'ai_cancel' }]
        ]
      }
    });

  } catch (err) {
    console.error(`❌ [AI] Error:`, err.message);
    bot.sendMessage(chatId, `❌ AI Prediction failed:\n<code>${err.message}</code>`, { parse_mode: 'HTML' });
  }
}

async function handleAIConfirm(bot, chatId, telegramUserId) {
  const state = userState[chatId];
  if (!state || state.flow !== 'ai_confirm') {
    bot.sendMessage(chatId, '❌ No active AI session found.');
    return;
  }

  bot.sendMessage(chatId, `⏳ <b>Processing ${state.evaluations.length} AI bets...</b>`, { parse_mode: 'HTML' });

  try {
    const results = [];
    for (const ev of state.evaluations) {
      const isYes = ev.decision.toUpperCase() === 'YES';
      const res = await predictionService.placeBet(ev.id, isYes, String(telegramUserId));
      results.push({ id: ev.id, txHash: res.txHash });
    }

    let successMsg = `✅ <b>AI Bets Executed Successfully!</b>\n\n`;
    for (const r of results) {
      successMsg += `🔹 Prediction #${r.id}: <code small>${r.txHash.substring(0, 10)}...</code>\n`;
    }

    bot.sendMessage(chatId, successMsg, { parse_mode: 'HTML' });
    clearState(chatId);

  } catch (err) {
    console.error(`❌ [AI Confirm] Error:`, err.message);
    bot.sendMessage(chatId, `❌ AI Execution failed:\n<code>${err.message}</code>`, { parse_mode: 'HTML' });
  }
}

async function handleAICancel(bot, chatId) {
  clearState(chatId);
  bot.sendMessage(chatId, '🚫 <b>AI betting cancelled.</b>', { parse_mode: 'HTML' });
}

async function handleAutoConfig(bot, chatId, telegramUserId) {
  try {
    const settings = await autoTradingService.getSettings(telegramUserId);
    const statusText = settings.enabled ? '✅ Enabled' : '❌ Disabled';
    
    let msg = `🤖 <b>Auto AI Trading Configuration</b>\n\n`;
    msg += `Status: <b>${statusText}</b>\n`;
    msg += `Frequency: <b>Every ${settings.intervalHours} hours</b>\n\n`;
    msg += `Select execution frequency below:`;

    bot.sendMessage(chatId, msg, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '2 Hours', callback_data: 'ai_auto_freq_2' },
            { text: '4 Hours', callback_data: 'ai_auto_freq_4' }
          ],
          [
            { text: '6 Hours', callback_data: 'ai_auto_freq_6' },
            { text: '8 Hours', callback_data: 'ai_auto_freq_8' }
          ],
          [
            settings.enabled 
              ? { text: '❌ Disable Auto Trading', callback_data: 'ai_auto_disable' }
              : { text: '✅ Enable Auto Trading', callback_data: 'ai_auto_enable' }
          ],
          [{ text: '📜 View AI History', callback_data: 'ai_history' }]
        ]
      }
    });
  } catch (err) {
    console.error(`❌ [AutoConfig] Error:`, err.message);
    bot.sendMessage(chatId, `❌ Failed to load auto-trading config: ${err.message}`);
  }
}

async function handleAutoFreq(bot, chatId, telegramUserId, hours) {
  try {
    await autoTradingService.updateSettings(telegramUserId, { intervalHours: hours });
    bot.answerCallbackQuery(userState.lastCallbackQueryId, { text: `✅ Frequency set to ${hours} hours` });
    // Refresh config menu
    await handleAutoConfig(bot, chatId, telegramUserId);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Failed to update frequency: ${err.message}`);
  }
}

async function handleAutoToggle(bot, chatId, telegramUserId, enabled) {
  try {
    await autoTradingService.updateSettings(telegramUserId, { enabled });
    const action = enabled ? 'enabled' : 'disabled';
    bot.answerCallbackQuery(userState.lastCallbackQueryId, { text: `✅ Auto-trading ${action}` });
    // Refresh config menu
    await handleAutoConfig(bot, chatId, telegramUserId);
  } catch (err) {
    bot.sendMessage(chatId, `❌ Failed to toggle auto-trading: ${err.message}`);
  }
}

async function handleAIHistory(bot, chatId, telegramUserId) {
  try {
    const history = await historyService.getHistory(telegramUserId);
    
    if (history.length === 0) {
      bot.sendMessage(chatId, '📜 <b>No AI betting history found.</b>', { parse_mode: 'HTML' });
      return;
    }

    let msg = `📜 <b>AI Bet History (Last ${history.length})</b>\n\n`;
    
    history.forEach((h, i) => {
      const date = new Date(h.createdAt).toLocaleString();
      msg += `${i + 1}. <b>Prediction #${h.predictionId}</b>\n`;
      msg += `➡️ Decision: <b>${h.decision}</b>\n`;
      msg += `💰 Amount: 0.01 MON\n`;
      msg += `⏰ Time: ${date}\n`;
      msg += `🔗 Tx: <code small>${h.txHash.substring(0, 10)}...</code>\n\n`;
    });

    bot.sendMessage(chatId, msg, { parse_mode: 'HTML' });
  } catch (err) {
    console.error(`❌ [AI History] Error:`, err.message);
    bot.sendMessage(chatId, `❌ Failed to fetch AI history: ${err.message}`);
  }
}

module.exports = { initBot };
