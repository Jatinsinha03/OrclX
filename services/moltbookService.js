/**
 * OrclX – Moltbook Service
 * Handles Moltbook agent registration, verification, and news feed fetching.
 */

const axios = require('axios');
const config = require('../config');
const prisma = require('../db/prisma');

const MOLTBOOK_BASE_URL = config.MOLTBOOK_BASE_URL || 'https://www.moltbook.com/api/v1';

// ─── Stop words to filter out when extracting keywords ──────────────
const STOP_WORDS = new Set([
  'will', 'the', 'is', 'a', 'an', 'in', 'on', 'at', 'to', 'for',
  'of', 'and', 'or', 'by', 'be', 'it', 'do', 'did', 'does', 'has',
  'have', 'had', 'was', 'were', 'are', 'been', 'being', 'this',
  'that', 'with', 'from', 'can', 'could', 'would', 'should', 'may',
  'might', 'shall', 'not', 'no', 'yes', 'if', 'but', 'so', 'than',
  'then', 'when', 'what', 'which', 'who', 'how', 'where', 'why',
  'before', 'after', 'above', 'below', 'between', 'during', 'about',
  'into', 'through', 'over', 'under', 'again', 'further', 'more',
  'most', 'very', 'just', 'also', 'much', 'any', 'all', 'each',
  'every', 'both', 'few', 'some', 'such', 'own', 'same', 'other',
  'its', 'his', 'her', 'their', 'our', 'your', 'my', 'up', 'down',
  'out', 'off', 'there', 'here', 'these', 'those', 'i', 'you', 'he',
  'she', 'we', 'they', 'me', 'him', 'us', 'them', 'get', 'go',
  'going', 'reach', 'hit', 'make', 'take', 'come', 'give',
]);

// ─── Keyword Extraction ─────────────────────────────────────────────

/**
 * Extract important keywords from a prediction question.
 * Removes stop words, punctuation, and short words.
 * @param {string} question - The prediction question
 * @returns {string[]} Array of keywords
 */
function extractKeywords(question) {
  if (!question) return [];

  const words = question
    .replace(/[?!.,;:'"()\[\]{}<>\/\\@#$%^&*+=~`|]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1)
    .filter((w) => !STOP_WORDS.has(w.toLowerCase()));

  // Keep unique keywords, preserve original case for display
  const seen = new Set();
  const unique = [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(w);
    }
  }

  return unique.slice(0, 10); // Cap at 10 keywords
}

// ─── Register Agent ─────────────────────────────────────────────────

/**
 * Register a new agent on Moltbook.
 * @param {string} name - Agent name
 * @param {string} description - Agent description
 * @returns {{ api_key: string, claim_url: string }}
 */
async function registerAgent(name, description, retries = 1) {
  console.log(`📡 [Moltbook] Registering agent "${name}"... (tries left: ${retries})`);

  try {
    const response = await axios.post(
      `${MOLTBOOK_BASE_URL}/agents/register`,
      { name, description: description || `OrclX prediction market agent: ${name}` },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'OrclX/1.0',
        },
        timeout: 45000, // Increase to 45s
      }
    );

    const data = response.data;
    const agentData = data.agent || data;

    const apiKey =
      agentData.api_key || agentData.apiKey || agentData.key ||
      agentData.token || data.api_key || data.apiKey;

    const claimUrl =
      agentData.claim_url || agentData.claimUrl ||
      data.claim_url || data.claimUrl || '';

    if (!apiKey) {
      throw new Error('Registration succeeded but no API key found in response.');
    }

    console.log(`✅ [Moltbook] Agent "${name}" registered successfully.`);
    return { api_key: apiKey, claim_url: claimUrl };
  } catch (err) {
    if (retries > 0 && (err.code === 'ECONNABORTED' || err.response?.status === 429)) {
      console.log(`⚠️  [Moltbook] Rate limited or timeout, retrying in 2 seconds...`);
      await new Promise(r => setTimeout(r, 2000));
      return registerAgent(name, description, retries - 1);
    }
    throw err;
  }
}

// ─── Check Verification ─────────────────────────────────────────────

/**
 * Check if an agent's tweet verification is complete.
 * @param {string} apiKey - Moltbook API key
 * @returns {{ verified: boolean, profileUrl?: string }}
 */
