/**
 * OrclX – AI Service (Gemini)
 * Integrates Google Gemini with both Web Search and Moltbook API context.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const moltbookService = require('./moltbookService');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

/**
 * Evaluates a list of predictions using Gemini with web search and Moltbook context.
 * @param {Array<object>} predictions - Array of prediction objects from DB
 * @param {string} [telegramId] - Optional Telegram user ID to fetch user-specific Moltbook news
 * @param {boolean} [useMoltbook=false] - Whether to fetch and use Moltbook context
 * @returns {Promise<Array<object>>} Decisions with reasoning
 */
async function evaluatePredictions(predictions, telegramId, useMoltbook = false) {
  if (!config.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured.');
  }

  const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.5-flash',
    tools: [{ googleSearch: {} }] // Enable Google Search
  });

  // Fetch Moltbook context if requested and possible
  const contextMap = {};
  if (useMoltbook && telegramId) {
    try {
      const moltData = await moltbookService.getMoltbookApiKey(telegramId);
      if (moltData?.moltbookApiKey) {
        for (const p of predictions) {
          const keywords = moltbookService.extractKeywords(p.question);
          const news = await moltbookService.fetchNewsByKeywords(moltData.moltbookApiKey, keywords);
          contextMap[p.onchainId] = news;
        }
      }
    } catch (err) {
      console.error('⚠️ AI Evaluation: Failed to fetch Moltbook context:', err.message);
    }
  }

  const predictionsWithContext = predictions.map(p => {
    const news = contextMap[p.onchainId] || [];
    const newsStr = news.length > 0 
      ? news.map(n => `Post by ${n.author}: "${n.content}" (Karma: ${n.karma})`).join('\n')
      : 'No related news found on Moltbook.';
      
    return `ID: ${p.onchainId}
Question: "${p.question}"
Moltbook Context:
${newsStr}`;
  }).join('\n\n---\n\n');

  const prompt = `
    You are an expert analyst for a prediction market. 
    Analyze the following predictions and decide for each if 'YES' or 'NO' is more likely based on current real-world data.
    
    You have two primary tools for evaluation:
    1. Google Web Search (use it to gather the latest global events).
    2. Moltbook Context (provided below for each prediction): These are real-time social posts from the Moltbook platform related to the topic.
    
    Decision priority:
    - If Moltbook context contains verified high-karma news, give it significant weight.
    - Use Web Search to supplement or verify the social sentiment found in Moltbook.
    
    Predictions to evaluate:
    ${predictionsWithContext}
    
    Output format:
    Return your answer strictly as a JSON array of objects. Each object must have:
    - id: The prediction ID
    - decision: Either "YES" or "NO"
    - confidence: A decimal between 0 and 1 (how sure you are)
    - reason: A short, concise justification mentioning both Moltbook news (if relevant) and search findings (max 60 words).
  `;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('AI failed to return a structured JSON response.');
    }
    
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('❌ AI Evaluation:', err.message);
    throw err;
  }
}

/**
 * Checks the real-world status of a list of predictions to determine if they can be resolved.
 * @param {Array<object>} predictions - Array of prediction objects
 * @returns {Promise<Array<object>>} Array of resolution results { predictionId, isFinished, outcome, reasoning }
 */
async function checkEventStatus(predictions) {
  if (!config.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured.');
  }

  const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.5-flash',
    tools: [{ googleSearch: {} }] 
  });

  const results = [];

  for (const p of predictions) {
    try {
      // Determine preferred sources based on tags
      const tags = (p.tags || []).map(t => t.toLowerCase());
      let sourcesPrompt = "official news outlets";
      if (tags.includes('crypto') || tags.includes('bitcoin') || tags.includes('eth')) {
        sourcesPrompt = "trusted crypto news sites like CoinTelegraph, Coindesk, or The Block";
      } else if (tags.includes('finance') || tags.includes('stocks') || tags.includes('politics')) {
        sourcesPrompt = "major financial and news outlets like CNBC, Bloomberg, Reuters, or Associated Press";
      }

      const prompt = `
        Your task is to determine the final outcome of the following prediction question for a decentralized market.
        
        QUESTION: "${p.question}"
        
        Using Google Search, find the official result of this event.
        - PRIORITIZE results from: ${sourcesPrompt}.
        - If the event is clearly FINISHED, provide the outcome: "YES" if the condition met, "NO" if it didn't.
        - If the event is NOT finished or results are inconclusive, return "PENDING".
        
        CRITICAL: Only provide "YES" or "NO" if you are 100% certain based on reporting from the prioritized sources.
        
        Respond in JSON format:
        {
          "isFinished": boolean,
          "outcome": "YES" | "NO" | "PENDING",
          "reasoning": "Brief explanation of the result found, citing the specific source(s) used"
        }
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Extract JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        results.push({
          predictionId: p.id,
          onchainId: p.onchainId,
          ...data
        });
      }
    } catch (err) {
      console.error(`⚠️ AI Status Check failed for ID ${p.id}:`, err.message);
      results.push({
        predictionId: p.id,
        onchainId: p.onchainId,
        isFinished: false,
        outcome: 'PENDING',
        reasoning: 'Error checking status: ' + err.message
      });
    }
  }

  return results;
}

module.exports = {
  evaluatePredictions,
  checkEventStatus,
};
