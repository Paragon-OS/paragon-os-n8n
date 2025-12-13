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
  /** Custom image to use instead of n8nio/n8n. Use for images with custom nodes pre-installed. */
  image?: string;
  timeout?: number;
  env?: Record<string, string>;
  /** Additional volume mounts in format "hostPath:containerPath" */
  volumes?: string[];
}

export interface N8nInstance {
  containerName: string;
  port: number;
  baseUrl: string;
  dataDir: string;
  apiKey?: string;
  sessionCookie?: string;
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
  logger.debug(`Finding available port starting from ${startPort}...`);
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 100; // Don't try more than 100 ports
    
    const tryPort = (port: number) => {
      attempts++;
      if (attempts > maxAttempts) {
        reject(new Error(`Could not find available port after ${maxAttempts} attempts`));
        return;
      }
      
      // Create a new server for each attempt to avoid "already listening" errors
      const server = net.createServer();
      
      // Register error handler BEFORE calling listen to avoid race conditions
      server.once('error', (err: NodeJS.ErrnoException) => {
        server.close();
        if (err.code === 'EADDRINUSE') {
          // Port is in use, try next one
          logger.debug(`Port ${port} in use, trying ${port + 1}...`);
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
      
      // Register listening handler
      server.once('listening', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          const foundPort = address.port;
          server.close(() => {
            logger.debug(`✅ Found available port: ${foundPort}`);
            resolve(foundPort);
          });
        } else {
          server.close(() => {
            reject(new Error('Could not determine port'));
          });
        }
      });
      
      // Start listening on the port
      server.listen(port);
    };
    
    tryPort(startPort);
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
  let lastProgressLog = 0;
  const axios = (await import('axios')).default;

  logger.info(`⏳ Waiting for n8n container to be ready at ${baseUrl} (timeout: ${timeout}ms)...`);

  while (Date.now() - startTime < timeout) {
    const elapsed = Date.now() - startTime;
    
    // Log progress every 10 seconds
    if (elapsed - lastProgressLog >= 10000) {
      logger.info(`⏳ Container still starting... (${Math.floor(elapsed / 1000)}s elapsed)`);
      lastProgressLog = elapsed;
    }
    try {
      const response = await axios.get(`${baseUrl}/healthz`, {
        timeout: 2000,
        validateStatus: () => true, // Don't throw on any status
      });
      
      // 200 = healthy, 401 = running but requires auth (both are fine)
      if (response.status === 200 || response.status === 401) {
        const elapsed = Date.now() - startTime;
        logger.info(`✅ n8n container is ready at ${baseUrl} (took ${Math.floor(elapsed / 1000)}s)`);
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
  const customImage = config?.image;
  const imageName = customImage || `n8nio/n8n:${n8nVersion}`;
  const timeout = config?.timeout || DEFAULT_STARTUP_TIMEOUT;
  const envVars = config?.env || {};
  const additionalVolumes = config?.volumes || [];
  
  // Create data directory
  const dataDir = config?.dataDir || createTempDataDir(containerName);
  
  // Find available port
  logger.info(`Finding available port...`);
  let actualPort: number;
  if (requestedPort && requestedPort > 0) {
    actualPort = requestedPort;
    logger.info(`Using requested port: ${actualPort}`);
  } else {
    actualPort = await findAvailablePort();
    logger.info(`Using auto-selected port: ${actualPort}`);
  }

  const baseUrl = `http://localhost:${actualPort}`;

  logger.info(`Starting n8n instance: ${containerName} on port ${actualPort}`);

  // Clean up any existing container with the same name
  logger.info(`Step 1: Cleaning up any existing container...`);
  try {
    await removeContainer(containerName, true);
    logger.info(`✅ Cleanup complete`);
  } catch (error) {
    logger.warn(`Failed to clean up existing container ${containerName}`, error);
  }

  try {
    // Check if image exists locally first (faster than trying to pull)
    logger.info(`Step 2: Checking if n8n image exists locally: ${imageName}...`);
    try {
      await execa('podman', ['inspect', imageName], {
        timeout: 5000,
      });
      logger.info(`✅ Image already exists locally`);
    } catch (error) {
      // For custom local images, we don't try to pull - just error
      if (customImage && customImage.startsWith('localhost/')) {
        throw new Error(`Custom image "${imageName}" not found. Build it first with: docker/build-custom-image.sh`);
      }
      logger.info(`Image not found locally, pulling from registry...`);
      try {
        await execa('podman', ['pull', imageName], {
          timeout: 180000, // 3 minutes for pull
        });
        logger.info(`✅ Image pulled successfully`);
      } catch (pullError) {
        throw new Error(`Failed to pull n8n image: ${pullError instanceof Error ? pullError.message : String(pullError)}`);
      }
    }

    // Build environment variables
    logger.info(`Step 3: Building container configuration...`);
    const envArgs: string[] = [];
    // Don't use basic auth - we'll use user management with API keys instead
    // Basic auth and user management are mutually exclusive in n8n
    envArgs.push('-e', 'N8N_BASIC_AUTH_ACTIVE=false');
    envArgs.push('-e', 'N8N_HOST=0.0.0.0');
    envArgs.push('-e', 'N8N_PORT=5678');
    envArgs.push('-e', 'N8N_PROTOCOL=http');
    envArgs.push('-e', 'N8N_METRICS=false'); // Disable metrics for faster startup
    envArgs.push('-e', 'N8N_DIAGNOSTICS_ENABLED=false'); // Disable diagnostics
    envArgs.push('-e', 'N8N_PAYLOAD_SIZE_MAX=16'); // Increase payload size limit
    envArgs.push('-e', 'N8N_SKIP_WEBHOOK_DEREGISTRATION_SHUTDOWN=true'); // Skip webhook cleanup
    envArgs.push('-e', 'N8N_PERSONALIZATION_ENABLED=false'); // Disable personalization
    envArgs.push('-e', 'N8N_USER_FOLDER=/home/node/.n8n');

    // Enhanced logging for better error visibility
    envArgs.push('-e', 'N8N_LOG_LEVEL=debug'); // Enable debug logging for detailed execution info
    envArgs.push('-e', 'N8N_LOG_OUTPUT=console,file'); // Log to both console and file
    envArgs.push('-e', 'N8N_LOG_FILE_LOCATION=/home/node/.n8n/n8n.log'); // Persistent log file

    // Execution saving for debugging - save all executions including errors
    envArgs.push('-e', 'EXECUTIONS_DATA_SAVE_ON_ERROR=all'); // Save execution data on errors
    envArgs.push('-e', 'EXECUTIONS_DATA_SAVE_ON_SUCCESS=all'); // Save execution data on success
    envArgs.push('-e', 'EXECUTIONS_DATA_SAVE_ON_PROGRESS=true'); // Save progress during execution
    envArgs.push('-e', 'EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=true'); // Save manual/test executions
    
    // Pass through Google Gemini API key from local .env if present
    const geminiEnvKeys = [
      'GOOGLE_GEMINI_API_KEY',
      'GOOGLE_PALM_API_KEY',
      'GOOGLE_API_KEY', // fallback name some users use
      'GOOGLE_AI_STUDIO_API_KEY',
    ];
    for (const key of geminiEnvKeys) {
      const val = process.env[key];
      if (val) {
        envArgs.push('-e', `${key}=${val}`);
      }
    }
    
    // Add custom environment variables
    for (const [key, value] of Object.entries(envVars)) {
      envArgs.push('-e', `${key}=${value}`);
    }

    // Start container
    logger.info(`Step 4: Starting container with image ${imageName}...`);

    // Build volume arguments
    const volumeArgs: string[] = ['-v', `${dataDir}:/home/node/.n8n`];
    for (const vol of additionalVolumes) {
      volumeArgs.push('-v', vol);
    }

    const containerArgs = [
      'run',
      '-d',
      '--name', containerName,
      '-p', `${actualPort}:5678`,
      // Enable container to reach host services (Redis, etc.) via host.containers.internal
      '--add-host=host.containers.internal:host-gateway',
      ...volumeArgs,
      ...envArgs,
      imageName,
    ];

    logger.info(`Executing: podman run -d --name ${containerName} -p ${actualPort}:5678 ...`);
    const { stdout: containerId } = await execa('podman', containerArgs, {
      timeout: 30000,
    });
    logger.info(`✅ Container started: ${containerId.trim()}`);

    // Wait for n8n to be ready
    logger.info(`Step 5: Waiting for n8n to be ready at ${baseUrl}...`);
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

    // Set up user, API key, and credentials
    logger.info(`Step 6: Setting up n8n user, API key, and credentials...`);
    const { setupN8nWithCredentials } = await import('./n8n-setup');
    let apiKey: string | undefined;
    let sessionCookie: string | undefined;
    try {
      const setupResult = await setupN8nWithCredentials(
        containerName,
        baseUrl,
        dataDir
      );
      apiKey = setupResult.apiKey;
      sessionCookie = setupResult.sessionCookie;
      // apiKey is always undefined - this is intentional (API key creation skipped)
      if (sessionCookie) {
        logger.info(`✅ n8n setup complete with session cookie authentication`);
      } else {
        logger.warn(`⚠️  Could not obtain session cookie, tests may fail`);
      }
    } catch (error) {
      logger.error(`Failed to set up n8n: ${error instanceof Error ? error.message : String(error)}`);
      logger.warn(`Continuing anyway, but tests will likely fail without proper setup`);
    }

    logger.info(`✅ n8n instance ready: ${baseUrl}`);

    return {
      containerName,
      port: actualPort,
      baseUrl,
      dataDir,
      apiKey,
      sessionCookie,
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
 * Get container logs (stdout/stderr)
 * @param containerName - Name of the container
 * @param tail - Number of lines to retrieve (default 1000 for better error context)
 */
export async function getContainerLogs(containerName: string, tail: number = 1000): Promise<string> {
  try {
    const { stdout, stderr } = await execa('podman', ['logs', '--tail', String(tail), containerName], {
      timeout: 30000, // Increased timeout for larger log retrieval
    });
    // Combine stdout and stderr for complete picture
    return stderr ? `${stdout}\n--- STDERR ---\n${stderr}` : stdout;
  } catch (error) {
    throw new Error(`Failed to get logs for container ${containerName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get n8n log file from inside the container (MOST RECENT entries)
 * This provides detailed execution logs when N8N_LOG_OUTPUT=file is enabled
 * @param containerName - Name of the container
 * @param tail - Number of lines to retrieve from END of file (default 500)
 */
export async function getN8nLogFile(containerName: string, tail: number = 500): Promise<string> {
  try {
    // Note: N8N_LOG_FILE_LOCATION is /home/node/.n8n/n8n.log but due to N8N_USER_FOLDER nesting
    // the actual location might be /home/node/.n8n/.n8n/n8n.log
    // Try both locations
    let stdout = '';
    const locations = [
      '/home/node/.n8n/n8n.log',
      '/home/node/.n8n/.n8n/n8n.log',
    ];

    for (const location of locations) {
      try {
        const result = await execa('podman', [
          'exec', containerName,
          'tail', '-n', String(tail), location
        ], {
          timeout: 10000,
        });
        if (result.stdout) {
          stdout = result.stdout;
          logger.debug(`Found n8n log at ${location}`);
          break;
        }
      } catch {
        // Try next location
      }
    }

    return stdout;
  } catch (error) {
    // Log file might not exist yet or container might be stopped
    logger.debug(`Could not read n8n log file: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}

/**
 * Get comprehensive logs from container (both container logs and n8n log file)
 * Use this for debugging failed tests
 * @param containerName - Name of the container
 * @param containerLogTail - Lines from container stdout/stderr (default 500)
 * @param n8nLogTail - Lines from n8n.log file (default 500)
 */
export async function getComprehensiveLogs(
  containerName: string,
  containerLogTail: number = 500,
  n8nLogTail: number = 500
): Promise<{ containerLogs: string; n8nLogs: string; combined: string }> {
  const [containerLogs, n8nLogs] = await Promise.all([
    getContainerLogs(containerName, containerLogTail).catch(() => '(container logs unavailable)'),
    getN8nLogFile(containerName, n8nLogTail).catch(() => '(n8n log file unavailable)'),
  ]);

  const combined = [
    '=== CONTAINER LOGS (stdout/stderr) ===',
    containerLogs,
    '',
    '=== N8N LOG FILE (/home/node/.n8n/n8n.log) ===',
    n8nLogs,
  ].join('\n');

  return { containerLogs, n8nLogs, combined };
}