async function checkVerification(apiKey, retries = 1) {
  console.log(`📡 [Moltbook] Checking verification status... (tries left: ${retries})`);

  try {
    const response = await axios.get(`${MOLTBOOK_BASE_URL}/agents/status`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'OrclX/1.0',
      },
      timeout: 30000,
    });

    const data = response.data;
    const agentData = data.agent || data;

    const status = (agentData.status || data.status || '').toLowerCase();
    const verified =
      agentData.verified === true ||
      agentData.claimed === true ||
      data.verified === true ||
      data.claimed === true ||
      status === 'verified' ||
      status === 'active' ||
      status === 'claimed' ||
      status === 'live';

    const profileUrl =
      agentData.profile_url || agentData.profileUrl ||
      data.profile_url || data.profileUrl || undefined;

    return { verified, profileUrl };
  } catch (err) {
    if (retries > 0 && (err.code === 'ECONNABORTED' || err.response?.status === 500 || err.response?.status === 429)) {
      console.log(`⚠️  [Moltbook] Server error, retry verification check in 2 seconds...`);
      await new Promise(r => setTimeout(r, 2000));
      return checkVerification(apiKey, retries - 1);
    }
    throw err;
  }
}

// ─── Fetch News by Keywords ─────────────────────────────────────────

/**
 * Fetch Moltbook feed and filter by keywords.
 * @param {string} apiKey - Moltbook API key
 * @param {string[]} keywords - Keywords to match against
 * @returns {Array<{ author: string, content: string, karma: number, submolt: string }>}
 */
async function fetchNewsByKeywords(apiKey, keywords, retries = 1) {
  console.log(`📡 [Moltbook] Fetching news for keywords: [${keywords.join(', ')}] (tries left: ${retries})`);

  try {
    const response = await axios.get(`${MOLTBOOK_BASE_URL}/feed`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'OrclX/1.0',
      },
      timeout: 30000,
    });

    const data = response.data;

    // Parse posts from various response shapes
    let posts = [];
    if (Array.isArray(data)) {
      posts = data;
    } else if (data && typeof data === 'object') {
      if (data.posts) posts = data.posts;
      else if (data.items) posts = data.items;
      else if (data.results) posts = data.results;
      else if (data.data && Array.isArray(data.data)) posts = data.data;
      else if (data.content || data.text) posts = [data];
    }

    // Lowercase keywords for matching
    const keywordsLower = keywords.map((k) => k.toLowerCase());

    // Normalize and filter posts
    const filtered = posts
      .map((post) => {
        const authorData = post.author || post.username || 'Unknown';
        const author = typeof authorData === 'object'
          ? (authorData.display_name || authorData.name || 'Unknown')
          : String(authorData);

        const submoltData = post.submolt || post.community || 'm/general';
        const submolt = typeof submoltData === 'object'
          ? (submoltData.display_name || submoltData.name || 'm/general')
          : String(submoltData);

        const content = String(post.content || post.text || '');
        const contentLower = content.toLowerCase();

        // Count keyword matches
        const matchCount = keywordsLower.filter((kw) => contentLower.includes(kw)).length;

        return {
          author,
          content: content.length > 300 ? content.substring(0, 300) + '...' : content,
          karma: Number(post.karma || post.upvotes || 0),
          submolt,
          matchCount,
          timestamp: String(post.createdAt || post.timestamp || ''),
        };
      })
      .filter((p) => p.matchCount > 0) // Only posts with at least 1 keyword match
      .sort((a, b) => b.matchCount - a.matchCount || b.karma - a.karma) // Best matches first
      .slice(0, 5); // Top 5

    console.log(`📰 [Moltbook] Found ${filtered.length} matching posts out of ${posts.length} total.`);
    return filtered;
  } catch (err) {
    if (retries > 0 && (err.code === 'ECONNABORTED' || err.response?.status === 500 || err.response?.status === 429)) {
      console.log(`⚠️  [Moltbook] Server error, retry fetching news in 2 seconds...`);
      await new Promise((r) => setTimeout(r, 2000));
      return fetchNewsByKeywords(apiKey, keywords, retries - 1);
    }
    throw err;
  }
}

// ─── DB Helpers ─────────────────────────────────────────────────────

/**
 * Save Moltbook credentials for a user.
 */
async function saveMoltbookCredentials(telegramId, apiKey, claimUrl) {
  await prisma.user.update({
    where: { telegramId: String(telegramId) },
    data: {
      moltbookApiKey: apiKey,
      moltbookClaimUrl: claimUrl,
      moltbookVerified: false,
    },
  });
}

/**
 * Mark a user's Moltbook agent as verified.
 */
async function markVerified(telegramId) {
  await prisma.user.update({
    where: { telegramId: String(telegramId) },
    data: { moltbookVerified: true },
  });
}

/**
 * Get a user's Moltbook API key (null if not connected).
 */
async function getMoltbookApiKey(telegramId) {
  const user = await prisma.user.findUnique({
    where: { telegramId: String(telegramId) },
    select: { moltbookApiKey: true, moltbookVerified: true, moltbookClaimUrl: true },
  });
  return user;
}

module.exports = {
  extractKeywords,
  registerAgent,
  checkVerification,
  fetchNewsByKeywords,
  saveMoltbookCredentials,
  markVerified,
  getMoltbookApiKey,
};
