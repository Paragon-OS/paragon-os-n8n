/**
 * MCP Pod Manager - Manages podman pods with MCP servers and n8n
 *
 * Creates isolated test environments where n8n and MCP servers run
 * in the same podman pod, sharing localhost networking.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────┐
 * │                    Podman Pod                           │
 * │  (shared localhost network)                             │
 * │                                                         │
 * │  ┌─────────────────┐      ┌─────────────────┐          │
 * │  │  MCP Container  │      │  n8n Container  │          │
 * │  │  (SSE server)   │◄────►│                 │          │
 * │  │  Port 8000      │      │  Port 5678      │          │
 * │  └─────────────────┘      └─────────────────┘          │
 * │         ▲                          ▲                    │
 * └─────────│──────────────────────────│────────────────────┘
 *           │                          │
 *     localhost:8000             localhost:5678
 */

import { execa } from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import axios from 'axios';
import { logger } from './logger';
import type { N8nInstance } from './n8n-podman';
import { setupN8nWithCredentials } from './n8n-setup';

// Paths to MCP servers in the monorepo
const DISCORD_MCP_PATH = path.resolve(__dirname, '../../../mcp-servers/discord-self-mcp');
const TELEGRAM_MCP_PATH = path.resolve(__dirname, '../../../mcp-servers/telegram-mcp');

// Default configuration
const DEFAULT_MCP_PORT = 8000;
const DEFAULT_N8N_PORT = 5678;
const HEALTH_CHECK_INTERVAL = 1000;
const DEFAULT_STARTUP_TIMEOUT = 180000; // 3 minutes

export interface McpServerConfig {
  type: 'discord' | 'telegram';
  /** Port for SSE server (default: 8000) */
  port?: number;
  /** Environment variables for the MCP server */
  env?: Record<string, string>;
}

export interface McpPodConfig {
  /** MCP servers to run in the pod */
  mcpServers: McpServerConfig[];
  /** n8n port (default: 5678) */
  n8nPort?: number;
  /** Custom n8n image (default: localhost/n8n-paragon-os:latest) */
  n8nImage?: string;
  /** Timeout for startup in ms (default: 180000) */
  timeout?: number;
  /** Additional volumes for n8n container */
  n8nVolumes?: string[];
}

export interface McpPodInstance {
  podName: string;
  n8nInstance: N8nInstance;
  /** Internal MCP endpoints (for n8n to use within the pod via localhost:8000) */
  mcpEndpointsInternal: Record<string, string>;
  /** External MCP endpoints (for tests to verify from outside the pod) */
  mcpEndpoints: Record<string, string>;
  cleanup: () => Promise<void>;
}

/**
 * Generate a unique pod name
 */
function generatePodName(prefix: string = 'n8n-mcp-test'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Find an available port
 */
async function findAvailablePort(startPort: number = 50000): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      server.close();
      if (err.code === 'EADDRINUSE') {
        findAvailablePort(startPort + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
    server.once('listening', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not determine port')));
      }
    });
    server.listen(startPort);
  });
}

/**
 * Build Discord MCP container image
 */
async function buildDiscordMcpImage(): Promise<string> {
  const imageName = 'discord-mcp-sse:latest';
  logger.info('Building Discord MCP SSE container image...');

  // Check if dist exists
  const distPath = path.join(DISCORD_MCP_PATH, 'dist');
  if (!fs.existsSync(distPath)) {
    // Build the project first
    logger.info('Building Discord MCP project...');
    await execa('npm', ['run', 'build'], {
      cwd: DISCORD_MCP_PATH,
      timeout: 60000,
    });
  }

  // Build the Docker image
  await execa('podman', [
    'build',
    '-t', imageName,
    '-f', 'Dockerfile',
    '.',
  ], {
    cwd: DISCORD_MCP_PATH,
    timeout: 120000,
  });

  logger.info('Discord MCP image built successfully');
  return imageName;
}

/**
 * Build Telegram MCP container image with SSE support
 */
