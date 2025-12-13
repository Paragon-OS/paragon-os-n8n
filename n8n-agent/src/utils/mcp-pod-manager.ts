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
import { type McpSseCredentialMapping } from './workflow-reference-converter';
import { POD_SESSION_COOKIE_PATH, POD_MCP_MAPPINGS_PATH } from './pod-connection';

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
  /**
   * Credential mappings for rewriting STDIO credentials to SSE.
   * Pass these to executeWorkflowTest() via options.mcpCredentialMappings
   * to allow workflows designed for STDIO MCP to work with SSE in the pod.
   */
  mcpCredentialMappings: McpSseCredentialMapping[];
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

  // Create SSE entrypoint script - reads MCP_PORT from environment
  const ssePythonScript = `#!/usr/bin/env python3
"""SSE mode entrypoint for Telegram MCP server."""
import asyncio
import sys
import os
import nest_asyncio

nest_asyncio.apply()

from main import mcp, client, cleanup

async def main():
    try:
        # Read port from environment, default to 8000
        port = int(os.environ.get("MCP_PORT", "8000"))
        host = os.environ.get("MCP_HOST", "0.0.0.0")

        print("Starting Telegram client...", flush=True)
        await client.start()
        print(f"Telegram client started. Running MCP SSE server on {host}:{port}...", flush=True)

        mcp.settings.host = host
        mcp.settings.port = port

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

# MCP server port (can be overridden at runtime)
ENV MCP_PORT=8000
ENV MCP_HOST=0.0.0.0

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
    let healthCheckPassed = false;

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
      // Health endpoint failed, will try SSE
    }

    // Try SSE endpoint as fallback (Telegram MCP uses this)
    if (!healthCheckPassed) {
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

  // Find available ports - one for n8n and one for each MCP server
  const n8nExternalPort = await findAvailablePort(50000);

  // Allocate unique ports for each MCP server
  // Each server gets: { internalPort, externalPort }
  const mcpPortAllocations: Map<string, { internalPort: number; externalPort: number }> = new Map();
  let nextExternalPort = n8nExternalPort + 1;
  let nextInternalPort = DEFAULT_MCP_PORT;

  for (const mcpConfig of config.mcpServers) {
    const internalPort = mcpConfig.port || nextInternalPort;
    const externalPort = await findAvailablePort(nextExternalPort);
    mcpPortAllocations.set(mcpConfig.type, { internalPort, externalPort });
    nextExternalPort = externalPort + 1;
    nextInternalPort = internalPort + 1;
  }

  logger.info(`Creating pod: ${podName}`);
  logger.info(`  n8n port: ${n8nExternalPort}`);
  for (const [type, ports] of mcpPortAllocations) {
    logger.info(`  ${type} MCP: internal=${ports.internalPort}, external=${ports.externalPort}`);
  }

  // Create data directory for n8n
  const tmpDir = os.tmpdir();
  const dataDir = path.join(tmpDir, 'n8n-test-instances', podName);
  fs.mkdirSync(dataDir, { recursive: true });

  // Build port publishing args for pod creation
  const portArgs: string[] = ['-p', `${n8nExternalPort}:${DEFAULT_N8N_PORT}`];
  for (const [_type, ports] of mcpPortAllocations) {
    portArgs.push('-p', `${ports.externalPort}:${ports.internalPort}`);
  }

  // Create the pod with published ports
  await execa('podman', [
    'pod', 'create',
    '--name', podName,
    ...portArgs,
  ]);

  const mcpEndpoints: Record<string, string> = {}; // External endpoints for test access
  const mcpEndpointsInternal: Record<string, string> = {}; // Internal endpoints for n8n
  const mcpContainerNames: string[] = [];

  try {
    // Start MCP servers
    for (const mcpConfig of config.mcpServers) {
      const containerName = `${podName}-${mcpConfig.type}-mcp`;
      mcpContainerNames.push(containerName);

      // Get allocated ports for this MCP server
      const ports = mcpPortAllocations.get(mcpConfig.type);
      if (!ports) {
        throw new Error(`No port allocation found for ${mcpConfig.type}`);
      }

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

      // Set MCP_PORT environment variable to configure server port
      containerArgs.push('-e', `MCP_PORT=${ports.internalPort}`);

      // Add custom env vars
      if (mcpConfig.env) {
        for (const [key, value] of Object.entries(mcpConfig.env)) {
          containerArgs.push('-e', `${key}=${value}`);
        }
      }

      containerArgs.push(imageName);

      logger.info(`Starting ${mcpConfig.type} MCP container: ${containerName} (port ${ports.internalPort})`);
      await execa('podman', containerArgs, { timeout: 30000 });

      // Wait for MCP to be ready - use external port for health checks
      const isReady = await waitForMcpReady(ports.externalPort, timeout);
      if (!isReady) {
        const logs = await execa('podman', ['logs', containerName], { reject: false });
        logger.error(`MCP container logs:\n${logs.stdout}\n${logs.stderr}`);
        throw new Error(`${mcpConfig.type} MCP server failed to become ready`);
      }

      // Internal endpoint for n8n (within the pod via localhost:<port>)
      mcpEndpointsInternal[mcpConfig.type] = `http://localhost:${ports.internalPort}/sse`;
      // External endpoint for test verification (from outside the pod)
      mcpEndpoints[mcpConfig.type] = `http://localhost:${ports.externalPort}/sse`;
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
    let mcpCredentialMappings: McpSseCredentialMapping[] = [];
    try {
      const setupResult = await setupN8nWithCredentials(
        n8nContainerName,
        baseUrl,
        dataDir
      );
      sessionCookie = setupResult.sessionCookie;
      apiKey = setupResult.apiKey;

      // Inject MCP SSE credentials and get credential mappings for workflow rewriting
      // The mappings allow workflows designed for STDIO MCP to work with SSE in the pod
      mcpCredentialMappings = await injectMcpSseCredentials(
        n8nContainerName,
        dataDir,
        config.mcpServers,
        mcpEndpointsInternal
      );

      // Save session cookie and MCP mappings to container for CLI commands to access
      await savePodConnectionInfo(n8nContainerName, sessionCookie, mcpCredentialMappings);
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
    if (mcpCredentialMappings.length > 0) {
      logger.info(`  Credential mappings: ${mcpCredentialMappings.length} (STDIO → SSE)`);
      for (const mapping of mcpCredentialMappings) {
        logger.info(`    ${mapping.stdioId} → ${mapping.sseId} (${mapping.sseName})`);
      }
    }

    return {
      podName,
      n8nInstance,
      mcpEndpoints,
      mcpEndpointsInternal,
      mcpCredentialMappings,
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
 * Save session cookie and MCP credential mappings to container for CLI access.
 * These files are read by pod-connection.ts when CLI commands need to connect.
 */
async function savePodConnectionInfo(
  containerName: string,
  sessionCookie: string | undefined,
  mcpCredentialMappings: McpSseCredentialMapping[]
): Promise<void> {
  logger.info('Saving pod connection info for CLI access...');

  // Save session cookie
  if (sessionCookie) {
    try {
      await execa('podman', [
        'exec', containerName,
        'sh', '-c', `echo '${sessionCookie}' > ${POD_SESSION_COOKIE_PATH}`,
      ], { timeout: 5000 });
      logger.info(`  Saved session cookie to ${POD_SESSION_COOKIE_PATH}`);
    } catch (error) {
      logger.warn(`Failed to save session cookie: ${error}`);
    }
  }

  // Save MCP credential mappings
  if (mcpCredentialMappings.length > 0) {
    try {
      const mappingsJson = JSON.stringify(mcpCredentialMappings);
      await execa('podman', [
        'exec', containerName,
        'sh', '-c', `echo '${mappingsJson}' > ${POD_MCP_MAPPINGS_PATH}`,
      ], { timeout: 5000 });
      logger.info(`  Saved ${mcpCredentialMappings.length} MCP credential mappings to ${POD_MCP_MAPPINGS_PATH}`);
    } catch (error) {
      logger.warn(`Failed to save MCP credential mappings: ${error}`);
    }
  }
}

// MCP STDIO credential IDs from n8n-credentials.ts
const MCP_STDIO_CREDENTIAL_IDS: Record<string, string> = {
  discord: 'ZFofx3k2ze1wsifx',
  telegram: 'aiYCclLDUqob5iQ0',
};

// MCP SSE credential IDs (separate from STDIO to allow proper credential rewriting)
const MCP_SSE_CREDENTIAL_IDS: Record<string, string> = {
  discord: 'discordMcpSseCredential',
  telegram: 'telegramMcpSseCredential',
};

// MCP SSE credential names
const MCP_SSE_CREDENTIAL_NAMES: Record<string, string> = {
  discord: 'Discord MCP Client (SSE) account',
  telegram: 'Telegram MCP Client (SSE) account',
};

/**
 * Inject MCP SSE credentials into n8n container.
 * Uses separate SSE credential IDs - workflow nodes will be rewritten to use these
 * via the mcpCredentialMappings returned by startMcpPod().
 *
 * @returns Credential mappings for workflow rewriting
 */
async function injectMcpSseCredentials(
  containerName: string,
  dataDir: string,
  mcpServers: McpServerConfig[],
  mcpEndpointsInternal: Record<string, string>
): Promise<McpSseCredentialMapping[]> {
  logger.info('🔐 Injecting MCP SSE credentials...');

  const mappings: McpSseCredentialMapping[] = [];

  for (const mcpConfig of mcpServers) {
    const stdioCredentialId = MCP_STDIO_CREDENTIAL_IDS[mcpConfig.type];
    const sseCredentialId = MCP_SSE_CREDENTIAL_IDS[mcpConfig.type];
    const sseCredentialName = MCP_SSE_CREDENTIAL_NAMES[mcpConfig.type];
    const sseEndpoint = mcpEndpointsInternal[mcpConfig.type];

    if (!stdioCredentialId || !sseCredentialId || !sseEndpoint) {
      logger.warn(`Missing credential config for ${mcpConfig.type} MCP`);
      continue;
    }

    const credentialDef = {
      id: sseCredentialId,
      name: sseCredentialName,
      type: 'mcpClientSseApi',
      data: {
        sseEndpoint,
      },
    };

    logger.info(`  Injecting ${mcpConfig.type} MCP SSE credential`);
    logger.info(`    SSE credential ID: ${sseCredentialId}`);
    logger.info(`    STDIO credential ID: ${stdioCredentialId} (will be rewritten → ${sseCredentialId})`);
    logger.info(`    SSE endpoint: ${sseEndpoint}`);

    // Create credential file
    const credDir = path.join(dataDir, '.n8n-credentials');
    if (!fs.existsSync(credDir)) {
      fs.mkdirSync(credDir, { recursive: true });
    }

    const credFile = path.join(credDir, `credential-${sseCredentialId}.json`);
    const credentialJson = [{
      id: credentialDef.id,
      name: credentialDef.name,
      type: credentialDef.type,
      data: credentialDef.data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];

    fs.writeFileSync(credFile, JSON.stringify(credentialJson, null, 2));

    // Copy to container and import
    const containerTempPath = `/tmp/credential-sse-${Date.now()}.json`;
    await execa('podman', ['cp', credFile, `${containerName}:${containerTempPath}`], { timeout: 10000 });

    const result = await execa(
      'podman',
      ['exec', '-u', 'node', containerName, 'n8n', 'import:credentials', '--input', containerTempPath],
      { timeout: 30000, reject: false }
    );

    if (result.exitCode !== 0) {
      logger.error(`Failed to import ${mcpConfig.type} MCP SSE credential: ${result.stderr}`);
    } else {
      logger.info(`  ✅ ${mcpConfig.type} MCP SSE credential injected`);

      // Add mapping for successful injection
      mappings.push({
        stdioId: stdioCredentialId,
        sseId: sseCredentialId,
        sseName: sseCredentialName,
      });
    }

    // Clean up
    await execa('podman', ['exec', '-u', 'node', containerName, 'rm', containerTempPath], { timeout: 5000, reject: false });
    try { fs.unlinkSync(credFile); } catch { /* ignore */ }
  }

  // Clean up credential directory
  const credDir = path.join(dataDir, '.n8n-credentials');
  try { fs.rmSync(credDir, { recursive: true, force: true }); } catch { /* ignore */ }

  logger.info(`📋 Generated ${mappings.length} credential mapping(s) for workflow rewriting`);
  return mappings;
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
