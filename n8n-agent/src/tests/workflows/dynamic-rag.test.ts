import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { executeWorkflowTest, syncWorkflow } from '../../utils/workflow-test-runner';
import { 
  startN8nInstance, 
  stopN8nInstance, 
  checkPodmanAvailable,
  type N8nInstance 
} from '../../utils/n8n-podman';

describe('DynamicRAG', () => {
  let instance: N8nInstance | null = null;
  const testTimeout = 10 * 60 * 1000; // 10 minutes per test

  beforeAll(async () => {
    // Check if podman is available
    const podmanAvailable = await checkPodmanAvailable();
    if (!podmanAvailable) {
      throw new Error('Podman is not available. Please install podman to run integration tests.');
    }
  });

  beforeEach(async () => {
    // Start a fresh n8n instance for each test
    instance = await startN8nInstance({
      timeout: 120000, // 2 minutes for startup
    });
    
    // Sync the workflow to the instance
    const apiConfig = {
      baseURL: instance.baseUrl,
      apiKey: instance.apiKey,
    };
    await syncWorkflow('DynamicRAG', undefined, apiConfig);
  });

  afterEach(async () => {
    // Clean up instance after each test
    if (instance) {
      await stopN8nInstance(instance);
      instance = null;
    }
  });

  // Tests are ordered for proper execution (cleanup → create → use → delete)
  test.each([
    // 1. Status checks on existing collections
    {
      testCase: 'status',
      testData: {
        mode: 'STATUS',
        collectionId: 'paragon-os-contacts'
      }
    },
    {
      testCase: 'search-contacts',
      testData: {
        mode: 'SEARCH',
        collectionId: 'paragon-os-contacts',
        input: 'lanka'
      }
    },
    {
      testCase: 'search-metarune',
      testData: {
        mode: 'SEARCH',
        collectionId: 'paragon-os-knowledge',
        input: 'metarune'
      }
    },
    // 2. Delete test collection first (cleanup from previous runs)
    {
      testCase: 'cleanup-collection',
      testData: {
        mode: 'DELETE',
        collectionId: 'test-collection'
      }
    },
    // 3. Create test collection fresh
    {
      testCase: 'create-collection',
      testData: {
        mode: 'CREATE',
        collectionId: 'test-collection'
      }
    },
    // 4. Clear it (ensure empty)
    {
      testCase: 'clear-collection',
      testData: {
        mode: 'CLEAR',
        collectionId: 'test-collection'
      }
    },
    // 5. Insert test data
    {
      testCase: 'insert',
      testData: {
        mode: 'INSERT',
        collectionId: 'test-collection',
        input: {
          content: {
            testDocuments: [
              { id: 1, name: 'Alice Smith', role: 'Engineer', department: 'Backend' },
              { id: 2, name: 'Bob Johnson', role: 'Designer', department: 'Frontend' },
              { id: 3, name: 'Charlie Brown', role: 'Manager', department: 'Operations' }
            ]
          },
          metadata: { source: 'integration-test' }
        }
      }
    },
    // 6. Search the inserted data
    {
      testCase: 'search-test',
      testData: {
        mode: 'SEARCH',
        collectionId: 'test-collection',
        input: 'engineer backend'
      }
    },
    // 7. Delete collection (final cleanup)
    {
      testCase: 'delete-collection',
      testData: {
        mode: 'DELETE',
        collectionId: 'test-collection'
      }
    }
  ])('$testCase', async ({ testCase, testData }) => {
    if (!instance) {
      throw new Error('Instance not initialized');
    }

    const apiConfig = {
      baseURL: instance.baseUrl,
      apiKey: instance.apiKey,
    };

    const result = await executeWorkflowTest('DynamicRAG', testCase, testData, undefined, apiConfig);
    
    if (!result.success) {
      const errorMsg = result.error || 'Test failed with unknown error';
      const details = result.errorDetails ? `\nError details: ${JSON.stringify(result.errorDetails, null, 2)}` : '';
      throw new Error(`${errorMsg}${details}`);
    }
    
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  }, testTimeout);
});

