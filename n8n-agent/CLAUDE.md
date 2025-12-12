# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **n8n Agent** - a CLI tool for managing n8n workflows. It provides backup/restore functionality, workflow synchronization, database fixes, and integration testing infrastructure using podman containers.

## Common Commands

```bash
# Workflow Management
npm run n8n:workflows:downsync     # Export workflows from n8n to ./workflows/
npm run n8n:workflows:upsync       # Import workflows to n8n (preserves IDs)
npm run n8n:workflows:tree         # Show workflow folder structure
npm run n8n:verify                 # Verify workflow trigger inputs
npm run n8n:delete-all             # Delete all workflows from n8n

# Database Fixes (for workflow reference issues)
npm run n8n:db:fix                 # Fix broken workflow references
npm run n8n:db:check               # Check for issues (dry-run)

# Unit Tests
npm test                           # Run all unit tests with vitest
npm run test:watch                 # Watch mode
npm run test:select                # Interactive test selector

# Integration Tests (requires podman)
npm run test:integration           # All integration tests
npm run test:credentials           # Credential setup tests only
npm run test:backup-restore        # Backup/restore tests only
npm run test:simple                # Quick smoke test
npm run test:cleanup               # Stop/remove test containers

# Integration tests with logging (output to /tmp/n8n-tests/)
npm run test:integration:log
npm run test:credentials:log
npm run test:backup-restore:log
```

## Architecture

### CLI Entry Point
- `src/n8n-workflows-cli.ts` - Main CLI using commander.js with subcommands (backup, restore, tree, verify, delete-all, organize)

### Commands (`src/commands/`)
- `backup.ts` - Export workflows from n8n to JSON files
- `restore.ts` - Import workflows to n8n (supports `--preserve-ids` for direct DB import)
- `tree.ts` - Display workflow hierarchy
- `verify.ts` - Validate workflow trigger configurations
- `delete-all.ts` - Remove all workflows

### Utilities (`src/utils/`)
- `n8n-podman.ts` - Podman container lifecycle management for isolated n8n test instances
- `n8n-api.ts` - n8n REST API client
- `n8n-setup.ts` - User/credential setup for test containers
- `n8n-credentials.ts` - Credential injection via CLI
- `backup-restore-test.ts` - Test utilities for backup/restore operations
- `test-helpers.ts` - Shared test utilities and container lifecycle helpers
- `workflow-reference-converter.ts` - Convert workflow references between ID and name formats
- `logger.ts` - Pino-based logging

### Test Structure (`src/tests/`)
- `integration/` - Container-based integration tests (backup-restore, credentials, simple-start)
- `workflows/` - Workflow execution tests (Discord, Telegram agents, RAG)

### Workflow Tests (`src/tests/workflows/`)

Tests that execute actual n8n workflows using a Test Runner helper workflow. Uses `test.each()` pattern with test cases defined inline.

| Test File | Workflow | Test Cases |
|-----------|----------|------------|
| `discord-smart-agent.test.ts` | DiscordSmartAgent | simple-query, list-contacts, read-messages |
| `telegram-smart-agent.test.ts` | TelegramSmartAgent | search-messages, find-message-content, list-contacts, simple-query, ingest-metarune-messages |
| `discord-context-scout.test.ts` | DiscordContextScout | contact-fuzzy, guild-search, tool-lookup, self-profile, contact-empty-query |
| `telegram-context-scout.test.ts` | TelegramContextScout | contact-rag, message-rag, chat-with-all-params, contact-search, chat-search, tool-lookup, self-profile |
| `dynamic-rag.test.ts` | DynamicRAG | status, search-contacts, search-metarune, cleanup/create/clear/insert/search/delete collection |

**Workflow Test Runner Pattern:**
```typescript
import { executeWorkflowTest, syncWorkflow } from '../../utils/workflow-test-runner';
import { setupTestInstance, cleanupTestInstance, TEST_TIMEOUTS, type N8nInstance } from '../../utils/test-helpers';

describe('MyWorkflow', () => {
  let instance: N8nInstance | null = null;

  beforeAll(async () => {
    instance = await setupTestInstance();
    // Sync dependency workflows first, then main workflow
    await syncWorkflow('DependencyWorkflow', undefined, instance);
    await syncWorkflow('MyWorkflow', undefined, instance);
  }, TEST_TIMEOUTS.WORKFLOW);

  afterAll(async () => {
    await cleanupTestInstance(instance);
    instance = null;
  }, TEST_TIMEOUTS.WORKFLOW);

  test.each([
    { testCase: 'my-test', testData: { userPrompt: 'Test input' } },
  ])('$testCase', async ({ testCase, testData }) => {
    const result = await executeWorkflowTest('MyWorkflow', testCase, testData, undefined, instance);
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  }, TEST_TIMEOUTS.WORKFLOW);
});
```

