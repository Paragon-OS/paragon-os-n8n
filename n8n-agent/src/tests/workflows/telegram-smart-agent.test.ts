import { describe, test, expect, beforeAll } from 'vitest';
import { executeWorkflowTest, syncWorkflow } from '../../utils/workflow-test-runner';

describe('TelegramSmartAgent', () => {
  beforeAll(async () => {
    await syncWorkflow('TelegramSmartAgent');
  });

  test.each([
    {
      testCase: 'search-messages',
      testData: {
        userPrompt: 'Search for messages about meeting'
      }
    },
    {
      testCase: 'find-message-content',
      testData: {
        userPrompt: 'Find messages containing the word "project" in my Telegram chats'
      }
    },
    {
      testCase: 'list-contacts',
      testData: {
        userPrompt: 'List my Telegram contacts'
      }
    },
    {
      testCase: 'simple-query',
      testData: {
        userPrompt: 'What is my Telegram profile?'
      }
    },
    {
      testCase: 'ingest-metarune-messages',
      testData: {
        userPrompt: 'List the last 10 messages from the metarune management chat, then properly ingest them into the RAG knowledge base for future retrieval. Format the messages clearly with sender names and timestamps before storing them.'
      }
    }
  ])('$testCase', async ({ testCase, testData }) => {
    const result = await executeWorkflowTest('TelegramSmartAgent', testCase, testData);
    
    if (!result.success) {
      const errorMsg = result.error || 'Test failed with unknown error';
      const details = result.errorDetails ? `\nError details: ${JSON.stringify(result.errorDetails, null, 2)}` : '';
      throw new Error(`${errorMsg}${details}`);
    }
    
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  });
});

