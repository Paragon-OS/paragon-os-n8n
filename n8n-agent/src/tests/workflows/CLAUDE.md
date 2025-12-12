# Workflow Tests

Tests that execute actual n8n workflows using the **Test Runner** helper workflow pattern. These tests verify end-to-end workflow behavior by calling workflows via webhook and validating output.

## Test Runner Architecture

```
┌─────────────────┐     HTTP POST      ┌─────────────────┐
│   Vitest Test   │ ─────────────────► │   Test Runner   │
│                 │    /webhook/       │    Workflow     │
│ executeWorkflow │    test-runner     │                 │
│     Test()      │                    │ ⚙️ Test Config  │
└─────────────────┘                    └────────┬────────┘
                                                │
                                    ┌───────────┴───────────┐
                                    │   Load Test Data      │
                                    │   (calls Test Data    │
                                    │    workflow)          │
                                    └───────────┬───────────┘
                                                │
                                    ┌───────────┴───────────┐
                                    │   Route to Target     │
                                    │   Workflow            │
                                    └───────────┬───────────┘
                                                │
                            ┌───────────────────┼───────────────────┐
                            ▼                   ▼                   ▼
                    ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
                    │  DynamicRAG   │   │ DiscordContext│   │   Other       │
                    │               │   │    Scout      │   │   Workflows   │
                    └───────────────┘   └───────────────┘   └───────────────┘
```

## How Test Execution Works

1. **Test calls `executeWorkflowTest()`** with workflow name, test case ID, and test data
2. **Test Runner workflow is modified** with the test configuration in `⚙️ Test Config` node
3. **Test Runner is imported and activated** to enable webhook
4. **HTTP POST to `/webhook/test-runner`** triggers execution
5. **Test Runner loads test data** from the `Test Data` helper workflow
6. **Routes to target workflow** based on workflow name in config
7. **Target workflow executes** with merged test data
8. **Response returned** via webhook responseMode: lastNode

## Test Files

| Test File | Workflow Under Test | Test Cases |
|-----------|---------------------|------------|
| `discord-context-scout.test.ts` | DiscordContextScout | contact-fuzzy, guild-search, tool-lookup, self-profile, contact-empty-query |
| `dynamic-rag.test.ts` | DynamicRAG | status, search-contacts, search-metarune, cleanup/create/clear/insert/search/delete collection |

## Writing a Workflow Test

### Basic Pattern (Container Reuse)

```typescript
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { executeWorkflowTest, syncWorkflow } from '../../utils/workflow-test-runner';
import {
  setupTestInstance,
  cleanupTestInstance,
  TEST_TIMEOUTS,
  type N8nInstance
} from '../../utils/test-helpers';

describe('MyWorkflow', () => {
  let instance: N8nInstance | null = null;

  beforeAll(async () => {
    instance = await setupTestInstance();
    // Sync dependency workflows first
    await syncWorkflow('DependencyWorkflow', undefined, instance);
    // Then sync the workflow under test
    await syncWorkflow('MyWorkflow', undefined, instance);
  }, TEST_TIMEOUTS.WORKFLOW);

  afterAll(async () => {
    await cleanupTestInstance(instance);
    instance = null;
  }, TEST_TIMEOUTS.WORKFLOW);

  test.each([
    {
      testCase: 'test-case-1',
      testData: { param1: 'value1', param2: 'value2' }
    },
    {
      testCase: 'test-case-2',
      testData: { param1: 'other', param2: 'values' }
    },
  ])('$testCase', async ({ testCase, testData }) => {
    if (!instance) throw new Error('Instance not initialized');

    const result = await executeWorkflowTest(
      'MyWorkflow',      // Workflow name (must match workflow's "name" field)
      testCase,          // Test case ID
      testData,          // Data to pass to workflow
      undefined,         // Use default workflows directory
      instance           // n8n instance
    );

    if (!result.success) {
      const errorMsg = result.error || 'Test failed with unknown error';
      const details = result.errorDetails
        ? `\nError details: ${JSON.stringify(result.errorDetails, null, 2)}`
        : '';
      throw new Error(`${errorMsg}${details}`);
    }

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  }, TEST_TIMEOUTS.WORKFLOW);
});
```

