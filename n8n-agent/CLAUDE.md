# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **n8n Agent** - a CLI tool for managing n8n workflows. It provides backup/restore functionality, workflow synchronization, and integration testing infrastructure using podman containers.

## Common Commands

```bash
# Workflow Management
npm run n8n:workflows:downsync     # Export workflows from n8n to ./workflows/
npm run n8n:workflows:upsync       # Import workflows to n8n (preserves IDs)
npm run n8n:workflows:tree         # Show workflow folder structure
npm run n8n:verify                 # Verify workflow trigger inputs
npm run n8n:delete-all             # Delete all workflows from n8n

# Pod Management (n8n + Discord MCP + Telegram MCP)
npm run n8n:pod:start              # Start pod with n8n + both MCP servers
npm run n8n:pod:stop               # Stop and remove all n8n MCP pods
npm run n8n:pod:status             # Show running pods, containers, URLs

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
- `pod-connection.ts` - Pod detection utility for CLI commands (queries podman to find running pods)
- `mcp-pod-manager.ts` - MCP pod lifecycle management (n8n + MCP servers in pods)
- `n8n-podman.ts` - Podman container lifecycle management for isolated n8n test instances
- `n8n-api.ts` - n8n REST API client
- `n8n-setup.ts` - User/credential setup for test containers
- `n8n-credentials.ts` - Credential injection via CLI
- `backup-restore-test.ts` - Test utilities for backup/restore operations
- `test-helpers.ts` - Shared test utilities and container lifecycle helpers
- `workflow-reference-converter.ts` - Convert workflow references between ID and name formats, rewrite MCP credentials (STDIO→SSE)
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
import { executeWorkflowTest } from '../../utils/workflow-test-runner';
import { setupTestInstance, cleanupTestInstance, TEST_TIMEOUTS, type N8nInstance } from '../../utils/test-helpers';

describe('MyWorkflow', () => {
  let instance: N8nInstance | null = null;

  beforeAll(async () => {
    instance = await setupTestInstance();
    // NOTE: Do NOT call syncWorkflow() here!
    // executeWorkflowTest() auto-imports all helpers in correct dependency order
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
- `executeWorkflowTest(workflowName, testCase, testData, workflowsDir?, config?, options?)` - Execute workflow with test data via Test Runner. **Auto-imports all helper workflows in correct dependency order.** Options include `mcpCredentialMappings` for pod mode.
- `syncWorkflow(workflowName, workflowsDir?, config?)` - Import single workflow (deprecated for tests - doesn't handle transitive dependencies)
- `buildApiConfigFromInstance(instance)` - Convert N8nInstance to N8nApiConfig

**Test Runner Workflow:** `workflows/HELPERS/Test Runner.json` - A special workflow that wraps other workflows for testing. It injects test data, routes to the target workflow, and returns results via an explicit "Respond to Webhook" node (uses `responseMode: "responseNode"` to handle complex sub-workflow chains correctly).

**IMPORTANT - Workflow Reference Resolution:**
Workflow JSON files contain hardcoded IDs that must be rewritten when imported to a new n8n instance. The `workflow-reference-converter.ts` handles this, but only if dependencies are imported FIRST. See `src/tests/workflows/CLAUDE.md` for details on debugging reference issues.

**IMPORTANT - Workflow Reference Placeholders:**
Execute Workflow nodes use placeholder IDs that are resolved during import based on `cachedResultName`. Example:
```json
"workflowId": {
  "__rl": true,
  "value": "universal-entity-fetcher-placeholder",
  "mode": "list",
  "cachedResultUrl": "/workflow/universal-entity-fetcher-placeholder",
  "cachedResultName": "[HELPERS] Universal Entity Fetcher"
}
```
The `cachedResultName` field is **required** - `workflow-reference-converter.ts` uses it to find the target workflow by name and rewrite the ID. Without this, the placeholder won't resolve.

### Integration Tests (`src/tests/integration/`)

Three test suites that validate core functionality using isolated podman containers:

| Test Suite | File | Command | What it Tests |
|------------|------|---------|---------------|
| Simple Start | `simple-start.test.ts` | `npm run test:simple` | Container starts, API accessible, session auth works |
| Credentials | `credential-setup.test.ts` | `npm run test:credentials` | CLI availability, credential injection, ID matching |
| Backup/Restore | `backup-restore.test.ts` | `npm run test:backup-restore` | Workflow export/import, references, deduplication |
| MCP Container | `mcp-container.test.ts` | `npx vitest run src/tests/integration/mcp-container.test.ts` | Telegram MCP in container with SSE transport |
| MCP Discord Pod | `mcp-discord-pod.test.ts` | `npx vitest run src/tests/integration/mcp-discord-pod.test.ts` | Discord MCP + n8n in podman pod with SSE |

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

### Container Testing

Tests use isolated podman containers with fresh n8n instances:
- Credentials are auto-injected from `ESSENTIAL_CREDENTIALS` in `n8n-credentials.ts`
- Container uses `host.containers.internal` to reach host services (Redis, etc.)
- For MCP workflows, use pod-based testing with SSE transport (see below)

### MCP Pod Testing (SSE Transport)

For fully containerized MCP testing, use **podman pods** with MCP servers running in **SSE mode**:

**Architecture (Multiple MCP Servers):**
```
┌──────────────────────────────────────────────────────────────────────┐
│                         Podman Pod                                   │
│  (shared localhost network)                                          │
│                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │  Discord MCP    │  │  Telegram MCP   │  │      n8n        │      │
│  │  (SSE server)   │  │  (SSE server)   │  │   (workflows)   │      │
│  │  Port 8000      │  │  Port 8001      │  │   Port 5678     │      │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘      │
│           │                    │                    │                │
│           └────────────────────┴────────────────────┘                │
│                    (all share localhost)                             │
└──────────────────────────────────────────────────────────────────────┘
```

**Key Features:**
1. **Multi-MCP Support**: The `mcp-pod-manager.ts` allocates unique ports for each MCP server automatically:
   - Discord MCP: port 8000 (default)
   - Telegram MCP: port 8001
   - Additional servers: 8002, 8003, etc.

2. **Port Configuration via Environment**: MCP servers read port from `MCP_PORT` env var:
   ```python
   # Telegram MCP (Python/FastMCP)
   port = int(os.environ.get("MCP_PORT", "8000"))
   mcp.settings.port = port
   ```
   ```typescript
   // Discord MCP (TypeScript)
   const PORT = parseInt(process.env.MCP_PORT || '8000', 10)
   ```

3. **Pod Networking**: Containers in the same podman pod share localhost. n8n connects to:
   - Discord: `http://localhost:8000/sse`
   - Telegram: `http://localhost:8001/sse`

