import { describe, test, expect, beforeAll } from 'vitest';
import { executeWorkflowTest, syncWorkflow } from '../../utils/workflow-test-runner';

describe('TelegramContextScout', () => {
  beforeAll(async () => {
    await syncWorkflow('TelegramContextScout');
  });

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
    const result = await executeWorkflowTest('TelegramContextScout', testCase, testData);
    
    if (!result.success) {
      const errorMsg = result.error || 'Test failed with unknown error';
      const details = result.errorDetails ? `\nError details: ${JSON.stringify(result.errorDetails, null, 2)}` : '';
      throw new Error(`${errorMsg}${details}`);
    }
    
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  });
});

