# Testing Infrastructure

This directory contains integration tests for the n8n Agent. Tests run against isolated n8n instances in podman containers.

## Test Organization

```
src/tests/
├── integration/           # Core infrastructure tests
│   ├── simple-start.test.ts      # Basic container startup
│   ├── credential-setup.test.ts  # Credential injection
│   └── backup-restore.test.ts    # Backup/restore functionality
└── workflows/             # Workflow execution tests
    ├── discord-context-scout.test.ts
    ├── dynamic-rag.test.ts
    └── ... (see workflows/CLAUDE.md for details)
```

## Running Tests

```bash
# All tests
npm run test:integration

# Specific test suites
npm run test:simple              # Quick smoke test
npm run test:credentials         # Credential setup tests
npm run test:backup-restore      # Backup/restore tests

# With logging (output to /tmp/n8n-tests/)
npm run test:integration:log
npm run test:backup-restore:log

# Cleanup stale containers
npm run test:cleanup
```

## Test Timeouts

Standard timeouts are defined in `src/utils/test-helpers.ts`:

```typescript
import { TEST_TIMEOUTS } from '../../utils/test-helpers';

TEST_TIMEOUTS.SIMPLE       // 3 min - fast tests (startup checks)
TEST_TIMEOUTS.CREDENTIALS  // 5 min - credential setup
TEST_TIMEOUTS.WORKFLOW     // 10 min - workflow execution tests
TEST_TIMEOUTS.INTEGRATION  // 10 min - alias for WORKFLOW
```

Always use these constants instead of hardcoding timeouts.

## Container Reuse Pattern

Tests use a shared container approach for performance (65-77% faster than per-test containers):

```typescript
import {
  setupTestInstance,
  cleanupTestInstance,
  resetTestInstance,
  TEST_TIMEOUTS,
  type N8nInstance
} from '../../utils/test-helpers';

describe('My Test Suite', () => {
  let instance: N8nInstance | null = null;

  // Start container ONCE for all tests
  beforeAll(async () => {
    instance = await setupTestInstance();
  }, TEST_TIMEOUTS.WORKFLOW);

  // Stop container after all tests
  afterAll(async () => {
    await cleanupTestInstance(instance);
    instance = null;
  }, TEST_TIMEOUTS.WORKFLOW);

  // Reset state between tests (fast: ~1-2s vs container restart: ~20-30s)
  beforeEach(async () => {
    await resetTestInstance(instance);
  }, TEST_TIMEOUTS.WORKFLOW);

  it('should test something', async () => {
    // Use instance.baseUrl, instance.sessionCookie, etc.
  });
});
```

**Why this pattern:**
- Container startup takes 20-30 seconds
- State reset takes 1-2 seconds
- For 5 tests: 30s + (5 × 2s) = 40s vs 5 × 30s = 150s

## N8nInstance Properties

```typescript
interface N8nInstance {
  baseUrl: string;           // e.g., "http://localhost:50123"
  containerName: string;     // e.g., "n8n-test-1234567890-abc123"
  dataDir: string;           // e.g., "/tmp/n8n-test-instances/..."
  port: number;              // e.g., 50123
  sessionCookie: string;     // For authenticated API calls
  apiKey?: string;           // May be undefined (scope validation issues)
}
```

## Authentication

Tests use `sessionCookie` for API calls (not `apiKey`) due to n8n scope validation issues with programmatic API key creation.

```typescript
import axios from 'axios';

// Correct: Use session cookie
const response = await axios.get(`${instance.baseUrl}/rest/workflows`, {
  headers: { 'Cookie': instance.sessionCookie },
  withCredentials: true,
});

// May fail: API key scope validation
const response = await axios.get(`${instance.baseUrl}/rest/workflows`, {
  headers: { 'X-N8N-API-KEY': instance.apiKey },
});
```

## Test Utilities

### Core Helpers (`src/utils/test-helpers.ts`)