4. **SSE Protocol Flow**:
   - Client connects to `/sse` endpoint (EventSource)
   - Server sends `endpoint` event with session-specific message URL
   - Client POSTs JSON-RPC requests to `/messages/?session_id=xxx`
   - Server responds via the SSE stream

5. **Redis Host Translation**: The credential injection automatically translates `localhost` → `host.containers.internal` for container networking (see `n8n-credentials.ts`).

**Test Files:**
- `src/tests/integration/mcp-container.test.ts` - Single MCP (Telegram)
- `src/tests/integration/mcp-discord-pod.test.ts` - Discord MCP pod

**Running the Tests:**
```bash
npx vitest run src/tests/integration/mcp-container.test.ts
npx vitest run src/tests/integration/mcp-discord-pod.test.ts
```

**Interactive Pod Management (for n8n UI access):**
```bash
npm run n8n:pod:start    # Start pod with n8n + Discord MCP + Telegram MCP
npm run n8n:pod:status   # Show running pods and URLs
npm run n8n:pod:stop     # Stop and cleanup all pods
```

When the pod starts:
- n8n UI available at: http://localhost:50000
- Discord MCP SSE endpoint: http://localhost:50001/sse
- Telegram MCP SSE endpoint: http://localhost:50002/sse
- All workflows are auto-imported with MCP credentials rewritten for SSE transport