async function buildTelegramMcpImage(): Promise<string> {
  const imageName = 'telegram-mcp-sse:latest';
  logger.info('Building Telegram MCP SSE container image...');

  // Create SSE entrypoint script
  const ssePythonScript = `#!/usr/bin/env python3
"""SSE mode entrypoint for Telegram MCP server."""
import asyncio
import sys
import nest_asyncio

nest_asyncio.apply()

from main import mcp, client, cleanup

async def main():
    try:
        print("Starting Telegram client...", flush=True)
        await client.start()
        print("Telegram client started. Running MCP SSE server on port 8000...", flush=True)

        mcp.settings.host = "0.0.0.0"
        mcp.settings.port = 8000

        await mcp.run_sse_async()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr, flush=True)
        raise
    finally:
        await cleanup()

if __name__ == "__main__":
    asyncio.run(main())
`;

  // Create a Dockerfile for SSE mode
  const sseDockerfile = `FROM python:3.13-alpine

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY telegram_mcp/ ./telegram_mcp/
COPY run_sse.py .

RUN adduser --disabled-password --gecos "" appuser && chown -R appuser:appuser /app
USER appuser

ENV TELEGRAM_API_ID=""
ENV TELEGRAM_API_HASH=""
ENV TELEGRAM_SESSION_NAME="telegram_mcp_session"
ENV TELEGRAM_SESSION_STRING=""

EXPOSE 8000

CMD ["python", "run_sse.py"]
`;

  const dockerfilePath = path.join(TELEGRAM_MCP_PATH, 'Dockerfile.sse');
  const pythonScriptPath = path.join(TELEGRAM_MCP_PATH, 'run_sse.py');

  try {
    fs.writeFileSync(dockerfilePath, sseDockerfile);
    fs.writeFileSync(pythonScriptPath, ssePythonScript);

    await execa('podman', [
      'build',
      '-t', imageName,
      '-f', 'Dockerfile.sse',
      '.',
    ], {
      cwd: TELEGRAM_MCP_PATH,
      timeout: 120000,
    });

    logger.info('Telegram MCP image built successfully');
  } finally {
    // Clean up temporary files
    try { fs.unlinkSync(dockerfilePath); } catch { /* ignore */ }
    try { fs.unlinkSync(pythonScriptPath); } catch { /* ignore */ }
  }

  return imageName;
}

/**
 * Wait for MCP SSE server to be ready
 */
async function waitForMcpReady(
  port: number,
  timeout: number = 60000
): Promise<boolean> {
  const startTime = Date.now();
  const endpoint = `http://localhost:${port}/health`;
  const sseEndpoint = `http://localhost:${port}/sse`;

  logger.info(`Waiting for MCP server at port ${port}...`);

  while (Date.now() - startTime < timeout) {
    try {
      // Try health endpoint first (Discord MCP has this)
      const response = await axios.get(endpoint, {
        timeout: 2000,
        validateStatus: () => true,
      });
      if (response.status === 200 && response.data?.status === 'ok') {
        logger.info(`MCP server ready at port ${port}`);
        return true;
      }
    } catch {
      // Try SSE endpoint as fallback
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const response = await axios.get(sseEndpoint, {
          signal: controller.signal,
          timeout: 3000,
          validateStatus: () => true,
          responseType: 'stream',
        });
        clearTimeout(timeoutId);
        if (response.status === 200) {
          response.data.destroy();
          logger.info(`MCP SSE server ready at port ${port}`);
          return true;
        }
      } catch (err) {
        if (axios.isAxiosError(err) && err.code === 'ERR_CANCELED') {
          // Aborted after connecting - server is ready
          logger.info(`MCP SSE server ready at port ${port} (verified via stream)`);
          return true;
        }
      }
    }
    await new Promise(r => setTimeout(r, HEALTH_CHECK_INTERVAL));
  }

  return false;
}

/**
 * Wait for n8n to be ready
 */
