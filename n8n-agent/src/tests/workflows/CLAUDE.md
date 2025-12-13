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
import { executeWorkflowTest } from '../../utils/workflow-test-runner';
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
    // NOTE: Do NOT manually call syncWorkflow() here!
    // executeWorkflowTest() auto-imports all helper workflows in correct dependency order
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

### IMPORTANT: Do NOT Use syncWorkflow() in beforeAll

**Why?** `syncWorkflow()` imports a single workflow without its transitive dependencies. This causes broken workflow references because:

1. Workflow JSON files contain **hardcoded workflow IDs** from the original n8n instance
2. When imported to a fresh test container, workflows get **new IDs**
3. The reference converter rewrites these IDs, but only if dependencies are already imported
4. If you import `Generic Context Scout Core` before `Dynamic RAG`, the reference to Dynamic RAG can't be resolved

**The Fix:** Let `executeWorkflowTest()` handle all imports. It:
1. Imports ALL helper workflows from `workflows/HELPERS/` in correct dependency order
2. Imports the target workflow being tested
3. Rewrites workflow references to use the new container's IDs

**Symptoms of broken references:**
```
⚠️ Could not resolve workflow reference "BVI8WfWulWFCFvwk" to an ID, keeping as-is
Error: No item to return was found
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
import { executeWorkflowTest } from '../../utils/workflow-test-runner';
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
    // executeWorkflowTest() handles all workflow imports automatically
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

### Workflow Reference Errors

```
⚠️ Could not resolve workflow reference "BVI8WfWulWFCFvwk" to an ID, keeping as-is
Error: No item to return was found
```

**Root Cause:** Workflow references are broken because dependencies weren't imported in the correct order.

**How workflow references work:**
1. Workflow JSON files contain `workflowId` fields with hardcoded IDs (e.g., `"value": "BVI8WfWulWFCFvwk"`)
2. These IDs are from the original n8n instance where workflows were created
3. When imported to a fresh test container, workflows get NEW database IDs
4. The `workflow-reference-converter.ts` rewrites old IDs → new IDs using `cachedResultName` (workflow name)
5. BUT this only works if the referenced workflow is ALREADY imported

**Solution:** Don't manually call `syncWorkflow()`. Let `executeWorkflowTest()` handle imports.

**To verify references are being rewritten correctly, look for:**
```
🔄 Rewriting workflow reference: "BVI8WfWulWFCFvwk" → "a4AQxibvAESCiaDe"
```

### Workflow IDs in JavaScript Code (fetchWorkflowId)

Some workflows embed workflow IDs directly in JavaScript code within Code nodes (e.g., Discord Context Scout, Telegram Context Scout). These IDs are stored as string literals and can't be detected by n8n's native reference resolution.

**Example problem pattern in Code node:**
```javascript
// This ID is hardcoded and won't be rewritten automatically!
const DISCORD_CONFIG = {
  entities: {
    "contact": {
      fetchWorkflowId: "JateTZIxaU5RpWd1",  // OLD ID - breaks in new container
      // ...
    }
  }
};
```

**Solution:** Add a comment with the workflow name after the ID:
```javascript
const DISCORD_CONFIG = {
  entities: {
    "contact": {
      fetchWorkflowId: "JateTZIxaU5RpWd1", // [HELPERS] Discord Contact Fetch
      // ...
    }
  }
};
```

The `workflow-reference-converter.ts` has a `rewriteFetchWorkflowIdsInJsCode()` function that:
1. Scans Code nodes for the pattern: `fetchWorkflowId: "ID", // [HELPERS] Workflow Name`
2. Looks up the new ID by workflow name
3. Rewrites the old ID to the new ID

**To verify these are being rewritten, look for:**
```
🔄 Rewrote fetchWorkflowId in Code node: "JateTZIxaU5RpWd1" → "YnlDm59gNQS0hp7k" ([HELPERS] Discord Contact Fetch)
```

**If you add new workflows that are called dynamically from Code nodes:**
1. Use `fetchWorkflowId` as the key name
2. Add a comment with `// [HELPERS] Exact Workflow Name` immediately after the ID
3. Ensure the comment matches the workflow's exact `name` field in the JSON

### Test fails with webhook error

```
Webhook execution failed: Request failed with status code 404
```

The Test Runner workflow isn't activated. Check:
1. Workflow was imported: Look for "Test Runner imported with ID: ..."
2. Workflow was activated: Look for "Test Runner activated"
3. Webhook registered: 2-second wait happens after activation

### "No item to return was found" error

```
Error in handling webhook request POST /webhook/test-runner: No item to return was found
```

This means the Test Runner workflow executed, but the "Respond to Webhook" node received no data. Causes:
1. **Broken workflow references** - Most common! Check for `⚠️ Could not resolve workflow reference` warnings
2. **Routing not configured** - The Test Runner switch node doesn't have a route for your workflow
3. **Sub-workflow returns empty** - The target workflow executed but returned no output

### Empty output error

```
Workflow returned empty output (possible error in sub-workflow)
```

The target workflow ran but produced no output. Check:
1. Target workflow exists and is imported
2. Routing in Test Runner is correct
3. Target workflow output node returns data

### Container logs and n8n debug logging

Test containers run with enhanced logging:
- `N8N_LOG_LEVEL=debug` - Detailed execution logging
- `N8N_LOG_OUTPUT=console,file` - Logs to stdout AND `/home/node/.n8n/n8n.log`