**Multi-MCP Pod Example:**
```typescript
const pod = await startMcpPod({
  mcpServers: [
    { type: 'discord', env: { DISCORD_TOKEN: '...' } },
    { type: 'telegram', env: { TELEGRAM_API_ID: '...', TELEGRAM_API_HASH: '...', TELEGRAM_SESSION_STRING: '...' } },
  ],
});

// Endpoints available:
// pod.mcpEndpointsInternal.discord -> http://localhost:8000/sse
// pod.mcpEndpointsInternal.telegram -> http://localhost:8001/sse
// pod.n8nInstance.baseUrl -> http://localhost:50000

// Credential mappings for workflow rewriting:
// pod.mcpCredentialMappings -> [{ stdioId: 'xxx', sseId: 'yyy', sseName: '...' }]
```

6. **MCP Credential Rewriting**: Workflows designed for STDIO MCP can work with SSE in pods via automatic credential rewriting:
   - `mcp-pod-manager.ts` returns `mcpCredentialMappings` with STDIO→SSE ID mappings
   - Pass mappings to `executeWorkflowTest()` via `options.mcpCredentialMappings`
   - `workflow-reference-converter.ts` rewrites `mcpClientApi` → `mcpClientSseApi` during import

   ```typescript
   // In your test:
   const pod = await startMcpPod({ mcpServers: [...] });
   const result = await executeWorkflowTest(
     'MyWorkflow', testCase, testData, undefined, pod.n8nInstance,
     { mcpCredentialMappings: pod.mcpCredentialMappings }
   );
   ```

**Running MCP Workflow Tests:**
```bash
# Run tests (pods are automatically managed)
LOG_DIR=./logs LOG_LEVEL=debug npx vitest run src/tests/workflows/discord-context-scout.test.ts -t "contact-fuzzy"
```

**Pod-Based Testing:**
MCP tests use pods with SSE transport. The test framework automatically:
- Creates a pod with n8n and MCP servers
- Injects SSE credentials and rewrites workflow references
- Cleans up pods after tests complete

See `src/utils/mcp-pod-manager.ts` for implementation and `src/tests/integration/mcp-discord-pod.test.ts` for examples.

### Credential Injection

Credentials are defined in `src/utils/n8n-credentials.ts`. Only credentials listed in `ESSENTIAL_CREDENTIALS` are auto-injected into test containers:

```typescript
// Currently injected credentials:
ESSENTIAL_CREDENTIALS = [
  'googleGemini',     // Google Gemini API
  'redis',            // Redis (uses host.containers.internal in container)
  'qdrant',           // Qdrant Vector DB
  'qdrantHeaderAuth', // Qdrant API key header
  'discordMcp',       // Discord MCP Client (STDIO)
];
```

**To add a new credential:**
1. Add credential definition to `TEST_CREDENTIALS` in `n8n-credentials.ts`
2. Add credential key to `ESSENTIAL_CREDENTIALS` array
3. Set required env vars in `.env`

### Workflow Activation API

**IMPORTANT:** n8n has different activation endpoints depending on the API:

- **REST API (`/rest`)**: Use `PATCH /workflows/{id}` with `{ active: true }`
- **Public API (`/api/v1`)**: Use `POST /workflows/{id}/activate`

The `workflow-test-runner.ts` automatically detects which endpoint to use based on the client's baseURL.

## Configuration

