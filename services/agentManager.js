/**
 * OrclX – OpenClaw Agent Manager
 * Handles Docker container provisioning for user-specific AI agents.
 */

const Docker = require('dockerode');
const docker = new Docker();
const prisma = require('../db/prisma');
const config = require('../config');
const { v4: uuidv4 } = require('uuid');

const AGENT_IMAGE = 'orclx-agent';
const NETWORK_NAME = 'orclx-network';

/**
 * Provisions a new OpenClaw agent container for a user.
 * @param {string} userId - Internal Prisma user ID
 * @param {function} onProgress - Optional callback for status updates
 */
async function provisionAgent(userId, onProgress = () => {}) {
  onProgress('Initializing Docker environment...');
  console.log(`🐳 [AgentManager] Provisioning agent for user ${userId}...`);

  // 1. Ensure network exists
  try {
    onProgress('Verifying local agent image...');
    const images = await docker.listImages();
    const hasImage = images.some(img => img.RepoTags && img.RepoTags.includes(AGENT_IMAGE));
    
    if (!hasImage) {
      onProgress('Local agent image not found. Building... (this may take a minute)');
      // In a real scenario, we might want to trigger the build here.
      // But for now, we assume it was built via the CLI or previous step.
      throw new Error(`Docker image ${AGENT_IMAGE} not found. Please run: docker build -t orclx-agent ./agents/openclaw`);
    }

    onProgress('Checking virtual network...');
    const networks = await docker.listNetworks();
    if (!networks.find(n => n.Name === NETWORK_NAME)) {
      onProgress('Creating isolated storage network...');
      await docker.createNetwork({ Name: NETWORK_NAME });
    }
  } catch (err) {
    console.warn('⚠️ [AgentManager] Network check failed:', err.message);
  }

  // 2. Generate Session Key (User Delegated Key)
  onProgress('Generating delegated session key...');
  const sessionKey = uuidv4();

  // 3. Create Container
  // For now, we mount the agent script and run it
  const containerName = `orclx-agent-${userId}`;

  try {
    // Stop/Remove existing if present
    const existing = docker.getContainer(containerName);
    try {
      onProgress('Removing previous agent instance...');
      await existing.stop();
      await existing.remove();
    } catch (e) {}

    onProgress('Provisioning isolated Docker container...');
    const container = await docker.createContainer({
      Image: AGENT_IMAGE,
      name: containerName,
      Env: [
        `USER_ID=${userId}`,
        `SESSION_KEY=${sessionKey}`,
        `BACKEND_URL=http://host.docker.internal:${config.PORT}`,
        `GEMINI_API_KEY=${process.env.GEMINI_API_KEY}`,
      ],
      Cmd: ['node', 'agent.js'],
    });

    onProgress('Starting OpenClaw agent engine...');
    await container.start();

    // 4. Update DB
    onProgress('Syncing agent state to database...');
    await prisma.agent.upsert({
      where: { userId: userId },
      update: {
        containerId: container.id,
        status: 'running',
        sessionKey: sessionKey,
      },
      create: {
        userId: userId,
        containerId: container.id,
        status: 'running',
        sessionKey: sessionKey,
      },
    });

    console.log(`✅ [AgentManager] Agent provisioned: ${container.id}`);
    return { containerId: container.id, sessionKey };
  } catch (err) {
    console.error('❌ [AgentManager] Provisioning failed:', err.message);
    throw err;
  }
}

/**
 * Terminates an agent container.
 */
async function terminateAgent(userId) {
  const containerName = `orclx-agent-${userId}`;
  const container = docker.getContainer(containerName);

  try {
    await container.stop();
    await container.remove();
    
    await prisma.agent.update({
      where: { userId: userId },
      data: { status: 'stopped', containerId: null },
    });
    
    console.log(`🛑 [AgentManager] Agent for user ${userId} terminated.`);
  } catch (err) {
    console.error('❌ [AgentManager] Termination failed:', err.message);
  }
}

/**
 * Dispatches a market task to the agent container via docker exec.
 */
async function dispatchTask(userId, task) {
  const containerName = `orclx-agent-${userId}`;
  const container = docker.getContainer(containerName);

  try {
    // Escape single quotes for shell safety
    const taskJSON = JSON.stringify(task).replace(/'/g, "'\\''");
    
    // We wrap in a shell to redirect output to /proc/1/fd/1 so it shows in Docker logs
    const exec = await container.exec({
      Cmd: ['sh', '-c', `node agent.js --task '${taskJSON}' > /proc/1/fd/1 2>&1`],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ detach: false });
    
    // We don't necessarily need to wait for completion here 
    // as the agent will callback via webhook.
    console.log(`📡 [AgentManager] Task dispatched to agent for user ${userId}`);
    return true;
  } catch (err) {
    console.error(`❌ [AgentManager] Task dispatch failed for user ${userId}:`, err.message);
    throw err;
  }
}

module.exports = {
  provisionAgent,
  terminateAgent,
  dispatchTask,
};