### Test Result Structure

```typescript
interface WorkflowTestResult {
  testCase: string;       // The test case ID
  success: boolean;       // Whether execution succeeded
  output?: unknown;       // Workflow output on success
  error?: string;         // Error message on failure
  errorDetails?: unknown; // Full error object (includes container logs on failure)
}
```

## Helper Workflows

Tests depend on these helper workflows in `workflows/HELPERS/`:

| Workflow | Purpose | Dependencies |
|----------|---------|--------------|
| **Test Runner** | Routes test execution to target workflows | Test Data, Dynamic RAG |
| **Test Data** | Provides test case data | None |
| **Dynamic RAG** | Vector database operations | Qdrant credentials |
| **Generic Context Scout Core** | Shared context scout logic | Entity Cache Handler, Dynamic RAG |
| **Entity Cache Handler** | Redis caching for entities | Global Cache System |
| **Global Cache System** | Redis connection management | Redis credentials |
| **MCP Data Normalizer** | Normalizes MCP tool responses | None |
| **Discord Contact Fetch** | Fetches Discord contacts via MCP | MCP Data Normalizer |
| **Discord Guild Fetch** | Fetches Discord guilds via MCP | MCP Data Normalizer |
| **Telegram Contact Fetch** | Fetches Telegram contacts via MCP | MCP Data Normalizer |
| **Telegram Chat Fetch** | Fetches Telegram chats via MCP | MCP Data Normalizer |
| **Telegram Message Fetch** | Fetches Telegram messages via MCP | MCP Data Normalizer |

### Dependency Order

When syncing workflows, dependencies must be imported first:

```typescript
// workflow-test-runner.ts imports in this order:
const dependencyOrder = [
  'Global Cache System',           // No dependencies - first
  'MCP Data Normalizer',          // No dependencies
  'Test Data',                     // No dependencies
  'Dynamic RAG',                   // No dependencies
  'Entity Cache Handler',          // Depends on Global Cache System
  'Discord & Telegram Step Executor',
  'Discord Contact Fetch',         // Depends on MCP Data Normalizer
  'Discord Guild Fetch',
  'Discord Profile Fetch',
  'Discord Tool Fetch',
  'Telegram Chat Fetch',
  'Telegram Contact Fetch',
  'Telegram Message Fetch',
  'Telegram Profile Fetch',
  'Telegram Tool Fetch',
  'Generic Context Scout Core',    // Depends on Entity Cache Handler, Dynamic RAG
  'Test Runner',                   // Depends on Test Data, Dynamic RAG - last
];
```

## Adding a New Workflow Test

### 1. Add test data to Test Data workflow

Edit `workflows/HELPERS/Test Data.json` to add your test cases:

```json
{
  "MyWorkflow": {
    "test-case-1": {
      "param1": "value1",
      "expectedOutput": "something"
    },
    "test-case-2": {
      "param1": "different",
      "expectedOutput": "other"
    }
  }
}
```

### 2. Add routing in Test Runner workflow

Edit `workflows/HELPERS/Test Runner.json` to add a route for your workflow:

1. Find the "Route to Workflow" switch node
2. Add a new condition for `workflow === "MyWorkflow"`
3. Connect to an "Execute Workflow" node that calls your workflow

### 3. Create the test file

```typescript
// src/tests/workflows/my-workflow.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { executeWorkflowTest, syncWorkflow } from '../../utils/workflow-test-runner';
import {
  setupTestInstance,
  cleanupTestInstance,
  TEST_TIMEOUTS,
  type N8nInstance
} from '../../utils/test-helpers';

describe('MyWorkflow', () => {
  let instance: N8nInstance | null = null;

  beforeAll(async () => {
    instance = await setupTestInstance();
    // Sync any dependencies your workflow needs
    await syncWorkflow('MyWorkflow', undefined, instance);
  }, TEST_TIMEOUTS.WORKFLOW);

  afterAll(async () => {
    await cleanupTestInstance(instance);
    instance = null;
  }, TEST_TIMEOUTS.WORKFLOW);

  test.each([
    { testCase: 'test-case-1', testData: { param1: 'value1' } },
    { testCase: 'test-case-2', testData: { param1: 'different' } },
  ])('$testCase', async ({ testCase, testData }) => {
    if (!instance) throw new Error('Instance not initialized');

    const result = await executeWorkflowTest('MyWorkflow', testCase, testData, undefined, instance);

    if (!result.success) {
      throw new Error(result.error || 'Test failed');
    }

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  }, TEST_TIMEOUTS.WORKFLOW);
});
```