### Environment Variables (`.env`)
```bash
# External services for workflows
GOOGLE_GEMINI_API_KEY=your-key
QDRANT_URL=https://your-instance.cloud.qdrant.io:6333
QDRANT_API_KEY=your-key
REDIS_HOST=localhost  # Container tests use host.containers.internal automatically
REDIS_PORT=6379

# MCP Server credentials (for pods)
DISCORD_TOKEN=your-discord-token
TELEGRAM_API_ID=your-api-id
TELEGRAM_API_HASH=your-api-hash
TELEGRAM_SESSION_STRING=your-session-string
```

**Note:** n8n connection is handled via pods. CLI commands automatically detect running pods started with `npm run n8n:pod:start`.

### Vitest Configuration
- Test files: `src/**/*.test.ts`
- Tests run sequentially (no parallelism) to prevent n8n/LLM conflicts
- Uses `forks` pool for process isolation
- 5-minute default timeout for hooks and tests

## Helper Workflow Architecture

The helper workflows in `workflows/HELPERS/` follow a layered architecture:

```
Context Scout Workflows (Discord/Telegram Context Scout)
    ↓ calls
Generic Context Scout Core
    ↓ calls (routes by platform)
Discord/Telegram Entity Cache Handler
    ↓ calls
Universal Entity Fetcher (handles all entity types for both platforms)
    ↓ calls
MCP nodes (Discord port 8000, Telegram port 8001)
```

### Key Helper Workflows

| Workflow | Purpose |
|----------|---------|
| `Universal Entity Fetcher` | Single workflow that fetches ALL entity types (contact, guild, chat, tool, self, message) for BOTH platforms. Replaces 9 platform-specific fetch workflows. |
| `Discord Entity Cache Handler` | Cache layer for Discord entities. Calls Universal Entity Fetcher on cache miss. |
| `Telegram Entity Cache Handler` | Cache layer for Telegram entities. Calls Universal Entity Fetcher on cache miss. |
| `Generic Context Scout Core` | Unified search logic (fuzzy/RAG/none). Routes to platform-specific cache handlers. |
| `Global Cache System` | Redis-based caching with TTL support. |
| `Dynamic RAG` | Qdrant vector operations (search, insert, delete, collection management). |

### Workflow Import Dependency Order

Workflows must be imported in dependency order (dependencies first):

```typescript
const dependencyOrder = [
  'Global Cache System',           // No dependencies
  'MCP Data Normalizer',           // No dependencies
  'Test Data',                     // No dependencies
  'Dynamic RAG',                   // No dependencies
  'Discord & Telegram Step Executor', // No dependencies
  'Universal Entity Fetcher',      // Depends on MCP credentials
  'Discord Entity Cache Handler',  // Depends on Global Cache System, Universal Entity Fetcher
  'Telegram Entity Cache Handler', // Depends on Global Cache System, Universal Entity Fetcher
  'Generic Context Scout Core',    // Depends on cache handlers, Dynamic RAG
  'Test Runner',                   // Must be last
];
```

This order is used by both `scripts/start-n8n-pod.ts` and `src/utils/workflow-test-runner.ts`.

## Key Files
- `workflows/` - JSON workflow definitions organized by tags
- `scripts/start-n8n-pod.ts` - Start podman pod with n8n + Discord MCP + Telegram MCP
- `scripts/stop-n8n-pod.ts` - Stop and remove n8n MCP pods
- `scripts/status-n8n-pod.ts` - Show pod status and URLs
- `scripts/fix-workflow-references.py` - Python script for database fixes
- `scripts/test-integration.sh` - Integration test runner with logging support

## Monorepo Structure

This project is part of the `paragon-os-app` monorepo:

```
paragon-os-app/
├── n8n-agent/              # This project - workflow management & testing
├── n8n-nodes/              # Custom n8n nodes (paragon-os nodes)
└── mcp-servers/            # MCP server implementations
    ├── telegram-mcp/       # Telegram MCP (Python/FastMCP) - 82 tools
    └── discord-self-mcp/   # Discord MCP (TypeScript/Node.js) - 14 tools
```

### MCP Servers

