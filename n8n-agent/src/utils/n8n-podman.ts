/**
 * Podman-based n8n Instance Manager
 * 
 * Manages isolated n8n instances in podman containers for integration testing.
 * Each test gets a clean n8n instance with its own database.
 * 
 * Features:
 * - Automatic container lifecycle management
 * - Health checks and readiness waiting
 * - Resource cleanup on errors
 * - Port management (auto-assign or custom)
 */

import { execa } from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import { logger } from './logger';

export interface N8nPodmanConfig {
  containerName?: string;
  port?: number;
  dataDir?: string;
  n8nVersion?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface N8nInstance {
  containerName: string;
  port: number;
  baseUrl: string;
  dataDir: string;
  apiKey?: string;
  stop: () => Promise<void>;
  remove: () => Promise<void>;
  restart: () => Promise<void>;
}

const DEFAULT_N8N_VERSION = 'latest';
const DEFAULT_TIMEOUT = 60000; // 60 seconds
const DEFAULT_STARTUP_TIMEOUT = 120000; // 2 minutes for initial startup
const HEALTH_CHECK_INTERVAL = 1000; // 1 second between health checks

/**
 * Check if podman is available and working
 */
export async function checkPodmanAvailable(): Promise<boolean> {
  try {
    const { stdout } = await execa('podman', ['--version'], {
      timeout: 5000,
    });
    logger.debug(`Podman available: ${stdout.trim()}`);
    
    // Also check if podman can run containers
    const { exitCode } = await execa('podman', ['info'], {
      timeout: 5000,
      reject: false,
    });
    
    return exitCode === 0;
  } catch (error) {
    logger.warn('Podman not available', error);
    return false;
  }
}

/**
 * Generate a unique container name
 */
function generateContainerName(prefix: string = 'n8n-test'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Find an available port starting from a base port
 */
async function findAvailablePort(startPort: number = 50000): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    
    server.listen(startPort, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => {
          resolve(port);
        });
      } else {
        server.close(() => {
          reject(new Error('Could not determine port'));
        });
      }
    });
    
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Port is in use, try next one
        findAvailablePort(startPort + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Create a temporary directory for n8n data
 */
function createTempDataDir(containerName: string): string {
  const tmpDir = os.tmpdir();
  const dataDir = path.join(tmpDir, 'n8n-test-instances', containerName);
  
  // Ensure parent directory exists
  const parentDir = path.dirname(dataDir);
  fs.mkdirSync(parentDir, { recursive: true });
  
  // Create data directory
  fs.mkdirSync(dataDir, { recursive: true });
  
  logger.debug(`Created data directory: ${dataDir}`);
  return dataDir;
}

/**
 * Wait for n8n to be ready by checking health endpoint
 */
async function waitForN8nReady(
  baseUrl: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<boolean> {
  const startTime = Date.now();
  const axios = (await import('axios')).default;

  logger.debug(`Waiting for n8n to be ready at ${baseUrl} (timeout: ${timeout}ms)`);

  while (Date.now() - startTime < timeout) {
    try {
      const response = await axios.get(`${baseUrl}/healthz`, {
        timeout: 2000,
        validateStatus: () => true, // Don't throw on any status
      });
      
      // 200 = healthy, 401 = running but requires auth (both are fine)
      if (response.status === 200 || response.status === 401) {
        const elapsed = Date.now() - startTime;
        logger.debug(`n8n is ready at ${baseUrl} (took ${elapsed}ms)`);
        return true;
      }
    } catch (error) {
      // Not ready yet, continue waiting
      if (axios.isAxiosError(error) && error.code !== 'ECONNREFUSED') {
        // Unexpected error, log it
        logger.debug(`Health check error (will retry): ${error.message}`);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL));
  }

  const elapsed = Date.now() - startTime;
  logger.warn(`n8n failed to become ready within ${timeout}ms (elapsed: ${elapsed}ms)`);
  return false;
}

/**
 * Check if a container exists
 */
async function containerExists(containerName: string): Promise<boolean> {
  try {
    const { stdout } = await execa('podman', ['ps', '-a', '--filter', `name=${containerName}`, '--format', '{{.Names}}'], {
      timeout: 5000,
    });
    return stdout.trim() === containerName;
  } catch {
    return false;
  }
}

/**
 * Remove a container if it exists
 */
async function removeContainer(containerName: string, force: boolean = false): Promise<void> {
  const exists = await containerExists(containerName);
  if (!exists) {
    return;
  }

  try {
    const args = force ? ['rm', '-f', containerName] : ['rm', containerName];
    await execa('podman', args, { timeout: 10000 });
    logger.debug(`Removed container: ${containerName}`);
  } catch (error) {
    logger.warn(`Failed to remove container ${containerName}`, error);
    throw error;
  }
}

/**
 * Stop a container if it's running
 */
async function stopContainer(containerName: string): Promise<void> {
  try {
    const { stdout } = await execa('podman', ['ps', '--filter', `name=${containerName}`, '--format', '{{.Names}}'], {
      timeout: 5000,
    });
    
    if (stdout.trim() === containerName) {
      await execa('podman', ['stop', containerName], { timeout: 10000 });
      logger.debug(`Stopped container: ${containerName}`);
    }
  } catch (error) {
    // Container might not be running, that's fine
    logger.debug(`Container ${containerName} is not running or already stopped`);
  }
}

/**
 * Start a new n8n instance in podman
 */
export async function startN8nInstance(
  config?: Partial<N8nPodmanConfig>
): Promise<N8nInstance> {
  const containerName = config?.containerName || generateContainerName();
  const requestedPort = config?.port;
  const n8nVersion = config?.n8nVersion || DEFAULT_N8N_VERSION;
  const timeout = config?.timeout || DEFAULT_STARTUP_TIMEOUT;
  const envVars = config?.env || {};
  
  // Create data directory
  const dataDir = config?.dataDir || createTempDataDir(containerName);
  
  // Find available port
  let actualPort: number;
  if (requestedPort && requestedPort > 0) {
    actualPort = requestedPort;
  } else {
    actualPort = await findAvailablePort();
  }

  const baseUrl = `http://localhost:${actualPort}`;

  logger.info(`Starting n8n instance: ${containerName} on port ${actualPort}`);

  // Clean up any existing container with the same name
  try {
    await removeContainer(containerName, true);
  } catch (error) {
    logger.warn(`Failed to clean up existing container ${containerName}`, error);
  }

  try {
    // Pull n8n image if needed (with timeout)
    logger.debug(`Pulling n8n image: n8nio/n8n:${n8nVersion}`);
    try {
      await execa('podman', ['pull', `n8nio/n8n:${n8nVersion}`], {
        timeout: 180000, // 3 minutes for pull
      });
      logger.debug(`Image pulled successfully`);
    } catch (error) {
      // Check if image already exists locally
      try {
        await execa('podman', ['inspect', `n8nio/n8n:${n8nVersion}`], {
          timeout: 5000,
        });
        logger.debug(`Image already exists locally`);
      } catch {
        throw new Error(`Failed to pull n8n image: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Build environment variables
    const envArgs: string[] = [];
    envArgs.push('-e', 'N8N_BASIC_AUTH_ACTIVE=false'); // Disable auth for testing
    envArgs.push('-e', 'N8N_HOST=0.0.0.0');
    envArgs.push('-e', 'N8N_PORT=5678');
    envArgs.push('-e', 'N8N_PROTOCOL=http');
    envArgs.push('-e', 'N8N_METRICS=false'); // Disable metrics for faster startup
    envArgs.push('-e', 'N8N_DIAGNOSTICS_ENABLED=false'); // Disable diagnostics
    envArgs.push('-e', 'N8N_PAYLOAD_SIZE_MAX=16'); // Increase payload size limit
    // Don't disable user management - we need it to create a user and API key
    // envArgs.push('-e', 'N8N_USER_MANAGEMENT_DISABLED=true'); // Disable user management for testing
    envArgs.push('-e', 'N8N_SKIP_WEBHOOK_DEREGISTRATION_SHUTDOWN=true'); // Skip webhook cleanup
    envArgs.push('-e', 'N8N_DISABLE_PRODUCTION_MAIN_PROCESS=true'); // Disable production mode (allows API without key)
    envArgs.push('-e', 'N8N_PERSONALIZATION_ENABLED=false'); // Disable personalization
    envArgs.push('-e', 'N8N_USER_FOLDER=/home/node/.n8n');
    
    // Add custom environment variables
    for (const [key, value] of Object.entries(envVars)) {
      envArgs.push('-e', `${key}=${value}`);
    }

    // Start container
    const containerArgs = [
      'run',
      '-d',
      '--name', containerName,
      '-p', `${actualPort}:5678`,
      '-v', `${dataDir}:/home/node/.n8n`,
      ...envArgs,
      `n8nio/n8n:${n8nVersion}`,
    ];

    logger.debug(`Starting container: podman ${containerArgs.join(' ')}`);
    const { stdout: containerId } = await execa('podman', containerArgs, {
      timeout: 30000,
    });
    logger.debug(`Container started: ${containerId.trim()}`);

    // Wait for n8n to be ready
    logger.info(`Waiting for n8n to be ready at ${baseUrl}...`);
    const isReady = await waitForN8nReady(baseUrl, timeout);
    
    if (!isReady) {
      // Clean up on failure
      logger.error(`n8n failed to start, cleaning up container ${containerName}`);
      try {
        await stopContainer(containerName);
        await removeContainer(containerName, true);
      } catch (cleanupError) {
        logger.warn(`Failed to clean up container after startup failure`, cleanupError);
      }
      throw new Error(`n8n failed to start within ${timeout}ms. Check logs with: podman logs ${containerName}`);
    }

    // Wait for API to be ready and set up user if needed
    logger.info(`Setting up n8n API access...`);
    const { waitForN8nApiReady } = await import('./n8n-setup');
    let apiKey: string | undefined;
    try {
      const apiReady = await waitForN8nApiReady(baseUrl, 30000); // 30 seconds for API setup
      apiKey = apiReady.apiKey;
      if (apiKey) {
        logger.debug(`n8n API key obtained: ${apiKey.substring(0, 10)}...`);
      }
    } catch (error) {
      logger.warn(`Failed to set up n8n API access, continuing anyway: ${error instanceof Error ? error.message : String(error)}`);
    }

    logger.info(`✅ n8n instance ready: ${baseUrl}${apiKey ? ' (with API key)' : ''}`);

    return {
      containerName,
      port: actualPort,
      baseUrl,
      dataDir,
      apiKey,
      async stop() {
        logger.info(`Stopping n8n instance: ${containerName}`);
        try {
          await stopContainer(containerName);
        } catch (error) {
          logger.warn(`Failed to stop container ${containerName}`, error);
          throw error;
        }
      },
      async remove() {
        logger.info(`Removing n8n instance: ${containerName}`);
        try {
          await stopContainer(containerName);
          await removeContainer(containerName, true);
        } catch (error) {
          logger.warn(`Failed to remove container ${containerName}`, error);
          throw error;
        }
        // Clean up data directory
        try {
          if (fs.existsSync(dataDir)) {
            fs.rmSync(dataDir, { recursive: true, force: true });
            logger.debug(`Removed data directory: ${dataDir}`);
          }
        } catch (error) {
          logger.warn(`Failed to remove data directory ${dataDir}`, error);
        }
      },
      async restart() {
        logger.info(`Restarting n8n instance: ${containerName}`);
        try {
          await stopContainer(containerName);
          await execa('podman', ['start', containerName], { timeout: 10000 });
          
          // Wait for n8n to be ready again
          const isReady = await waitForN8nReady(baseUrl, timeout);
          if (!isReady) {
            throw new Error(`n8n failed to become ready after restart`);
          }
          
          logger.info(`✅ n8n instance restarted: ${baseUrl}`);
        } catch (error) {
          logger.error(`Failed to restart container ${containerName}`, error);
          throw error;
        }
      },
    };
  } catch (error) {
    // Clean up on failure
    logger.error(`Failed to start n8n instance: ${error instanceof Error ? error.message : String(error)}`);
    try {
      await stopContainer(containerName);
      await removeContainer(containerName, true);
    } catch (cleanupError) {
      logger.warn(`Failed to clean up container after startup failure`, cleanupError);
    }
    throw error;
  }
}

/**
 * Stop and remove an n8n instance
 */
export async function stopN8nInstance(instance: N8nInstance): Promise<void> {
  await instance.remove();
}

/**
 * Get database path from instance data directory
 */
export function getDatabasePath(instance: N8nInstance): string {
  return path.join(instance.dataDir, 'database.sqlite');
}

/**
 * Check if n8n instance is running
 */
export async function isInstanceRunning(containerName: string): Promise<boolean> {
  try {
    const { stdout } = await execa('podman', ['ps', '--filter', `name=${containerName}`, '--format', '{{.Names}}'], {
      timeout: 5000,
    });
    return stdout.trim() === containerName;
  } catch {
    return false;
  }
}

/**
 * Get container logs
 */
export async function getContainerLogs(containerName: string, tail: number = 100): Promise<string> {
  try {
    const { stdout } = await execa('podman', ['logs', '--tail', String(tail), containerName], {
      timeout: 10000,
    });
    return stdout;
  } catch (error) {
    throw new Error(`Failed to get logs for container ${containerName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

