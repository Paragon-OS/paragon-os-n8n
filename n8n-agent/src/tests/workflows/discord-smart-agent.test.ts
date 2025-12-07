import { describe, test, expect, beforeAll } from 'vitest';
import { executeWorkflowTest, syncWorkflow } from '../../utils/workflow-test-runner';

describe('DiscordSmartAgent', () => {
  beforeAll(async () => {
    await syncWorkflow('DiscordSmartAgent');
  });

  // Note: Tests that require multiple MCP tool calls (like read-messages)
  // may be slow because each MCP call initializes a new Discord client connection.
  test.each([
    {
      testCase: 'simple-query',
      testData: {
        userPrompt: 'What is my Discord profile?'
      }
    },
    {
      testCase: 'list-contacts',
      testData: {
        userPrompt: 'List my Discord contacts'
      }
    },
    {
      testCase: 'read-messages',
      testData: {
        userPrompt: 'Show me the 5 most recent messages from my most recent Discord DM'
      }
    }
  ])('$testCase', async ({ testCase, testData }) => {
    const result = await executeWorkflowTest('DiscordSmartAgent', testCase, testData);
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    if (result.error) {
      throw new Error(result.error);
    }
  });
});

