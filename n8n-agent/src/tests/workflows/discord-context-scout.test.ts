import { describe, test, expect, beforeAll } from 'vitest';
import { executeWorkflowTest, syncWorkflow } from '../../utils/workflow-test-runner';

describe('DiscordContextScout', () => {
  beforeAll(async () => {
    await syncWorkflow('DiscordContextScout');
  });

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
    const result = await executeWorkflowTest('DiscordContextScout', testCase, testData);
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    if (result.error) {
      throw new Error(result.error);
    }
  });
});

