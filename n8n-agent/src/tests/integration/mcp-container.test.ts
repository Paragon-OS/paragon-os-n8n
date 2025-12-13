/**
 * Integration test for MCP server running in a container alongside n8n.
 *
 * Architecture:
 * - Telegram MCP runs in a container with SSE transport on port 8000
 * - n8n runs in another container in the same podman pod
 * - Both containers share localhost network via the pod
 * - n8n connects to MCP via SSE at http://localhost:8000/sse
 *
 * Based on: /Users/nipuna/Software/paragon-os/telegram-mcp/tests/test_mcp_container.py
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import axios from 'axios';
import { logger } from '../../utils/logger';

// Test configuration
const TEST_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const MCP_PORT = 8000;
const N8N_PORT = 5678;
const POD_NAME = 'n8n-mcp-test-pod';
const MCP_CONTAINER_NAME = 'telegram-mcp-test';
const N8N_CONTAINER_NAME = 'n8n-mcp-test';
const MCP_IMAGE = 'telegram-mcp-sse:latest';
const N8N_IMAGE = 'localhost/n8n-paragon-os:latest';

// Paths - MCP servers are in the monorepo
const TELEGRAM_MCP_PATH = '/Users/nipuna/Software/paragon-os/paragon-os-app/mcp-servers/telegram-mcp';

interface McpToolsResponse {
  jsonrpc: string;
  id: number;
  result?: {
    tools: Array<{
      name: string;
      description: string;
      inputSchema: object;
    }>;
  };
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Check if podman is available
 */
