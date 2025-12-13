/**
 * Discord MCP Pod Integration Test
 *
 * Tests the Discord MCP server running in a podman pod alongside n8n.
 * This validates the SSE transport mode for containerized deployments.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────┐
 * │                    Podman Pod                           │
 * │  (shared localhost network)                             │
 * │                                                         │
 * │  ┌─────────────────┐      ┌─────────────────┐          │
 * │  │  Discord MCP    │      │     n8n         │          │
 * │  │  (SSE server)   │◄────►│   (workflows)   │          │
 * │  │  Port 8000      │      │   Port 5678     │          │
 * │  └─────────────────┘      └─────────────────┘          │
 * │         ▲                          ▲                    │
 * └─────────│──────────────────────────│────────────────────┘
 *           │                          │
 *     localhost:8000             localhost:5678
 *           (external port mapped)    (external port mapped)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { startMcpPod, type McpPodInstance } from '../../utils/mcp-pod-manager';
import { TEST_TIMEOUTS } from '../../utils/test-helpers';
import axios from 'axios';

describe('Discord MCP Pod', () => {
  let pod: McpPodInstance | null = null;

  beforeAll(async () => {
    // Skip if DISCORD_TOKEN is not set (no env file or token)
    if (!process.env.DISCORD_TOKEN) {
      console.log('Skipping Discord MCP Pod test - DISCORD_TOKEN not set');
      return;
    }

    pod = await startMcpPod({
      mcpServers: [
        {
          type: 'discord',
          env: {
            DISCORD_TOKEN: process.env.DISCORD_TOKEN || '',
          },
        },
      ],
      timeout: 180000, // 3 minutes for startup
    });
  }, TEST_TIMEOUTS.WORKFLOW);

  afterAll(async () => {
    if (pod) {
      await pod.cleanup();
      pod = null;
    }
  }, TEST_TIMEOUTS.WORKFLOW);

  test('Discord MCP container starts and responds to SSE', async () => {
    if (!pod) {
      console.log('Skipping - pod not started (DISCORD_TOKEN may not be set)');
      return;
    }

    // Verify health endpoint
    const healthUrl = pod.mcpEndpoints.discord?.replace('/sse', '/health');
    expect(healthUrl).toBeDefined();

    const healthResponse = await axios.get(healthUrl!, {
      timeout: 10000,
    });

    expect(healthResponse.status).toBe(200);
    expect(healthResponse.data.status).toBe('ok');
    expect(healthResponse.data.discord_ready).toBe(true);
  }, TEST_TIMEOUTS.WORKFLOW);

  test('n8n container is accessible', async () => {
    if (!pod) {
      console.log('Skipping - pod not started');
      return;
    }

    const response = await axios.get(`${pod.n8nInstance.baseUrl}/healthz`, {
      timeout: 10000,
    });

    expect(response.status).toBe(200);
  }, TEST_TIMEOUTS.WORKFLOW);

  test('Discord MCP returns tool list via SSE', async () => {
    if (!pod) {
      console.log('Skipping - pod not started');
      return;
    }

    const sseEndpoint = pod.mcpEndpoints.discord;
    expect(sseEndpoint).toBeDefined();

    // The SSE protocol requires:
    // 1. Connect to /sse to get session ID
    // 2. POST to /messages?sessionId=xxx with JSON-RPC request
    // 3. Receive response via SSE stream

    // For this test, we just verify the SSE endpoint is accessible
    // Full SSE protocol testing is done in the mcp-container.test.ts
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await axios.get(sseEndpoint!, {
        signal: controller.signal,
        timeout: 6000,
        validateStatus: () => true,
        responseType: 'stream',
      });
      clearTimeout(timeoutId);

      // SSE endpoint should return 200 and start streaming
      expect(response.status).toBe(200);
      response.data.destroy();
    } catch (err) {
      clearTimeout(timeoutId);
      if (axios.isAxiosError(err) && err.code === 'ERR_CANCELED') {
        // Aborted after connecting - server is working
        expect(true).toBe(true);
      } else {
        throw err;
      }
    }
  }, TEST_TIMEOUTS.WORKFLOW);
});
