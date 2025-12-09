# n8n Integration Methods - Knowledge Base

> **Purpose:** Comprehensive reference for all n8n integration methods used in the project  
> **Last Updated:** 2025-01-XX  
> **Status:** Current as of n8n latest (check docs.n8n.io/api for updates)

## Quick Reference

| Method | Use Case | When to Use | File Location |
|--------|----------|-------------|---------------|
| **REST API `/api/v1`** | Workflow CRUD, executions read | Primary method for most operations | `n8n-api.ts` |
| **REST API `/rest`** | User setup, login, legacy endpoints | Initial setup, authentication | `n8n-setup.ts` |
| **CLI `n8n execute`** | Workflow execution | Running workflows (no API endpoint) | `n8n-api.ts:601` |
| **CLI `n8n import:credentials`** | Credential injection | Test setup with exact IDs | `n8n-credentials.ts:244` |
| **Direct DB Access** | ID preservation | Restore with preserved IDs | `n8n-database.ts` |
| **Podman Exec** | Container commands | Running CLI inside containers | `n8n-podman.ts` |

---

## 1. REST API `/api/v1` (Modern API)

### ✅ Available Endpoints

| Endpoint | Method | Purpose | File Reference |
|----------|--------|---------|----------------|
| `/api/v1/workflows` | GET | List workflows (paginated) | `n8n-api.ts:198` |
| `/api/v1/workflows` | POST | Create workflow | `n8n-api.ts:445` |
| `/api/v1/workflows/{id}` | GET | Get workflow by ID | `n8n-api.ts:772` |
| `/api/v1/workflows/{id}` | PUT | Update workflow | `n8n-api.ts:414` |
| `/api/v1/workflows/{id}` | DELETE | Delete workflow | `n8n-api.ts:796` |
| `/api/v1/executions` | GET | List executions | `n8n-api.ts:688` |
| `/api/v1/executions/{id}` | GET | Get execution details | `n8n-api.ts:724` |

### 🔑 Key Features