| Function | Purpose |
|----------|---------|
| `setupTestInstance(config?)` | Start n8n container, returns N8nInstance |
| `cleanupTestInstance(instance)` | Stop and remove container |
| `resetTestInstance(instance)` | Clear workflows, verify health (fast) |
| `TEST_TIMEOUTS` | Standard timeout constants |
| `findWorkflowFile(name, files)` | Match workflow by ID, name, or basename |
| `parseExecutionOutput(stdout)` | Parse n8n execution JSON |
| `extractWorkflowResults(json)` | Extract success/output/error from execution |

### Backup/Restore Helpers (`src/utils/backup-restore-test.ts`)

| Function | Purpose |
|----------|---------|
| `runBackupRestoreTest(instance, workflows, dir, options)` | Full backup/restore cycle |
| `createTestWorkflows(instance, workflows)` | Create workflows in n8n |
| `verifyWorkflowReferences(instance, workflows)` | Check workflow references valid |
| `clearAllWorkflows(instance)` | Delete all workflows |
| `resetN8nState(instance)` | Clear workflows, keep credentials |
| `verifyN8nHealth(instance)` | Health check |

### Workflow Test Runner (`src/utils/workflow-test-runner.ts`)

| Function | Purpose |
|----------|---------|
| `executeWorkflowTest(workflow, testCase, data, dir?, config?)` | Run workflow via Test Runner |
| `syncWorkflow(name, dir?, config?)` | Import workflow to n8n |
| `buildApiConfigFromInstance(instance)` | Convert instance to API config |

## Podman Requirements

Tests require podman to be installed and running:

```bash
# macOS
brew install podman
podman machine init
podman machine start

# Linux
sudo apt install podman
```

Tests automatically check for podman availability and skip with helpful error if missing.

## Common Test Patterns

### Basic Integration Test

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupTestInstance,
  cleanupTestInstance,
  TEST_TIMEOUTS,
  type N8nInstance
} from '../../utils/test-helpers';

describe('Feature Test', () => {
  let instance: N8nInstance | null = null;

  beforeAll(async () => {
    instance = await setupTestInstance();
  }, TEST_TIMEOUTS.WORKFLOW);

  afterAll(async () => {
    await cleanupTestInstance(instance);
    instance = null;
  }, TEST_TIMEOUTS.WORKFLOW);

  it('should do something', async () => {
    if (!instance) throw new Error('Instance not initialized');

    // Test code using instance.baseUrl, instance.sessionCookie
  }, TEST_TIMEOUTS.WORKFLOW);
});
```

### Per-Test Container (when needed)

```typescript
describe('Isolated Tests', () => {
  let instance: N8nInstance | null = null;

  beforeEach(async () => {
    instance = await startN8nInstance({ timeout: 120000 });
  });

  afterEach(async () => {
    if (instance) {
      await stopN8nInstance(instance);
      instance = null;
    }
  });

  it('needs isolation', async () => {
    // Each test gets fresh container
  });
});
```

## Debugging Failed Tests

### Check container logs
```bash
podman logs <container-name>
```

### Container still running?
```bash
podman ps -a | grep n8n-test
```

### Cleanup stale containers
```bash
npm run test:cleanup
# or manually:
podman stop $(podman ps -q --filter name=n8n-test)
podman rm $(podman ps -aq --filter name=n8n-test)
```

### Run single test with verbose output
```bash
npm test -- src/tests/integration/simple-start.test.ts --reporter=verbose
```

### Test output logging
Tests with `:log` suffix write output to `/tmp/n8n-tests/`:
```bash
npm run test:backup-restore:log
cat /tmp/n8n-tests/backup-restore-*.log
```

## n8n Container Logging

Test containers run with enhanced logging for better error visibility:

### Environment Variables (set automatically)
```bash
N8N_LOG_LEVEL=debug              # Detailed execution logging
N8N_LOG_OUTPUT=console,file      # Log to stdout AND file
N8N_LOG_FILE_LOCATION=/home/node/.n8n/n8n.log
EXECUTIONS_DATA_SAVE_ON_ERROR=all
EXECUTIONS_DATA_SAVE_ON_SUCCESS=all
```

### Log Capture Functions (`src/utils/n8n-podman.ts`)
```typescript
// Get container stdout/stderr (last 1000 lines by default)
const logs = await getContainerLogs(containerName);