On webhook failure, these are automatically captured in `errorDetails`:
- `containerLogs` - Container stdout/stderr (last 500 lines)
- `n8nLogs` - n8n log file content
- `executionId`, `executionStatus`, `failedNodes` - From execution history API

```typescript
if (!result.success && result.errorDetails) {
  console.log('Container logs:', result.errorDetails.containerLogs);
  console.log('n8n logs:', result.errorDetails.n8nLogs);
  console.log('Failed nodes:', result.errorDetails.failedNodes);
}
```

### Workflow Test Runner Logging

The `executeWorkflowTest()` function logs detailed webhook and execution info:

**Webhook request/response:**
```
🌐 WEBHOOK REQUEST: POST http://localhost:50000/webhook/test-runner
   Workflow: DynamicRAG, TestCase: status
✅ WEBHOOK RESPONSE: 200 (1234ms)
```

**Execution lifecycle (on success):**
```
📊 EXECUTION SAVED: ID=1, status=success, workflow=gS11X4tiyb4SgqWA, duration=27ms
```

**On failure:**
```
❌ WEBHOOK FAILED after 120000ms
📋 CONTAINER LOGS: ...
📋 N8N LOG FILE: ...
📋 EXECUTION ERROR: ...
📋 FAILED NODES: ...
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

### Checking execution history

Executions are saved and can be queried via the REST API. **Note the nested response structure:**

```typescript
const response = await axios.get(
  `${instance.baseUrl}/rest/executions`,
  { headers: { Cookie: instance.sessionCookie }, params: { limit: 10 } }
);

// IMPORTANT: Executions are in response.data.data.results, NOT response.data.data
const executions = response.data?.data?.results || [];
```

Container logs show detailed execution lifecycle for debugging:
```
Received webhook "POST" for path "test-runner"
Execution added {"executionId":"1"...}
Start executing node "Webhook"
Running node "Webhook" finished successfully
Save execution progress to database for execution ID 1
Workflow execution finished successfully
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

# Required for MCP-based workflows (Discord, Telegram)
DISCORD_MCP_COMMAND=node
DISCORD_MCP_ARGS=/path/to/discord-self-mcp/dist/index.js
DISCORD_MCP_ENV={"DISCORD_TOKEN":"your-discord-token"}

# For local n8n testing (recommended for MCP workflows)
USE_LOCAL_N8N=true
N8N_URL=http://localhost:5678
N8N_API_KEY=your-api-key
N8N_SESSION_COOKIE=your-session-cookie
```

Missing credentials will cause specific workflows to fail. The test framework injects these as n8n credentials during container setup.

## MCP Workflow Testing

Workflows using MCP nodes (Discord Contact Fetch, Telegram Chat Fetch, etc.) require special handling because they spawn external processes.

### Testing Approaches

**1. Local n8n Mode (Recommended for Development)**

Use local n8n with STDIO-based MCP credentials. MCP spawns as a local subprocess.

```bash
# Start n8n locally
n8n start

# Configure environment
USE_LOCAL_N8N=true
N8N_URL=http://localhost:5678
N8N_SESSION_COOKIE=your-session-cookie  # From browser DevTools

# Run tests
npx vitest run src/tests/workflows/discord-context-scout.test.ts
```

**Advantages:**
- Fast (~4 seconds per test)
- MCP processes spawn directly on your machine
- All existing credentials work
- Easy debugging

**Disadvantages:**
- Requires local n8n running
- Not suitable for CI/CD

**2. Pod-Based SSE Mode (For CI/CD)**

Run both n8n and MCP servers in a podman pod using SSE transport.

```typescript
import { startMcpPod } from '../../utils/mcp-pod-manager';

const pod = await startMcpPod({
  mcpServers: [{ type: 'discord' }],
});
// pod.n8nInstance - n8n container
// pod.mcpEndpoints.discord - SSE endpoint (http://localhost:8000/sse)
```

**Advantages:**
- Fully isolated
- Works in CI/CD
- No local dependencies

**Disadvantages:**
- Slower (~2+ minutes for startup)
- Requires credential rewriting (STDIO → SSE)

### Why STDIO Doesn't Work in Containers

MCP nodes with STDIO transport spawn external processes:
1. The MCP script path is a host path (e.g., `/Users/.../discord-self-mcp/index.js`)
2. This path doesn't exist inside the n8n container
3. Even with volume mounts, the node dependencies might not work correctly

### MCP Credential Configuration
MCP credentials are defined in `src/utils/n8n-credentials.ts`. The `discordMcp` credential uses:
- `DISCORD_MCP_COMMAND` - Command to run (usually `node`)
- `DISCORD_MCP_ARGS` - Path to MCP script
- `DISCORD_MCP_ENV` - JSON object with environment variables (e.g., `DISCORD_TOKEN`)

### Container Networking (if using containers)
If you must use containers, the test infrastructure supports:
- **Volume mounts:** Auto-mounts MCP directories based on `DISCORD_MCP_ARGS` path
- **Host networking:** Adds `--add-host=host.containers.internal:host-gateway` for Redis access
- **Redis host:** Uses `host.containers.internal` instead of `localhost` for container → host access

### Debugging MCP Issues
```bash
# Check if MCP credential is being injected
grep -i "discord" logs/test-run.log

# Look for credential setup success
# "Successfully set up 5/5 essential credentials"

# Check for MCP spawn errors
grep -i "spawn\|ENOENT\|mcp" logs/test-run.log
```