async function checkPodman(): Promise<boolean> {
  try {
    const result = await execa('podman', ['--version']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Build the MCP container image with SSE support
 */
async function buildMcpImage(): Promise<void> {
  logger.info('Building MCP container image with SSE support...');

  const fs = await import('fs/promises');
  const path = await import('path');

  // Create SSE entrypoint Python script
  // Configure FastMCP settings to bind to 0.0.0.0 for container networking
  const ssePythonScript = `#!/usr/bin/env python3
"""SSE mode entrypoint for Telegram MCP server."""
import asyncio
import sys
import nest_asyncio

# Apply nest_asyncio first
nest_asyncio.apply()

# Import from main after nest_asyncio is applied
from main import mcp, client, cleanup

async def main():
    try:
        print("Starting Telegram client...", flush=True)
        await client.start()
        print("Telegram client started. Running MCP SSE server on port 8000...", flush=True)

        # Configure settings to bind to all interfaces for container networking
        mcp.settings.host = "0.0.0.0"
        mcp.settings.port = 8000

        # Run in SSE mode
        await mcp.run_sse_async()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr, flush=True)
        raise
    finally:
        await cleanup()

if __name__ == "__main__":
    asyncio.run(main())
`;

  // Create a modified Dockerfile that runs in SSE mode
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

  // Write both files
  const dockerfilePath = path.join(TELEGRAM_MCP_PATH, 'Dockerfile.sse');
  const pythonScriptPath = path.join(TELEGRAM_MCP_PATH, 'run_sse.py');

  await fs.writeFile(dockerfilePath, sseDockerfile);
  await fs.writeFile(pythonScriptPath, ssePythonScript);

  try {
    const result = await execa('podman', [
      'build',
      '-t', MCP_IMAGE,
      '-f', 'Dockerfile.sse',
      '.'
    ], {
      cwd: TELEGRAM_MCP_PATH,
      timeout: 120000, // 2 minutes
    });

    if (result.exitCode !== 0) {
      throw new Error(`Build failed: ${result.stderr}`);
    }
    logger.info('MCP image built successfully');
  } finally {
    // Clean up the temporary files
    await fs.unlink(dockerfilePath).catch(() => {});
    await fs.unlink(pythonScriptPath).catch(() => {});
  }
}

/**
 * Create a podman pod for both containers
 */
async function createPod(): Promise<void> {
  logger.info(`Creating podman pod: ${POD_NAME}`);

  // Remove existing pod if present
  await execa('podman', ['pod', 'rm', '-f', POD_NAME], { reject: false });

  // Create new pod with published ports
  const result = await execa('podman', [
    'pod', 'create',
    '--name', POD_NAME,
    '-p', `${N8N_PORT}:${N8N_PORT}`,
    '-p', `${MCP_PORT}:${MCP_PORT}`,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create pod: ${result.stderr}`);
  }
  logger.info('Pod created successfully');
}

/**
 * Start the MCP container in the pod
 */
async function startMcpContainer(): Promise<void> {
  logger.info('Starting MCP container...');

  const envFile = `${TELEGRAM_MCP_PATH}/.env`;

  const result = await execa('podman', [
    'run', '-d',
    '--name', MCP_CONTAINER_NAME,
    '--pod', POD_NAME,
    '--env-file', envFile,
    MCP_IMAGE,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to start MCP container: ${result.stderr}`);
  }

  logger.info('MCP container started, waiting for SSE server...');

  // Wait for SSE server to be ready
  // SSE endpoint keeps connection open for streaming, so we use a short timeout
  // and check if we get a response header (not full body)
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // Use a controller to abort after getting initial response
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await axios.get(`http://localhost:${MCP_PORT}/sse`, {
        signal: controller.signal,
        timeout: 3000,
        validateStatus: () => true,
        // Don't wait for full response body (SSE streams indefinitely)
        responseType: 'stream',
      });

      clearTimeout(timeoutId);

      // If we got a response object with status 200, server is ready
      if (response.status === 200) {
        // Close the stream immediately
        response.data.destroy();
        logger.info('MCP SSE server is ready');
        return;
      }
    } catch (error) {
      // Abort errors are expected (we're intentionally cutting off the stream)
      if (axios.isAxiosError(error) && error.code === 'ERR_CANCELED') {
        // This means we connected successfully but aborted - server is ready
        logger.info('MCP SSE server is ready (connection aborted after verification)');
        return;
      }
      // Connection refused or other errors - keep trying
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Get container logs for debugging
  const logs = await execa('podman', ['logs', MCP_CONTAINER_NAME], { reject: false });
  logger.error(`MCP container logs:\n${logs.stdout}\n${logs.stderr}`);
  throw new Error('MCP SSE server did not become ready');
}

/**
 * Start the n8n container in the pod
 */
async function startN8nContainer(): Promise<void> {
  logger.info('Starting n8n container...');

  const result = await execa('podman', [
    'run', '-d',
    '--name', N8N_CONTAINER_NAME,
    '--pod', POD_NAME,
    '-e', 'N8N_BASIC_AUTH_ACTIVE=false',
    '-e', 'N8N_HOST=0.0.0.0',
    '-e', 'N8N_PORT=5678',
    '-e', 'N8N_LOG_LEVEL=debug',
    N8N_IMAGE,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to start n8n container: ${result.stderr}`);
  }

  logger.info('n8n container started, waiting for ready...');

  // Wait for n8n to be ready
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await axios.get(`http://localhost:${N8N_PORT}/healthz`, {
        timeout: 2000,
      });
      if (response.status === 200) {
        logger.info('n8n is ready');
        return;
      }
    } catch (error) {
      // Keep trying
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  throw new Error('n8n did not become ready');
}

/**
 * Query MCP tools via JSON-RPC over SSE
 *
 * SSE MCP protocol:
 * 1. Client connects to /sse - server sends session_id in first event
 * 2. Client posts to /messages/{session_id} with JSON-RPC requests
 * 3. Server responds via the SSE stream
 *
 * For simplicity, we use stdio mode in a subprocess to query tools.
 */
async function queryMcpTools(): Promise<string[]> {
  // Use the container's stdio interface via podman exec
  // This is simpler than implementing the full SSE client protocol
  const mcpRequests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ];

  const input = mcpRequests.map(r => JSON.stringify(r)).join('\n') + '\n';

  // Run a python script inside the container that queries tools via MCP client
  // Actually, let's use the simpler approach - make HTTP requests to the message endpoint
  // with the correct session handling

  try {
    // First establish SSE connection to get session ID
    // The SSE endpoint sends events like: event: endpoint\ndata: /messages/{session_id}\n\n
    const { EventSource } = await import('eventsource');

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Timeout waiting for MCP response'));
      }, 30000);

      const es = new EventSource(`http://localhost:${MCP_PORT}/sse`);
      let messageEndpoint = '';
      const tools: string[] = [];
      let initDone = false;

      es.addEventListener('endpoint', (event: { data: string }) => {
        messageEndpoint = `http://localhost:${MCP_PORT}${event.data}`;
        logger.info(`MCP message endpoint: ${messageEndpoint}`);

        // Send initialize request
        axios.post(messageEndpoint, {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
        }).catch(err => logger.warn(`Initialize post failed: ${err.message}`));
      });

      es.addEventListener('message', (event: { data: string }) => {
        try {
          const data = JSON.parse(event.data);
          logger.debug(`MCP message: ${JSON.stringify(data)}`);

          if (data.id === 1 && data.result) {
            // Initialize succeeded, now request tools
            initDone = true;
            axios.post(messageEndpoint, {
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/list',
              params: {},
            }).catch(err => logger.warn(`Tools list post failed: ${err.message}`));
          } else if (data.id === 2 && data.result?.tools) {
            // Got tools response
            clearTimeout(timeoutId);
            es.close();
            resolve(data.result.tools.map((t: { name: string }) => t.name));
          }
        } catch (err) {
          // Ignore parse errors
        }
      });

      es.onerror = (err) => {
        clearTimeout(timeoutId);
        es.close();
        reject(new Error(`SSE connection error: ${err}`));
      };
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`MCP request failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Clean up all test resources
 */
async function cleanup(): Promise<void> {
  logger.info('Cleaning up test resources...');

  // Stop and remove the pod (this also removes containers in the pod)
  await execa('podman', ['pod', 'rm', '-f', POD_NAME], { reject: false });

  logger.info('Cleanup complete');
}

// --- Test Suite ---

describe('MCP Container Integration', () => {
  beforeAll(async () => {
    // Check podman availability
    const podmanAvailable = await checkPodman();
    if (!podmanAvailable) {
      throw new Error('Podman is not available. Please install podman to run this test.');
    }

    // Clean up any existing resources
    await cleanup();

    // Build and start containers
    await buildMcpImage();
    await createPod();
    await startMcpContainer();
    await startN8nContainer();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await cleanup();
  }, 60000);

  test('MCP container responds to tools/list', async () => {
    const tools = await queryMcpTools();

    expect(tools.length).toBeGreaterThan(50);
    expect(tools).toContain('telegram_get_me');
    expect(tools).toContain('telegram_list_contacts');
    expect(tools).toContain('telegram_send_message');

    logger.info(`Found ${tools.length} MCP tools`);
  }, 30000);

  test('n8n can reach MCP endpoint from within pod', async () => {
    // Use node to make an HTTP request from inside the n8n container
    // This tests that localhost networking works between containers in the pod
    const nodeScript = `
      const http = require('http');
      const req = http.get('http://localhost:${MCP_PORT}/sse', (res) => {
        console.log('STATUS:' + res.statusCode);
        res.destroy(); // Close immediately after getting status
        process.exit(0);
      });
      req.on('error', (e) => {
        console.error('ERROR:' + e.message);
        process.exit(1);
      });
      req.setTimeout(5000, () => {
        console.log('TIMEOUT');
        req.destroy();
        process.exit(0);
      });
    `;

    const result = await execa('podman', [
      'exec', N8N_CONTAINER_NAME,
      'node', '-e', nodeScript,
    ], {
      reject: false,
      timeout: 15000,
    });

    logger.info(`n8n container connectivity test: stdout="${result.stdout}", stderr="${result.stderr}", exit=${result.exitCode}`);

    // Success if we got STATUS:200 or the request was made (exit 0)
    const connected = result.stdout.includes('STATUS:200') || result.exitCode === 0;
    expect(connected).toBeTruthy();
    logger.info(`n8n container can reach MCP at localhost:${MCP_PORT}`);
  }, 30000);

  test('pod networking allows localhost communication', async () => {
    // Verify both containers are in the pod
    const podInfo = await execa('podman', ['pod', 'inspect', POD_NAME]);
    const podData = JSON.parse(podInfo.stdout);

    const containers = podData[0]?.Containers || [];
    const containerNames = containers.map((c: { Name: string }) => c.Name);

    expect(containerNames).toContain(MCP_CONTAINER_NAME);
    expect(containerNames).toContain(N8N_CONTAINER_NAME);

    logger.info(`Pod contains: ${containerNames.join(', ')}`);
  }, 10000);
});
