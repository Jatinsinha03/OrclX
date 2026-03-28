/**
 * OrclX – Blockchain Service
 * Wraps ethers.js interactions with the PredictionChaining contract on Monad.
 */

const { ethers } = require('ethers');
const config = require('../config');
const abi = require('../config/abi.json');

// ─── Provider & Signer ──────────────────────────────────────────────

let _provider;
let _signer;
let _contract;

/**
 * Returns a JSON-RPC provider pointed at Monad testnet.
 */
function getProvider() {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(config.RPC_URL, {
      name: 'monad-testnet',
      chainId: config.CHAIN_ID,
    });
  }
  return _provider;
}

/**
 * Returns a wallet signer using the configured private key.
 */
function getSigner() {
  if (!_signer) {
    if (!config.PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY not set in .env');
    }
    _signer = new ethers.Wallet(config.PRIVATE_KEY, getProvider());
  }
  return _signer;
}

/**
 * Returns the PredictionChaining contract instance.
 */
function getContract() {
  if (!_contract) {
    _contract = new ethers.Contract(config.CONTRACT_ADDRESS, abi, getSigner());
  }
  return _contract;
}

// ─── Contract Interactions ───────────────────────────────────────────

/**
 * Create a new prediction on-chain.
 * @param {string} question - The prediction question
 * @param {string} stakeWei - Stake in wei (string)
 * @param {string[]} tags - Array of tag strings
 * @returns {{ tx: object, receipt: object }}
 */
async function createPrediction(question, stakeWei, tags) {
  const contract = getContract();
  const tx = await contract.createPrediction(question, stakeWei, tags);
  const receipt = await tx.wait();
  return { tx, receipt };
}

/**
 * Place a bet on a prediction.
 * @param {number} predictionId - On-chain prediction ID
 * @param {boolean} yes - True for YES, false for NO
 * @param {string} stakeWei - Value to send in wei
 * @returns {{ tx: object, receipt: object }}
 */
async function bet(predictionId, yes, stakeWei) {
  const contract = getContract();
  const tx = await contract.bet(predictionId, yes, { value: stakeWei });
  const receipt = await tx.wait();
  return { tx, receipt };
}

/**
 * Branch (chain) exposure from one prediction to another.
 * @param {number} fromId - Source prediction ID
 * @param {number} toId - Target prediction ID
 * @param {boolean} yesOnTarget - Bet YES on target?
 * @param {string} amountWei - Amount in wei
 * @returns {{ tx: object, receipt: object }}
 */
async function branchPrediction(fromId, toId, yesOnTarget, amountWei) {
  const contract = getContract();
  const tx = await contract.branchPrediction(fromId, toId, yesOnTarget, amountWei);
  const receipt = await tx.wait();
  return { tx, receipt };
}

/**
 * Claim winnings from a resolved prediction.
 * @param {number} predictionId - On-chain prediction ID
 * @returns {{ tx: object, receipt: object }}
 */
async function claim(predictionId) {
  const contract = getContract();
  const tx = await contract.claim(predictionId);
  const receipt = await tx.wait();
  return { tx, receipt };
}

/**
 * Read a prediction struct from the contract.
 * @param {number} id - On-chain prediction ID
 */
async function getPrediction(id) {
  const contract = getContract();
  const p = await contract.predictions(id);
  return {
    question: p.question,
    stake: p.stake.toString(),
    setter: p.setter,
    result: Number(p.result), // 0=Pending, 1=Yes, 2=No
    resolved: p.resolved,
    totalYes: p.totalYes.toString(),
    totalNo: p.totalNo.toString(),
    createdAt: Number(p.createdAt),
    participants: p.participants,
  };
}

/**
 * Get the current prediction count from the contract.
 */
async function getPredictionCount() {
  const contract = getContract();
  const count = await contract.predictionCount();
  return Number(count);
}

/**
 * Request resolution via UMA oracle for a prediction.
 * @param {number} predictionId - On-chain prediction ID
 */
async function requestResolution(predictionId) {
  const contract = getContract();
  const tx = await contract.requestResolution(predictionId);
  const receipt = await tx.wait();
  return { tx, receipt };
}

/**
 * Settle a previously requested resolution from the oracle.
 * @param {number} predictionId - On-chain prediction ID
 */
async function settleResolution(predictionId) {
  const contract = getContract();
  const tx = await contract.settleResolution(predictionId);
  const receipt = await tx.wait();
  return { tx, receipt };
}

/**
 * Admin: Resolve and distribute winnings via AI verification.
 * @param {number} predictionId - On-chain prediction ID
 * @param {boolean} outcome - Final outcome (true=YES, false=NO)
 */
async function adminResolveAndDistribute(predictionId, outcome) {
  const contract = getContract();
  const tx = await contract.adminResolveAndDistribute(predictionId, outcome);
  const receipt = await tx.wait();
  return { tx, receipt };
}

/**
 * Get the relayer wallet address.
 */
function getWalletAddress() {
  return getSigner().address;
}

module.exports = {
  getProvider,
  getSigner,
  getContract,
  createPrediction,
  bet,
  branchPrediction,
  claim,
  getPrediction,
  getPredictionCount,
  requestResolution,
  settleResolution,
  adminResolveAndDistribute,
  getWalletAddress,
};