- **Pagination:** Uses cursor-based pagination (`limit`, `cursor`)
- **Authentication:** **API key ONLY** (`X-N8N-API-KEY`) - **Session cookies NOT supported**
- **Response Format:** `{ data: [...], nextCursor: "..." }` or direct array
- **ID Handling:** Auto-generates IDs (can't preserve custom IDs)
- **Full Data:** Returns complete workflow data (nodes, connections, etc.)

### ⚠️ Limitations

- ❌ **No execution endpoint** - Must use CLI for workflow execution
- ❌ **Can't preserve workflow IDs** - Auto-generates on POST
- ❌ **Can't set credential IDs** - Use CLI import instead
- ❌ **Requires API key** - Session cookies don't work (both GET and POST require API key)

---

## 2. REST API `/rest` (Legacy/Internal)

### Available Endpoints

| Endpoint | Method | Purpose | File Reference |
|----------|--------|---------|----------------|
| `/rest/owner/setup` | POST | Create initial user | `n8n-setup.ts:168` |
| `/rest/login` | POST | User login (get session) | `n8n-setup.ts:321` |
| `/rest/api-keys` | POST | Create API key | `n8n-setup.ts:386` |
| `/rest/workflows` | GET | List workflows (summary only) | `n8n-api.ts:214` |
| `/rest/workflows/{id}` | GET | Get workflow (full data) | `n8n-api.ts:214` |
| `/rest/workflows` | POST | Create workflow | `n8n-api.ts:472` |
| `/rest/credentials` | GET | List credentials (legacy) | `credential-setup.test.ts:85` |

### 🔑 Key Features

- **Session-based auth:** Accepts session cookies (works when API key unavailable)
- **Initial setup:** Required for first-time user creation
- **Summary vs Full Data:** `/rest/workflows` returns summaries, `/rest/workflows/{id}` returns full data
- **Response Format:** Wraps responses in `{ data: {...} }` format
- **Required Fields:** POST requires `active` field (database constraint)

### ⚠️ Critical Notes

- **`/rest/workflows` returns summary data** - Missing `nodes` and `connections` fields
- **Must fetch individually** - Use `/rest/workflows/{id}` to get full workflow data
- **Response wrapping** - All responses wrapped in `{ data: {...} }` format
- **Active field required** - POST requests must include `active: boolean` field
- **Use when API key unavailable** - Primary use case is test environments where API key creation fails

### 🔄 Workaround Pattern

When using `/rest` endpoints for export:

```typescript
// Step 1: Get workflow summaries (fast, but incomplete)
const summaries = await client.get('/rest/workflows');
// Returns: { count: 2, data: [{id, name, ...}] } - NO nodes!

// Step 2: Fetch each workflow individually (slower, but complete)
for (const summary of summaries.data.data) {
  const full = await client.get(`/rest/workflows/${summary.id}`);
  // Returns: { data: {id, name, nodes, connections, ...} } - Full data!
  workflows.push(full.data.data);
}
```

**See:** `.cursor/n8n-api-authentication-guide.md` for detailed patterns and pitfalls

---

## 3. CLI Commands

### `n8n execute` - Workflow Execution

**Why CLI?** No REST API endpoint exists for workflow execution.

```typescript
// Usage in code
const { runN8nCapture } = await import('./n8n');
const args = ['execute', `--id=${workflowId}`, '--rawOutput'];
const { code, stdout, stderr } = await runN8nCapture(args, timeout);
```

**File:** `n8n-api.ts:601`  
**Fallback:** If CLI produces no output, queries `/api/v1/executions` API

### `n8n import:credentials` - Credential Import

**Why CLI?** REST API doesn't allow setting credential IDs.

```typescript
// Usage in code
await execInContainer(containerName, [
  'n8n', 'import:credentials', '--input', credentialFilePath
]);
```

**File:** `n8n-credentials.ts:244`  
**Requires:** Credential file in array format: `[{ id, name, type, data }]`

---

## 4. Direct Database Access

### When to Use

- **ID Preservation:** Restore workflows with exact IDs from backup
- **Requires:** n8n must be **stopped** (prevents corruption)

### Implementation

```typescript
// File: n8n-database.ts
importWorkflowToDatabase(db, workflow, preserveId: true);
```

**File:** `n8n-database.ts:183`  
**Used by:** `restore.ts:363` (with `--preserve-ids` flag)

### ⚠️ Safety Checks

- Verifies database is not locked (n8n not running)
- Uses transactions for atomicity
- Handles foreign key constraints

---

## 5. Podman Container Integration

### Container Commands

| Operation | Command | Purpose | File |
|-----------|---------|---------|------|
| Start container | `podman run -d ...` | Create test instance | `n8n-podman.ts:349` |
| Execute in container | `podman exec -u node ...` | Run CLI commands | `n8n-setup.ts:22` |
| Copy file | `podman cp ...` | Transfer credential files | `n8n-credentials.ts:218` |
| Get logs | `podman logs ...` | Debugging | `n8n-podman.ts:507` |

### Use Cases

- **Test isolation:** Each test gets clean n8n instance
- **Credential injection:** Copy files and import via CLI
- **Setup automation:** User creation, API key generation

---

## Integration Flow Matrix

### Workflow Management Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Workflow Operations                    │
└─────────────────────────────────────────────────────────┘

Export Workflows:
  REST API /api/v1/workflows (GET) → backup.ts:195

Import Workflow (Standard):
  REST API /api/v1/workflows (POST) → restore.ts:421
  └─ Converts references to names automatically

Import Workflow (ID Preservation):
  Direct DB Access → restore.ts:363
  └─ Requires n8n stopped
  └─ Converts references BEFORE import

Update Workflow:
  REST API /api/v1/workflows/{id} (PUT) → n8n-api.ts:414
  └─ Falls back to POST if 404

Delete Workflow:
  REST API /api/v1/workflows/{id} (DELETE) → n8n-api.ts:796
```

### Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│                   Workflow Execution                      │
└─────────────────────────────────────────────────────────┘

Primary Method:
  CLI: n8n execute --id={id} --rawOutput → n8n-api.ts:601
  └─ Parses JSON output

Fallback (if no CLI output):
  REST API /api/v1/executions?workflowId={id} → n8n-api.ts:688
  └─ Gets most recent execution
  └─ Then GET /api/v1/executions/{id} for details
```

### Credential Setup Flow

```
┌─────────────────────────────────────────────────────────┐
│                  Credential Management                    │
└─────────────────────────────────────────────────────────┘

Setup Flow:
  1. Check CLI availability → n8n-credentials.ts:404
     └─ podman exec container n8n --help

  2. Create credential JSON file → n8n-credentials.ts:156
     └─ Format: [{ id, name, type, data }]

  3. Copy to container → n8n-credentials.ts:218
     └─ podman cp file container:/tmp/file

  4. Import via CLI → n8n-credentials.ts:244
     └─ podman exec container n8n import:credentials --input /tmp/file

  5. Cleanup temp files
```

### User & Auth Setup Flow

```
┌─────────────────────────────────────────────────────────┐
│                  User & Authentication                    │
└─────────────────────────────────────────────────────────┘

Initial Setup:
  1. Wait for DB migrations → n8n-setup.ts:65
     └─ Check container logs

  2. Create user → n8n-setup.ts:168
     └─ POST /rest/owner/setup

  3. Login → n8n-setup.ts:321
     └─ POST /rest/login
     └─ Extract session cookie

  4. Create API key → n8n-setup.ts:386
     └─ POST /rest/api-keys
     └─ Requires session cookie
     └─ ⚠️ May fail due to scope validation (known issue)
```

---

## Decision Matrix: Which Method to Use?

### Workflow Operations

| Operation | Standard | ID Preservation | File |
|-----------|----------|-----------------|------|
| **Export** | `/api/v1/workflows` GET | N/A | `backup.ts:195` |
| **Import** | `/api/v1/workflows` POST | Direct DB | `restore.ts` |
| **Update** | `/api/v1/workflows/{id}` PUT | Direct DB | `n8n-api.ts:414` |
| **Delete** | `/api/v1/workflows/{id}` DELETE | Direct DB | `n8n-api.ts:796` |

### Execution

| Operation | Method | Notes |
|-----------|--------|-------|
| **Execute** | CLI `n8n execute` | No API endpoint |
| **Get Result** | `/api/v1/executions/{id}` | Fallback if CLI has no output |

### Credentials

| Operation | Method | Why |
|-----------|--------|-----|
| **Import** | CLI `n8n import:credentials` | API doesn't allow ID control |
| **List** | `/rest/credentials` GET | Legacy endpoint (may change) |

### Authentication

| Operation | Method | Why |
|-----------|--------|-----|
| **Create User** | `/rest/owner/setup` POST | Only available endpoint |
| **Login** | `/rest/login` POST | Gets session cookie |
| **Create API Key** | `/rest/api-keys` POST | Requires session |

---

## API Endpoint Reference

### `/api/v1` Endpoints (Modern)

```typescript
// Base URL: {baseURL}/api/v1

GET    /workflows              // List workflows (paginated)
POST   /workflows              // Create workflow
GET    /workflows/{id}         // Get workflow
PUT    /workflows/{id}         // Update workflow
DELETE /workflows/{id}         // Delete workflow
GET    /executions             // List executions
GET    /executions/{id}        // Get execution details
```

### `/rest` Endpoints (Legacy/Internal)

```typescript
// Base URL: {baseURL}/rest

POST   /owner/setup            // Create initial user
POST   /login                  // User login
POST   /api-keys               // Create API key
GET    /workflows              // List workflows (legacy)
GET    /credentials            // List credentials (legacy)
```

---

## Common Patterns

### Pattern 1: Workflow Import with Reference Conversion

```typescript
// 1. Convert references to names (before import)
const workflowWithNameReferences = await convertWorkflowReferencesToNames(
  workflowData, 
  allBackupWorkflows, 
  config
);

// 2. Clean workflow data (remove read-only fields)
const cleanedData = cleanWorkflowForApi(workflowWithNameReferences);

// 3. Import via API
const response = await client.post('/workflows', cleanedData);
```

**Files:** `n8n-api.ts:330`, `workflow-reference-converter.ts`

### Pattern 2: CLI Execution with API Fallback

```typescript
// 1. Try CLI execution
const { code, stdout, stderr } = await runN8nCapture(
  ['execute', `--id=${workflowId}`, '--rawOutput'],
  timeout
);

// 2. If no output, query API
if (!combinedOutput.trim()) {
  const execResponse = await client.get('/executions', {
    params: { workflowId: resolvedWorkflowId, limit: 1 }
  });
  // Get execution details...
}
```

**Files:** `n8n-api.ts:601`

### Pattern 3: Credential Injection in Container

```typescript
// 1. Create credential file
const credFile = createCredentialFile(dataDir, credential);

// 2. Copy to container
await copyToContainer(containerName, credFile, containerTempPath);

// 3. Import via CLI
await execInContainer(containerName, [
  'n8n', 'import:credentials', '--input', containerTempPath
]);

// 4. Cleanup
await execInContainer(containerName, ['rm', containerTempPath]);
```

**Files:** `n8n-credentials.ts:244`

---

## Known Limitations & Workarounds

### 1. No Execution API Endpoint

**Problem:** n8n doesn't expose workflow execution via REST API  
**Workaround:** Use CLI `n8n execute` command  
**File:** `n8n-api.ts:601`

### 2. Can't Preserve Workflow IDs via API

**Problem:** API auto-generates IDs on POST  
**Workaround:** Use direct database access (requires n8n stopped)  
**File:** `n8n-database.ts:183`

### 3. Can't Set Credential IDs via API

**Problem:** API doesn't allow specifying credential IDs  
**Workaround:** Use CLI `n8n import:credentials`  
**File:** `n8n-credentials.ts:244`

### 4. API Key Scope Validation Fails

**Problem:** Creating API keys with scopes fails validation  
**Workaround:** Use session cookies or create manually in UI  
**File:** `n8n-setup.ts:386`  
**Status:** Known issue, documented in `docs/API-KEY-SCOPES-ISSUE.md`

---

## File Reference Map

| Integration Method | Primary Files | Related Files |
|-------------------|---------------|---------------|
| **REST API `/api/v1`** | `n8n-api.ts` | `backup.ts`, `restore.ts` |
| **REST API `/rest`** | `n8n-setup.ts` | `credential-setup.test.ts` |
| **CLI Execution** | `n8n.ts`, `n8n-api.ts:601` | `workflow-test-runner.ts` |
| **CLI Credentials** | `n8n-credentials.ts` | `n8n-setup.ts` |
| **Direct DB** | `n8n-database.ts` | `restore.ts` |
| **Podman** | `n8n-podman.ts` | `n8n-setup.ts`, `n8n-credentials.ts` |

---

## Recommendations

### 1. Consolidation Opportunities

- ✅ **Replace `/rest/workflows`** with `/api/v1/workflows` in tests
- ✅ **Replace `/rest/credentials`** with `/api/v1/credentials` (if available)
- ⚠️ **Keep `/rest/owner/setup`** - No alternative exists

### 2. Abstraction Layer

Consider creating a unified interface:

```typescript
interface N8nIntegration {
  exportWorkflows(): Promise<Workflow[]>;
  importWorkflow(wf: Workflow, options?: ImportOptions): Promise<Workflow>;
  executeWorkflow(id: string, input?: unknown): Promise<Execution>;
  importCredential(cred: Credential): Promise<void>;
}
```

### 3. Check Latest API Docs

- Verify if execution endpoint exists: `docs.n8n.io/api`
- Check credential import API improvements
- Confirm `/rest` endpoint deprecation status

---

## Quick Decision Guide

**Need to...** → **Use...**

- Export workflows → `/api/v1/workflows` GET
- Import workflow (standard) → `/api/v1/workflows` POST
- Import workflow (preserve ID) → Direct DB (n8n stopped)
- Execute workflow → CLI `n8n execute`
- Import credential → CLI `n8n import:credentials`
- Create user → `/rest/owner/setup` POST
- Create API key → `/rest/api-keys` POST
- Run command in container → Podman exec

---

**Last Updated:** 2025-01-XX  
**Maintained By:** AI Assistant (update when n8n API changes)