## Custom n8n Image Requirement

Workflow tests that use custom nodes (FuzzySearch, JsonDocumentLoader) require the custom n8n image:

```bash
# Build the custom image first
./docker/build-custom-image.sh

# Image is automatically used by setupTestInstance()
# See docker/CLAUDE.md for details on the custom image
```

If you see `"Unrecognized node type: n8n-nodes-paragon-os.fuzzySearch"`, the custom image is either:
- Not built (`podman images | grep n8n-paragon-os`)
- Not loading nodes correctly (see docker/CLAUDE.md troubleshooting)

## Debugging Workflow Tests

### Test fails with webhook error

```
Webhook execution failed: Request failed with status code 404
```

The Test Runner workflow isn't activated. Check:
1. Workflow was imported: Look for "Test Runner imported with ID: ..."
2. Workflow was activated: Look for "Test Runner activated"
3. Webhook registered: 2-second wait happens after activation

### Empty output error

```
Workflow returned empty output (possible error in sub-workflow)
```

The target workflow ran but produced no output. Check:
1. Target workflow exists and is imported
2. Routing in Test Runner is correct
3. Target workflow output node returns data

### Container logs

On webhook failure, container logs are automatically captured:

```typescript
if (!result.success && result.errorDetails?.containerLogs) {
  console.log('Container logs:', result.errorDetails.containerLogs);
}
```

### Manual debugging

```bash
# Start a debug container
podman run -d --name n8n-debug -p 5678:5678 \
  -e N8N_LOG_LEVEL=debug \
  localhost/n8n-paragon-os:latest

# Watch logs in real-time
podman logs -f n8n-debug

# Access n8n UI at http://localhost:5678
# Login: setup a user, then manually run workflows
```

## Test Data Patterns

### Entity Query Tests (Context Scout)

```typescript
{
  testCase: 'contact-fuzzy',
  testData: {
    query: 'partial name',    // Fuzzy search query
    entity: 'contact'         // Entity type: contact, guild, tool, self
  }
}
```

### RAG Operations Tests (Dynamic RAG)

```typescript
// Status check
{ testCase: 'status', testData: { mode: 'STATUS', collectionId: 'collection-name' } }

// Search
{ testCase: 'search', testData: { mode: 'SEARCH', collectionId: 'x', input: 'query' } }

// Create collection
{ testCase: 'create', testData: { mode: 'CREATE', collectionId: 'new-collection' } }

// Insert documents
{
  testCase: 'insert',
  testData: {
    mode: 'INSERT',
    collectionId: 'x',
    input: {
      content: { documents: [{ id: 1, text: 'doc1' }] },
      metadata: { source: 'test' }
    }
  }
}

// Clear collection
{ testCase: 'clear', testData: { mode: 'CLEAR', collectionId: 'x' } }

// Delete collection
{ testCase: 'delete', testData: { mode: 'DELETE', collectionId: 'x' } }
```

## Environment Requirements

These environment variables must be set for workflow tests:

```bash
# Required for RAG tests
QDRANT_URL=https://your-instance.cloud.qdrant.io:6333
QDRANT_API_KEY=your-key

# Required for LLM-powered workflows
GOOGLE_GEMINI_API_KEY=your-key

# Required for cache-enabled workflows
REDIS_HOST=localhost
REDIS_PORT=6379
```

Missing credentials will cause specific workflows to fail. The test framework injects these as n8n credentials during container setup.