async function waitForN8nReady(
  port: number,
  timeout: number = 60000
): Promise<boolean> {
  const startTime = Date.now();
  const endpoint = `http://localhost:${port}/healthz`;

  logger.info(`Waiting for n8n at port ${port}...`);

  while (Date.now() - startTime < timeout) {
    try {
      const response = await axios.get(endpoint, {
        timeout: 2000,
        validateStatus: () => true,
      });
      if (response.status === 200 || response.status === 401) {
        logger.info(`n8n ready at port ${port}`);
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, HEALTH_CHECK_INTERVAL));
  }

  return false;
}

/**
 * Start a pod with MCP servers and n8n
 */
export async function startMcpPod(config: McpPodConfig): Promise<McpPodInstance> {
  const podName = generatePodName();
  const timeout = config.timeout || DEFAULT_STARTUP_TIMEOUT;

  // Find available ports
  const n8nExternalPort = await findAvailablePort(50000);
  // MCP port only needs to be accessible within the pod (localhost:8000)
  // but we expose it for debugging
  const mcpExternalPort = await findAvailablePort(n8nExternalPort + 1);

  logger.info(`Creating pod: ${podName}`);
  logger.info(`  n8n port: ${n8nExternalPort}`);
  logger.info(`  MCP port: ${mcpExternalPort}`);

  // Create data directory for n8n
  const tmpDir = os.tmpdir();
  const dataDir = path.join(tmpDir, 'n8n-test-instances', podName);
  fs.mkdirSync(dataDir, { recursive: true });

  // Create the pod with published ports
  await execa('podman', [
    'pod', 'create',
    '--name', podName,
    '-p', `${n8nExternalPort}:${DEFAULT_N8N_PORT}`,
    '-p', `${mcpExternalPort}:${DEFAULT_MCP_PORT}`,
  ]);

  const mcpEndpoints: Record<string, string> = {}; // External endpoints for test access
  const mcpEndpointsInternal: Record<string, string> = {}; // Internal endpoints for n8n
  const mcpContainerNames: string[] = [];

  try {
    // Start MCP servers
    for (const mcpConfig of config.mcpServers) {
      const containerName = `${podName}-${mcpConfig.type}-mcp`;
      mcpContainerNames.push(containerName);

      let imageName: string;
      let envFile: string | undefined;

      if (mcpConfig.type === 'discord') {
        imageName = await buildDiscordMcpImage();
        const discordEnvFile = path.join(DISCORD_MCP_PATH, '.env');
        if (fs.existsSync(discordEnvFile)) {
          envFile = discordEnvFile;
        }
      } else {
        imageName = await buildTelegramMcpImage();
        const telegramEnvFile = path.join(TELEGRAM_MCP_PATH, '.env');
        if (fs.existsSync(telegramEnvFile)) {
          envFile = telegramEnvFile;
        }
      }

      const containerArgs = [
        'run', '-d',
        '--name', containerName,
        '--pod', podName,
      ];

      // Add env file if exists
      if (envFile) {
        containerArgs.push('--env-file', envFile);
      }

      // Add custom env vars
      if (mcpConfig.env) {
        for (const [key, value] of Object.entries(mcpConfig.env)) {
          containerArgs.push('-e', `${key}=${value}`);
        }
      }

      containerArgs.push(imageName);

      logger.info(`Starting ${mcpConfig.type} MCP container: ${containerName}`);
      await execa('podman', containerArgs, { timeout: 30000 });

      // Wait for MCP to be ready - use external port for health checks
      const isReady = await waitForMcpReady(mcpExternalPort, timeout);
      if (!isReady) {
        const logs = await execa('podman', ['logs', containerName], { reject: false });
        logger.error(`MCP container logs:\n${logs.stdout}\n${logs.stderr}`);
        throw new Error(`${mcpConfig.type} MCP server failed to become ready`);
      }

      // Internal endpoint for n8n (within the pod via localhost:8000)
      mcpEndpointsInternal[mcpConfig.type] = `http://localhost:${DEFAULT_MCP_PORT}/sse`;
      // External endpoint for test verification (from outside the pod)
      mcpEndpoints[mcpConfig.type] = `http://localhost:${mcpExternalPort}/sse`;
    }

    // Start n8n container
    const n8nContainerName = `${podName}-n8n`;
    const n8nImage = config.n8nImage || 'localhost/n8n-paragon-os:latest';

    const n8nArgs = [
      'run', '-d',
      '--name', n8nContainerName,
      '--pod', podName,
      '-v', `${dataDir}:/home/node/.n8n`,
      '-e', 'N8N_BASIC_AUTH_ACTIVE=false',
      '-e', 'N8N_HOST=0.0.0.0',
      '-e', 'N8N_PORT=5678',
      '-e', 'N8N_LOG_LEVEL=debug',
      '-e', 'N8N_LOG_OUTPUT=console,file',
      '-e', 'EXECUTIONS_DATA_SAVE_ON_ERROR=all',
      '-e', 'EXECUTIONS_DATA_SAVE_ON_SUCCESS=all',
    ];

    // Add additional volumes
    if (config.n8nVolumes) {
      for (const vol of config.n8nVolumes) {
        n8nArgs.push('-v', vol);
      }
    }

    n8nArgs.push(n8nImage);

    logger.info(`Starting n8n container: ${n8nContainerName}`);
    await execa('podman', n8nArgs, { timeout: 30000 });

    // Wait for n8n to be ready
    const n8nReady = await waitForN8nReady(n8nExternalPort, timeout);
    if (!n8nReady) {
      throw new Error('n8n failed to become ready');
    }

    const baseUrl = `http://localhost:${n8nExternalPort}`;

    // Set up n8n user and credentials
    logger.info('Setting up n8n user and credentials...');
    let sessionCookie: string | undefined;
    let apiKey: string | undefined;
    try {
      const setupResult = await setupN8nWithCredentials(
        n8nContainerName,
        baseUrl,
        dataDir
      );
      sessionCookie = setupResult.sessionCookie;
      apiKey = setupResult.apiKey;
    } catch (error) {
      logger.warn(`Failed to set up n8n credentials: ${error}`);
    }

    const n8nInstance: N8nInstance = {
      containerName: n8nContainerName,
      port: n8nExternalPort,
      baseUrl,
      dataDir,
      apiKey,
      sessionCookie,
      async stop() {
        await execa('podman', ['stop', n8nContainerName], { reject: false });
      },
      async remove() {
        await execa('podman', ['rm', '-f', n8nContainerName], { reject: false });
      },
      async restart() {
        await execa('podman', ['restart', n8nContainerName]);
        await waitForN8nReady(n8nExternalPort, 60000);
      },
    };

    logger.info(`Pod ${podName} ready!`);
    logger.info(`  n8n: ${baseUrl}`);
    for (const [type, endpoint] of Object.entries(mcpEndpoints)) {
      logger.info(`  ${type} MCP (external): ${endpoint}`);
    }
    for (const [type, endpoint] of Object.entries(mcpEndpointsInternal)) {
      logger.info(`  ${type} MCP (internal): ${endpoint}`);
    }

    return {
      podName,
      n8nInstance,
      mcpEndpoints,
      mcpEndpointsInternal,
      async cleanup() {
        logger.info(`Cleaning up pod: ${podName}`);
        await execa('podman', ['pod', 'rm', '-f', podName], { reject: false });
        // Clean up data directory
        try {
          fs.rmSync(dataDir, { recursive: true, force: true });
        } catch { /* ignore */ }
      },
    };

  } catch (error) {
    // Cleanup on failure
    logger.error(`Failed to start MCP pod: ${error}`);
    await execa('podman', ['pod', 'rm', '-f', podName], { reject: false });
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch { /* ignore */ }
    throw error;
  }
}

/**
 * Get the MCP SSE credential definition for a given endpoint
 */
export function getMcpSseCredential(
  id: string,
  name: string,
  sseEndpoint: string
): {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
} {
  return {
    id,
    name,
    type: 'mcpClientSseApi',
    data: {
      sseEndpoint,
    },
  };
}
