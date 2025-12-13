import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { executeWorkflowTest } from '../../utils/workflow-test-runner';
import {
  setupTestInstanceSmart,
  cleanupTestInstanceSmart,
  TEST_TIMEOUTS,
  type N8nInstance
} from '../../utils/test-helpers';

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
 * 1. Local n8n (recommended for MCP workflows):
 *    - Set USE_LOCAL_N8N=true in environment
 *    - MCP spawns as a local subprocess (faster, more reliable)
 *    - Requires local n8n running with MCP credentials configured
 *
 * 2. Container mode (for CI/CD):
 *    - Uses podman containers with SSE transport
 *    - MCP runs in a separate container in the same pod
 *    - Slower but fully isolated
 */
describe('DiscordContextScout', () => {
  let instance: N8nInstance | null = null;

  beforeAll(async () => {
    // Use smart setup - prefers local n8n if USE_LOCAL_N8N=true,
    // otherwise falls back to container with auto-mounted MCP directories
    instance = await setupTestInstanceSmart();
    // Note: executeWorkflowTest() auto-imports all helper workflows in correct dependency order
  }, TEST_TIMEOUTS.WORKFLOW);

  afterAll(async () => {
    await cleanupTestInstanceSmart(instance);
    instance = null;
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

    const result = await executeWorkflowTest('Discord Context Scout', testCase, testData, undefined, instance);

    if (!result.success) {
      const errorMsg = result.error || 'Test failed with unknown error';
      const details = result.errorDetails ? `\nError details: ${JSON.stringify(result.errorDetails, null, 2)}` : '';
      throw new Error(`${errorMsg}${details}`);
    }

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  }, TEST_TIMEOUTS.WORKFLOW);
});
