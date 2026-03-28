/**
 * OrclX – OpenClaw Agent
 * Runs inside a Docker container for user-specific autonomous trading.
 */

const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Env Vars
const userId = process.env.USER_ID;
const sessionKey = process.env.SESSION_KEY;
const backendUrl = process.env.BACKEND_URL || 'http://host.docker.internal:3000';
const geminiApiKey = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(geminiApiKey);

/**
 * The core agent decision loop.
 */
async function processTask(task) {
  const id = task.onchainId || task.onChainId || 'Unknown';
  console.log(`🧠 [Agent ${userId}] Received Task:`, JSON.stringify(task));
  console.log(`🧠 [Agent ${userId}] Processing Task for Market #${id}...`);

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    // Construct Prompt
    const prompt = `
      You are an autonomous AI trading agent for the OrclX prediction market on the Monad network.
      
      MARKET QUESTION: "${task.question}"
      REAL-WORLD CONTEXT: "${task.context || 'Search trending news for this topic.'}"
      
      Your goal is to maximize profit. Based on this news, should the user bet YES, NO, or SKIP?
      Only bet if you have high confidence (>70%).
      
      Respond in JSON:
      {
        "decision": "YES" | "NO" | "SKIP",
        "confidence": number (0-1),
        "reasoning": "Brief explanation"
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Extract JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid AI response');
    const decisionData = JSON.parse(jsonMatch[0]);

    console.log(`🤖 [Agent ${userId}] Decision: ${decisionData.decision} (${(decisionData.confidence * 100).toFixed(0)}%)`);

    // Callback to Backend
    console.log(`📡 [Agent ${userId}] Decision: ${decisionData.decision}. Submitting to OrclX relayer...`);
    await sendDecisionToBackend(id, decisionData);

  } catch (err) {
    console.error(`❌ [Agent ${userId}] Task failed:`, err.message);
  }
}

/**
 * Sends the final decision to the backend webhook.
 */
async function sendDecisionToBackend(onchainId, decisionData) {
  const baseUrl = (backendUrl || 'http://host.docker.internal:3000').trim().replace(/\/$/, '');
  const targetUrl = `${baseUrl}/webhooks/agent/agent-decision`;
  
  console.log(`📡 [Agent ${userId}] Posting to: ${targetUrl}`);

  try {
    await axios.post(targetUrl, {
      userId,
      sessionKey,
      onchainId,
      ...decisionData
    });
    console.log(`📡 [Agent ${userId}] Decision successfully synced with backend.`);
  } catch (err) {
    if (err.response) {
      console.error(`❌ [Agent ${userId}] Webhook 404/Error:`, err.response.status, err.response.data);
    } else {
      console.error(`❌ [Agent ${userId}] Webhook failed:`, err.message);
    }
  }
}

// CLI Task Handling
if (process.argv.includes('--task')) {
  const taskIdx = process.argv.indexOf('--task') + 1;
  try {
    const task = JSON.parse(process.argv[taskIdx]);
    processTask(task);
  } catch (e) {
    console.error('❌ [Agent] Failed to parse task CLI:', e.message);
  }
} else {
  console.log(`🦾 [Agent ${userId}] OpenClaw agent initialized and waiting for tasks...`);
  // Keep alive
  setInterval(() => {}, 1000 * 60);
}
