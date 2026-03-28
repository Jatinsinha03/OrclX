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
 * @returns {Promise<Array<object>>} Decisions with reasoning
 */
async function evaluatePredictions(predictions, telegramId) {
  if (!config.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured.');
  }

  const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.5-flash',
    tools: [{ googleSearch: {} }] // Enable Google Search
  });

  // Fetch Moltbook context if possible
  const contextMap = {};
  if (telegramId) {
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
    console.error('❌ AI Evaluation Error:', err.message);
    throw err;
  }
}

module.exports = {
  evaluatePredictions,
};