**Telegram MCP** (`../mcp-servers/telegram-mcp/`):
- Python-based using `mcp.server.fastmcp.FastMCP`
- 82 tools for chats, messages, contacts, media, admin, reactions
- Supports both STDIO and SSE transport modes
- See `mcp-servers/telegram-mcp/CLAUDE.md` for details

**Discord MCP** (`../mcp-servers/discord-self-mcp/`):
- TypeScript/Node.js based
- 14 tools for messages, guilds, channels, users
- Entry point: `dist/index.js`
- Build: `npm run build` in that directory

## MCP Node Configuration in Workflow JSON

When working with MCP nodes in workflow JSON files, there are two transport modes: STDIO (default) and SSE.

### STDIO vs SSE Configuration

**STDIO Mode (default):**
```json
{
  "parameters": {
    "operation": "executeTool",
    "toolName": "=discord_list_guilds",
    "toolParameters": "={}"
  },
  "type": "n8n-nodes-mcp.mcpClient",
  "credentials": {
    "mcpClientApi": {
      "id": "ZFofx3k2ze1wsifx",
      "name": "Discord MCP Client (STDIO) account"
    }
  }
}
```

**SSE Mode (for pod-based deployment):**
```json
{
  "parameters": {
    "connectionType": "sse",
    "uriOverride": " http://0.0.0.0:8000/sse",
    "operation": "executeTool",
    "toolName": "=discord_list_guilds",
    "toolParameters": "={}"
  },
  "type": "n8n-nodes-mcp.mcpClient",
  "credentials": {
    "mcpClientSseApi": {
      "id": "discordMcpSseCredential",
      "name": "Discord MCP Client (SSE) account"
    }
  }
}
```

### Key Differences for SSE Configuration

1. **Add to parameters:**
   - `"connectionType": "sse"`
   - `"uriOverride": " http://0.0.0.0:<PORT>/sse"` (note: space before http is intentional)

2. **Change credential type:**
   - From: `mcpClientApi` → To: `mcpClientSseApi`

3. **Port assignments:**
   - Discord MCP: port 8000
   - Telegram MCP: port 8001

### Credential ID Mappings

| Platform | STDIO Credential | SSE Credential |
|----------|-----------------|----------------|
| Discord | `mcpClientApi` / `ZFofx3k2ze1wsifx` / "Discord MCP Client (STDIO) account" | `mcpClientSseApi` / `discordMcpSseCredential` / "Discord MCP Client (SSE) account" |
| Telegram | `mcpClientApi` / `aiYCclLDUqob5iQ0` / "Telegram MCP Client (STDIO) account" | `mcpClientSseApi` / `telegramMcpSseCredential` / "Telegram MCP Client (SSE) account" |

### Finding MCP Nodes to Fix

```bash
# Find all files with MCP nodes
grep -r "n8n-nodes-mcp\.mcpClient" --include="*.json" workflows/

# Check for STDIO credentials (need fixing)
grep -r "mcpClientApi" --include="*.json" workflows/

# Check for SSE credentials (already fixed)
grep -r "mcpClientSseApi" --include="*.json" workflows/
```

### Workflow Files with MCP Nodes

Helper workflows that use MCP nodes:
- `workflows/HELPERS/Universal Entity Fetcher.json` (fetches all entity types for both Discord and Telegram)
- `workflows/HELPERS/Discord & Telegram Step Executor.json` (has both Discord and Telegram nodes)
- `workflows/Legacy Telegram Context Enricher.json` (has 5 Telegram MCP nodes)

## Additional Documentation

Detailed documentation is available in subdirectory CLAUDE.md files:

- **`docker/CLAUDE.md`** - Custom n8n Docker image with paragon-os nodes, N8N_USER_FOLDER nesting issue, debugging custom nodes
- **`src/tests/CLAUDE.md`** - Testing infrastructure, container reuse pattern, test utilities
- **`src/tests/workflows/CLAUDE.md`** - Workflow Test Runner architecture, writing workflow tests, helper workflows