// Get n8n log file from inside container
const n8nLogs = await getN8nLogFile(containerName);

// Get both combined
const { containerLogs, n8nLogs, combined } = await getComprehensiveLogs(containerName);
```

### What Container Logs Show (Webhook Execution)

When webhooks are called, container logs show detailed execution lifecycle:

```
Received webhook "POST" for path "test-runner"
Execution added {"executionId":"1"...}
Execution ID 1 had Execution data. Running with payload.
Workflow execution started {"workflowId":"gS11X4tiyb4SgqWA"...}
Start executing node "Webhook"
Running node "Webhook" finished successfully
Save execution progress to database for execution ID 1
Workflow execution finished successfully
Save execution data to database for execution ID 1
Execution finalized {"executionId":"1"...}
```

### What to Look For in Logs

**Successful workflow reference rewriting:**
```
🔄 Rewriting workflow reference: "BVI8WfWulWFCFvwk" → "a4AQxibvAESCiaDe"
```

**Broken workflow references (problem!):**
```
⚠️ Could not resolve workflow reference "BVI8WfWulWFCFvwk" to an ID, keeping as-is
```

**Webhook errors:**
```
Error in handling webhook request POST /webhook/test-runner: No item to return was found
```

## Execution History API

n8n saves execution history that can be queried via the REST API.

### API Response Format

**IMPORTANT:** The executions API returns a nested structure:
```json
{
  "data": {
    "results": [
      {
        "id": "1",
        "workflowId": "gS11X4tiyb4SgqWA",
        "mode": "webhook",
        "status": "success",
        "startedAt": "2025-12-12T21:34:08.695Z",
        "stoppedAt": "2025-12-12T21:34:08.722Z"
      }
    ],
    "count": 1,
    "estimated": false
  }
}
```

The actual executions array is at `response.data.data.results`, NOT `response.data.data` or `response.data`.

### Querying Executions
```typescript
const response = await axios.get(
  `${instance.baseUrl}/rest/executions`,
  {
    headers: { Cookie: instance.sessionCookie },
    params: { limit: 10 },
  }
);

// Correct parsing:
const executions = response.data?.data?.results || [];
console.log(`Found ${executions.length} executions`);
```

### When Executions Are Saved

- **Webhook executions**: Always saved (mode: "webhook")
- **Manual trigger via UI**: Saved
- **CLI `n8n execute --id=X`**: May not be saved (depends on execution mode)
- **REST API `/run` endpoint**: Returns 500 for manual trigger workflows (use webhooks instead)

## Workflow Reference Resolution

When workflows are imported to a fresh test container, their internal references to other workflows must be rewritten because the workflow IDs change.

### How It Works
1. Workflow JSON files have `workflowId: { value: "oldId", cachedResultName: "Workflow Name" }`
2. On import, `workflow-reference-converter.ts` looks up the workflow by `cachedResultName`
3. If found, it rewrites `value` to the new database ID
4. If NOT found, it logs a warning and the reference stays broken

### Why Order Matters
The converter can only rewrite a reference if the target workflow is ALREADY imported. This is why `executeWorkflowTest()` imports helpers in a specific dependency order defined in `workflow-test-runner.ts`.

### Common Pitfall
**Don't manually call `syncWorkflow()` in test `beforeAll`!** It imports workflows out of order, causing broken references. Let `executeWorkflowTest()` handle all imports.
