import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { executeWorkflowTest } from '../../utils/workflow-test-runner';
import {
  cleanupTestInstanceSmart,
  connectToLocalN8n,
  TEST_TIMEOUTS,
  type N8nInstance
} from '../../utils/test-helpers';
import { startMcpPod, type McpPodInstance } from '../../utils/mcp-pod-manager';
import { type McpSseCredentialMapping } from '../../utils/workflow-reference-converter';

/**
 * Discord Context Scout Workflow Tests
 *
 * These tests verify the Discord Context Scout workflow can:
 * - Search contacts by fuzzy name matching
 * - Look up guilds
 * - Query available tools
 * - Retrieve the authenticated user's profile
 *
 * TESTING MODES:
 * 1. Local n8n (recommended for fast iteration):
 *    - Set USE_LOCAL_N8N=true in environment
 *    - MCP spawns as a local subprocess (faster, more reliable)
 *    - Requires local n8n running with MCP credentials configured
 *
 * 2. MCP Pod mode (for CI/CD - default):
 *    - Creates a podman pod with Discord MCP (SSE) + n8n containers
 *    - MCP runs on port 8000 within the pod
 *    - Fully isolated, no local dependencies
 */

// Get Discord token from environment
function getDiscordToken(): string | undefined {
  if (process.env.DISCORD_TOKEN) {
    return process.env.DISCORD_TOKEN;
  }
  const mcpEnv = process.env.DISCORD_MCP_ENV;
  if (mcpEnv) {
    try {
      const parsed = JSON.parse(mcpEnv);
      if (parsed.DISCORD_TOKEN) {
        return parsed.DISCORD_TOKEN;
      }
    } catch {
      // Not valid JSON
    }
  }
  return undefined;
}

describe('DiscordContextScout', () => {
  let instance: N8nInstance | null = null;
  let mcpPod: McpPodInstance | null = null;
  let mcpCredentialMappings: McpSseCredentialMapping[] = [];

  beforeAll(async () => {
    // Check for Discord token
    const discordToken = getDiscordToken();
    if (!discordToken) {
      console.log('⚠️  DISCORD_TOKEN not set - tests will be skipped');
      return;
    }

    if (process.env.USE_LOCAL_N8N === 'true') {
      // Local mode: use local n8n with STDIO MCP
      console.log('🏠 Using local n8n mode');
      instance = await connectToLocalN8n();
      // No credential rewriting needed - local uses STDIO directly
    } else {
      // Pod mode: start MCP pod with Discord MCP + n8n
      console.log('🐳 Starting MCP pod with Discord MCP + n8n...');
      mcpPod = await startMcpPod({
        mcpServers: [
          {
            type: 'discord',
            env: { DISCORD_TOKEN: discordToken },
          },
        ],
        timeout: 180000, // 3 minutes for startup
      });
      instance = mcpPod.n8nInstance;
      mcpCredentialMappings = mcpPod.mcpCredentialMappings;
      console.log(`✅ MCP pod ready: ${mcpPod.podName}`);
      console.log(`   n8n: ${instance.baseUrl}`);
      console.log(`   Discord MCP (internal): ${mcpPod.mcpEndpointsInternal.discord}`);
      console.log(`   Credential mappings: ${mcpCredentialMappings.length}`);
    }
    // Note: executeWorkflowTest() auto-imports all helper workflows in correct dependency order
  }, TEST_TIMEOUTS.WORKFLOW);

  afterAll(async () => {
    if (mcpPod) {
      console.log('🧹 Cleaning up MCP pod...');
      await mcpPod.cleanup();
      mcpPod = null;
      instance = null;
    } else if (instance) {
      await cleanupTestInstanceSmart(instance);
      instance = null;
    }
  }, TEST_TIMEOUTS.WORKFLOW);

  test.each([
    {
      testCase: 'contact-fuzzy',
      testData: {
        query: 'hubert',
        entity: 'contact'
      }
    },
    {
      testCase: 'guild-search',
      testData: {
        query: 'test',
        entity: 'guild'
      }
    },
    {
      testCase: 'tool-lookup',
      testData: {
        query: 'read',
        entity: 'tool'
      }
    },
    {
      testCase: 'self-profile',
      testData: {
        query: '',
        entity: 'self'
      }
    },
    {
      testCase: 'contact-empty-query',
      testData: {
        query: '',
        entity: 'contact'
      }
    }
  ])('$testCase', async ({ testCase, testData }) => {
    if (!instance) {
      throw new Error('Instance not initialized');
    }

    // Note: Use 'DiscordContextScout' (no spaces) to match Test Runner routing
    // Pass credential mappings to rewrite STDIO credentials to SSE for pod mode
    const result = await executeWorkflowTest(
      'DiscordContextScout',
      testCase,
      testData,
      undefined,
      instance,
      { mcpCredentialMappings }
    );

    if (!result.success) {
      const errorMsg = result.error || 'Test failed with unknown error';
      const details = result.errorDetails ? `\nError details: ${JSON.stringify(result.errorDetails, null, 2)}` : '';
      throw new Error(`${errorMsg}${details}`);
    }

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  }, TEST_TIMEOUTS.WORKFLOW);
});
