import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { executeWorkflowTest, syncWorkflow } from '../../utils/workflow-test-runner';
import { 
  setupTestInstance, 
  cleanupTestInstance, 
  resetTestInstance, 
  TEST_TIMEOUTS,
  type N8nInstance 
} from '../../utils/test-helpers';

describe('TelegramContextScout', () => {
  let instance: N8nInstance | null = null;

  beforeAll(async () => {
    instance = await setupTestInstance();
    // Sync workflow once before all tests
    if (instance) {
      await syncWorkflow('TelegramContextScout', undefined, instance);
    }
  }, TEST_TIMEOUTS.WORKFLOW);

  afterAll(async () => {
    await cleanupTestInstance(instance);
    instance = null;
  }, TEST_TIMEOUTS.WORKFLOW);

  beforeEach(async () => {
    await resetTestInstance(instance);
    // Re-sync workflow after reset (reset clears all workflows)
    if (instance) {
      await syncWorkflow('TelegramContextScout', undefined, instance);
    }
  }, TEST_TIMEOUTS.WORKFLOW);

  test.each([
    {
      testCase: 'contact-rag',
      testData: {
        query: 'sebastian',
        entity: 'contact'
      }
    },
    {
      testCase: 'message-rag',
      testData: {
        query: 'meeting',
        entity: 'message-rag'
      }
    },
    {
      testCase: 'chat-with-all-params',
      testData: {
        query: 'metarune management',
        entity: 'chat'
      }
    },
    {
      testCase: 'all-entities-test',
      testData: {
        query: 'test',
        entity: 'contact'
      }
    },
    {
      testCase: 'contact-search',
      testData: {
        query: 'lanka',
        entity: 'contact'
      }
    },
    {
      testCase: 'chat-search',
      testData: {
        query: 'metarune',
        entity: 'chat'
      }
    },
    {
      testCase: 'tool-lookup',
      testData: {
        query: 'send message',
        entity: 'tool'
      }
    },
    {
      testCase: 'self-profile',
      testData: {
        query: '',
        entity: 'self'
      }
    }
  ])('$testCase', async ({ testCase, testData }) => {
    if (!instance) {
      throw new Error('Instance not initialized');
    }

    const result = await executeWorkflowTest('TelegramContextScout', testCase, testData, undefined, instance);
    
    if (!result.success) {
      const errorMsg = result.error || 'Test failed with unknown error';
      const details = result.errorDetails ? `\nError details: ${JSON.stringify(result.errorDetails, null, 2)}` : '';
      throw new Error(`${errorMsg}${details}`);
    }
    
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  }, TEST_TIMEOUTS.WORKFLOW);
});