**Key Functions (`workflow-test-runner.ts`):**
- `executeWorkflowTest(workflowName, testCase, testData, workflowsDir?, config?)` - Execute workflow with test data via Test Runner
- `syncWorkflow(workflowName, workflowsDir?, config?)` - Import workflow to n8n instance (handles dependencies)
- `buildApiConfigFromInstance(instance)` - Convert N8nInstance to N8nApiConfig

**Test Runner Workflow:** `workflows/HELPERS/Test Runner.json` - A special workflow that wraps other workflows for testing. It injects test data and captures output.

### Integration Tests (`src/tests/integration/`)

Three test suites that validate core functionality using isolated podman containers:

| Test Suite | File | Command | What it Tests |
|------------|------|---------|---------------|
| Simple Start | `simple-start.test.ts` | `npm run test:simple` | Container starts, API accessible, session auth works |
| Credentials | `credential-setup.test.ts` | `npm run test:credentials` | CLI availability, credential injection, ID matching |
| Backup/Restore | `backup-restore.test.ts` | `npm run test:backup-restore` | Workflow export/import, references, deduplication |

**Backup/Restore Test Cases:**
1. Simple workflows - basic backup/restore cycle
2. Workflow references - preserves inter-workflow references (toolWorkflow nodes)
3. Multiple restore cycles - no duplicates on repeated restores
4. Empty backup - handles gracefully
5. Complex structure - preserves multi-node connections

**Key Test Utilities:**
- `runBackupRestoreTest()` - Full backup/restore cycle with verification
- `createTestWorkflows()` - Creates workflows in n8n instance
- `verifyWorkflowReferences()` - Validates workflow references are valid
- `clearAllWorkflows()` - Removes all workflows from instance
- `resetN8nState()` - Fast state reset between tests
- `verifyN8nHealth()` - Health check before operations

**N8nInstance Properties:**
```typescript
instance.baseUrl        // e.g., "http://localhost:50123"
instance.containerName  // e.g., "n8n-test-1234567890-abc123"
instance.dataDir        // e.g., "/tmp/n8n-test-instances/..."
instance.sessionCookie  // For authenticated API calls
instance.apiKey         // May be undefined (scope validation issues)
```

**Authentication:** Tests use `sessionCookie` for API calls (not `apiKey`) due to n8n scope validation. Pass via `Cookie` header:
```typescript
axios.get(`${instance.baseUrl}/rest/workflows`, {
  headers: { 'Cookie': instance.sessionCookie },
  withCredentials: true,
});
```

## Testing Patterns

### Container Reuse Pattern
Integration tests use a shared container approach for performance (65-77% faster):

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

  beforeAll(async () => {
    instance = await setupTestInstance();
  }, TEST_TIMEOUTS.WORKFLOW);

  afterAll(async () => {
    await cleanupTestInstance(instance);
    instance = null;
  }, TEST_TIMEOUTS.WORKFLOW);

  beforeEach(async () => {
    await resetTestInstance(instance);  // Fast state reset (~1-2s)
  }, TEST_TIMEOUTS.WORKFLOW);

  it('should test something', async () => {
    // Use instance.baseUrl, instance.sessionCookie, etc.
  });
});
```

### Standard Timeouts
```typescript
TEST_TIMEOUTS.SIMPLE       // 3 min - fast tests
TEST_TIMEOUTS.CREDENTIALS  // 5 min - credential setup
TEST_TIMEOUTS.WORKFLOW     // 10 min - workflow/integration tests
```

## Configuration

### Environment Variables (`.env`)
```bash
N8N_URL=http://localhost:5678
N8N_API_KEY=your-api-key

# For integration tests
GOOGLE_GEMINI_API_KEY=your-key
QDRANT_URL=https://your-instance.cloud.qdrant.io:6333
QDRANT_API_KEY=your-key
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Vitest Configuration
- Test files: `src/**/*.test.ts`
- Tests run sequentially (no parallelism) to prevent n8n/LLM conflicts
- Uses `forks` pool for process isolation
- 5-minute default timeout for hooks and tests

## Key Files
- `workflows/` - JSON workflow definitions organized by tags
- `scripts/fix-workflow-references.py` - Python script for database fixes
- `scripts/test-integration.sh` - Integration test runner with logging support

