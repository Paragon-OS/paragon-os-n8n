import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { executeWorkflowTest, syncWorkflow } from '../../utils/workflow-test-runner';
import { 
  setupTestInstance, 
  cleanupTestInstance, 
  resetTestInstance, 
  TEST_TIMEOUTS,
  type N8nInstance 
} from '../../utils/test-helpers';

describe('DiscordContextScout', () => {
  let instance: N8nInstance | null = null;

  beforeAll(async () => {
    instance = await setupTestInstance();
    // Sync workflows once before all tests (import dependencies first)
    if (instance) {
      // Import dependency workflow first
      await syncWorkflow('Generic Context Scout Core', undefined, instance);
      // Then import the main workflow
      await syncWorkflow('DiscordContextScout', undefined, instance);
    }
  }, TEST_TIMEOUTS.WORKFLOW);

  afterAll(async () => {
    await cleanupTestInstance(instance);
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

    const result = await executeWorkflowTest('DiscordContextScout', testCase, testData, undefined, instance);
    
    if (!result.success) {
      const errorMsg = result.error || 'Test failed with unknown error';
      const details = result.errorDetails ? `\nError details: ${JSON.stringify(result.errorDetails, null, 2)}` : '';
      throw new Error(`${errorMsg}${details}`);
    }
    
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  }, TEST_TIMEOUTS.WORKFLOW);
});