## Custom n8n Docker Image

The project uses a custom n8n Docker image (`localhost/n8n-paragon-os:latest`) with the `n8n-nodes-paragon-os` custom nodes pre-installed. This is required for workflow tests that use custom nodes like FuzzySearch and JsonDocumentLoader.

### Building the Custom Image

```bash
./docker/build-custom-image.sh    # Builds localhost/n8n-paragon-os:latest
npm run docker:build              # Same as above
```

The build process:
1. Builds the n8n-nodes package from `../n8n-nodes/`
2. Removes TextManipulation node (ESM incompatibility with n8n)
3. Copies package with dependencies into Docker image
4. Installs production dependencies (`npm install --omit=dev`)

### Docker Files

- `docker/n8n-custom.Dockerfile` - Custom n8n image definition
- `docker/docker-entrypoint.sh` - Entrypoint that copies custom nodes at runtime
- `docker/build-custom-image.sh` - Build script

### Critical Implementation Details

**N8N_USER_FOLDER Nesting Issue:**
When `N8N_USER_FOLDER=/home/node/.n8n` is set (which the test framework does), n8n creates a NESTED `.n8n` subfolder:
- Config saved to: `/home/node/.n8n/.n8n/config`
- Nodes expected at: `/home/node/.n8n/.n8n/nodes/`

The entrypoint copies custom nodes to BOTH locations to handle this:
```sh
mkdir -p /home/node/.n8n/nodes/node_modules
mkdir -p /home/node/.n8n/.n8n/nodes/node_modules
cp -r /opt/n8n-custom-nodes/... /home/node/.n8n/nodes/node_modules/
cp -r /opt/n8n-custom-nodes/... /home/node/.n8n/.n8n/nodes/node_modules/
```

**Custom Node Dependencies:**
Custom nodes MUST include their `node_modules/` dependencies (e.g., `minisearch` for FuzzySearch). Copying only `dist/` contents will cause "Cannot find module" errors at runtime.

**Package Structure for n8n Custom Nodes:**
```
~/.n8n/nodes/
├── package.json                           # {"dependencies": {"n8n-nodes-paragon-os": "1.4.2"}}
└── node_modules/
    └── n8n-nodes-paragon-os/
        ├── package.json                   # Must have "n8n" section with nodes array
        ├── dist/
        │   └── nodes/
        │       ├── FuzzySearch/
        │       └── JsonDocumentLoader/
        └── node_modules/                  # Dependencies like minisearch
```

### Debugging Custom Node Issues

**"Unrecognized node type" Error:**
This means n8n didn't find/load the custom node. Check:
1. Nodes are in correct directory (see N8N_USER_FOLDER nesting above)
2. `package.json` has valid `n8n.nodes` array pointing to compiled `.node.js` files
3. All dependencies are installed (`node_modules/` present in package)
4. No ESM/CommonJS compatibility issues (n8n uses CommonJS)

**"Cannot find module 'X'" Error:**
The node's dependencies aren't installed. Ensure `npm install --omit=dev` runs in the package directory during Docker build.

**Verifying Custom Nodes Load:**
```bash
# Start container with debug logging
podman run -d --name n8n-debug -p 5678:5678 \
  -e N8N_LOG_LEVEL=debug \
  localhost/n8n-paragon-os:latest

# Check for node loading
podman logs n8n-debug 2>&1 | grep -i "loaded.*nodes\|paragon\|fuzzy"
# Should see: "Loaded all credentials and nodes from n8n-nodes-paragon-os"
```

### Test Framework Integration

The test framework (`test-helpers.ts`) automatically uses the custom image:
```typescript
export const DEFAULT_N8N_CUSTOM_IMAGE = 'localhost/n8n-paragon-os:latest';
```

Container startup in `n8n-podman.ts`:
```typescript
const containerArgs = [
  'run', '-d',
  '--name', containerName,
  '-p', `${port}:5678`,
  '-v', `${dataDir}:/home/node/.n8n`,  // Volume mount
  '-e', 'N8N_USER_FOLDER=/home/node/.n8n',
  imageName,
];
```

### Troubleshooting Checklist

1. **Image exists?** `podman images | grep n8n-paragon-os`
2. **Rebuild image:** `./docker/build-custom-image.sh`
3. **Check entrypoint ran:** Look for "Setting up custom nodes..." in container logs
4. **Check node directories:** `podman exec <container> ls -la /home/node/.n8n/.n8n/nodes/node_modules/`
5. **Check package.json:** Verify `n8n.nodes` array doesn't reference deleted files (like TextManipulation)
