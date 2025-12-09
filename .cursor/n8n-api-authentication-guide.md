# n8n API Authentication Guide - Learnings & Best Practices

> **Purpose:** Comprehensive guide for n8n API authentication, endpoint selection, and common pitfalls  
> **Last Updated:** 2025-01-09  
> **Status:** Current - Based on n8n 1.122.5  
> **Context:** Derived from fixing backup-restore integration tests

---

## 🎯 Quick Reference

| Endpoint | Auth Method | Use Case | Returns Full Data? |
|----------|-------------|----------|-------------------|
| `/api/v1/*` | **API Key ONLY** | Production workflows, full CRUD | ✅ Yes |
| `/rest/*` | **Session Cookie** | Test environments, setup | ⚠️ Summary only (list) |
| `/rest/workflows/{id}` | **Session Cookie** | Get individual workflow | ✅ Yes (full data) |

---

## 🔑 Critical Authentication Rules

### Rule 1: `/api/v1` Requires API Keys (Both GET and POST)

**❌ DON'T:**
```typescript
// This will FAIL with 401: "'X-N8N-API-KEY' header required"
const client = axios.create({
  baseURL: `${baseURL}/api/v1`,
  headers: { 'Cookie': sessionCookie }
});
await client.get('/workflows'); // ❌ Fails!
```

**✅ DO:**
```typescript
// Use /rest endpoints when only session cookie is available
const client = axios.create({
  baseURL: `${baseURL}/rest`,
  headers: { 'Cookie': sessionCookie }
});
await client.get('/workflows'); // ✅ Works (but returns summary)
```

### Rule 2: `/rest/workflows` Returns Summary Data (No Nodes)

**❌ DON'T:**
```typescript
// This returns workflows WITHOUT nodes/connections
const response = await client.get('/rest/workflows');
const workflows = response.data.data; // ❌ Missing nodes!
```

**✅ DO:**
```typescript
// Step 1: Get summaries
const summaries = await client.get('/rest/workflows');
// Step 2: Fetch each workflow individually
for (const summary of summaries.data.data) {
  const full = await client.get(`/rest/workflows/${summary.id}`);
  workflows.push(full.data.data); // ✅ Full data with nodes
}
```

### Rule 3: Environment Variables Override Config

**❌ DON'T:**
```typescript
// If N8N_API_KEY exists in env (even empty string), it overrides config
const config = { sessionCookie: '...' };
const apiKey = config.apiKey || getN8nApiKey(); // ❌ Gets env var!
```

**✅ DO:**
```typescript
// Explicitly check config first, only fall back to env when no config
const apiKey = config ? (config.apiKey ?? undefined) : getN8nApiKey();
// Or explicitly delete env var when using session cookie
if (instance.sessionCookie && !instance.apiKey) {
  delete process.env.N8N_API_KEY; // ✅ Prevents override
}
```

---

## 📋 Current Implementation

### Authentication Detection Logic

**File:** `src/utils/n8n-api.ts`

```typescript
function createApiClient(config?: N8nApiConfig): AxiosInstance {
  const apiKey = config ? (config.apiKey ?? undefined) : getN8nApiKey();
  const sessionCookie = config ? (config.sessionCookie ?? undefined) : getN8nSessionCookie();
  
  // CRITICAL: Use /rest when only session cookie available
  const apiPath = (!apiKey && sessionCookie) ? '/rest' : '/api/v1';
  
  // ... rest of implementation
}
```

**Key Points:**
- ✅ Config values take precedence over environment variables
- ✅ `/rest` used automatically when only session cookie available
- ✅ `/api/v1` used when API key is present (even if session cookie also exists)

### Export Workflows Pattern

**File:** `src/utils/n8n-api.ts:214`

```typescript
export async function exportWorkflows(config?: N8nApiConfig): Promise<Workflow[]> {
  const useRestEndpoint = !apiKey && !!sessionCookie;
  
  if (useRestEndpoint) {
    // Step 1: Get summaries
    const summaries = await client.get('/rest/workflows');
    
    // Step 2: Fetch each workflow individually
    for (const summary of summaries.data.data) {
      const full = await client.get(`/rest/workflows/${summary.id}`);
      workflows.push(full.data.data); // Full data with nodes
    }
  } else {
    // Use /api/v1 with API key (returns full data directly)
    const response = await client.get('/workflows');
    workflows = response.data.data; // Full data
  }
}
```

**Why This Pattern:**
- `/rest/workflows` returns `{ count: number, data: Array<{id, name, ...}> }` (summary)
- `/rest/workflows/{id}` returns `{ data: {id, name, nodes, connections, ...} }` (full)
- `/api/v1/workflows` returns `{ data: [...], nextCursor: "..." }` (full, but requires API key)

### Import Workflow Pattern

**File:** `src/utils/n8n-api.ts:413`

```typescript
export async function importWorkflow(workflowData: Workflow, config?: N8nApiConfig): Promise<Workflow> {
  const useRestEndpoint = !apiKey && !!sessionCookie;
  
  // /rest requires 'active' field (NOT NULL constraint)
  const cleanedData = cleanWorkflowForApi(workflowData, useRestEndpoint);
  
  const response = await client.post('/workflows', cleanedData);
  
  // /rest wraps response in { data: {...} }
  const importedWorkflow = useRestEndpoint && response.data && 'data' in response.data
    ? (response.data as any).data
    : response.data;
    
  return importedWorkflow;
}
```

**Key Points:**
- ✅ `/rest` POST requires `active` field (defaults to `false`)
- ✅ `/rest` response is wrapped: `{ data: {...} }`
- ✅ `/api/v1` response is direct: `{...}`

---

## ⚠️ Common Pitfalls & Solutions

### Pitfall 1: Empty Nodes After Restore

**Symptom:**
```
Restored nodes (0 nodes): []
Original nodes (1 nodes): [{...}]
```

**Root Cause:**
- Using `/rest/workflows` for export returns summary data without nodes
- Verification step uses exported workflows which have no nodes

**Solution:**
- ✅ Fetch individual workflows: `/rest/workflows/{id}` for each workflow
- ✅ Verify workflows are fetched with full data before verification

### Pitfall 2: 401 Unauthorized on GET Requests

**Symptom:**
```
Failed to export workflows: 401 Unauthorized
Response: {"message":"'X-N8N-API-KEY' header required"}
```

**Root Cause:**
- Attempting to use `/api/v1/workflows` with session cookie
- `/api/v1` endpoints require API keys for ALL operations (GET and POST)

**Solution:**
- ✅ Use `/rest` endpoints when only session cookie available
- ✅ Or ensure API key is present before using `/api/v1`

### Pitfall 3: Environment Variable Override

**Symptom:**
```
Auth method: apiKey=present, sessionCookie=present
Using API key authentication with /api/v1 endpoints
// But API key is invalid/empty, causing 401
```

**Root Cause:**
- `N8N_API_KEY` environment variable exists (even if empty/old)
- Code falls back to environment when config doesn't explicitly set it
- Old/invalid API key overrides session cookie

**Solution:**
```typescript
// Explicitly delete env var when using session cookie
if (instance.sessionCookie && !instance.apiKey) {
  delete process.env.N8N_API_KEY;
}
```

### Pitfall 4: Missing Active Field

**Symptom:**
```
SQLITE_CONSTRAINT: NOT NULL constraint failed: workflow_entity.active
```

**Root Cause:**
- `/rest` POST endpoint requires `active` field (database constraint)
- `/api/v1` treats `active` as read-only

**Solution:**
```typescript
function cleanWorkflowForApi(workflowData: Workflow, useRestEndpoint: boolean) {
  const cleaned = { name, nodes, connections, settings };
  if (useRestEndpoint) {
    cleaned.active = workflowData.active ?? false; // ✅ Required for /rest
  }
  return cleaned;
}
```

### Pitfall 5: Response Format Mismatch

**Symptom:**
```
Workflow was imported but has no ID
Response data keys: data
```

**Root Cause:**
- `/rest` POST returns `{ data: {...} }` (wrapped)
- `/api/v1` POST returns `{...}` (direct)
- Code expects direct format

**Solution:**
```typescript
const importedWorkflow = useRestEndpoint && response.data && 'data' in response.data
  ? (response.data as any).data  // Unwrap /rest response
  : response.data;                // Use /api/v1 response directly
```

---

## ✅ Do's and Don'ts

### ✅ DO's

1. **DO use `/rest` endpoints when only session cookie is available**
   ```typescript
   const apiPath = (!apiKey && sessionCookie) ? '/rest' : '/api/v1';
   ```

2. **DO fetch individual workflows when using `/rest` for export**
   ```typescript
   // Get summaries first
   const summaries = await client.get('/rest/workflows');
   // Then fetch each individually
   for (const summary of summaries.data.data) {
     const full = await client.get(`/rest/workflows/${summary.id}`);
   }
   ```

3. **DO include `active` field for `/rest` POST requests**
   ```typescript
   if (useRestEndpoint) {
     cleaned.active = workflowData.active ?? false;
   }
   ```

4. **DO unwrap `/rest` responses**
   ```typescript
   const workflow = useRestEndpoint && response.data?.data
     ? response.data.data
     : response.data;
   ```

5. **DO explicitly delete environment variables when using config**
   ```typescript
   if (instance.sessionCookie && !instance.apiKey) {
     delete process.env.N8N_API_KEY;
   }
   ```

6. **DO log authentication method and endpoint used**
   ```typescript
   logger.info(`Using ${apiKey ? 'API key' : 'session cookie'} authentication with ${apiPath} endpoints`);
   ```

### ❌ DON'Ts

1. **DON'T use `/api/v1` with session cookies**
   ```typescript
   // ❌ This will fail
   const client = axios.create({
     baseURL: `${baseURL}/api/v1`,
     headers: { 'Cookie': sessionCookie }
   });
   ```

2. **DON'T assume `/rest/workflows` returns full data**
   ```typescript
   // ❌ Missing nodes/connections
   const workflows = await client.get('/rest/workflows');
   ```

3. **DON'T forget to unwrap `/rest` responses**
   ```typescript
   // ❌ Missing ID
   const workflow = response.data; // Should be response.data.data
   ```

4. **DON'T rely on environment variables when config is provided**
   ```typescript
   // ❌ May use stale env var
   const apiKey = config.apiKey || getN8nApiKey();
   // ✅ Explicit check
   const apiKey = config ? (config.apiKey ?? undefined) : getN8nApiKey();
   ```

5. **DON'T omit `active` field for `/rest` POST**
   ```typescript
   // ❌ Database constraint violation
   const cleaned = { name, nodes, connections }; // Missing active
   ```

6. **DON'T assume both endpoints work the same way**
   - Different response formats
   - Different required fields
   - Different authentication requirements

---

## 🔍 Debugging Checklist

When authentication fails:

1. ✅ **Check which endpoint is being used**
   ```typescript
   logger.info(`Creating API client for ${baseURL}${apiPath}`);
   ```

2. ✅ **Check which auth method is detected**
   ```typescript
   logger.info(`Auth method: apiKey=${apiKey ? 'present' : 'missing'}, sessionCookie=${sessionCookie ? 'present' : 'missing'}`);
   ```

3. ✅ **Check environment variables**
   ```typescript
   logger.debug(`Env: N8N_API_KEY=${process.env.N8N_API_KEY ? 'set' : 'unset'}, N8N_SESSION_COOKIE=${process.env.N8N_SESSION_COOKIE ? 'set' : 'unset'}`);
   ```

4. ✅ **Check response structure**
   ```typescript
   logger.info(`Response.data keys: ${Object.keys(response.data).join(', ')}`);
   ```

5. ✅ **Check if nodes are present**
   ```typescript
   logger.info(`Workflow nodes: ${Array.isArray(workflow.nodes) ? workflow.nodes.length : 'not array'}`);
   ```

---

## 📊 Test Results & Validation

### Successful Test Run

```
✅ Test Result Summary:
   Success: true
   Errors: 0
   Warnings: 0
   Stats:
     - Workflows backed up: 2
     - Workflows restored: 2
     - Workflows verified: 2
```

### Key Log Indicators

**✅ Good:**
```
Using session cookie authentication with /rest endpoints (Cookie header set)
Found 2 workflow(s) in summary, fetching full data for each...
Fetched full workflow: Simple Workflow 1 (1 nodes)
Total workflows fetched with full data: 2
```

**❌ Bad:**
```
Using API key authentication with /api/v1 endpoints
// But no API key available → 401 Unauthorized
```

**❌ Bad:**
```
Sample workflow: nodes=not array
⚠️  Workflow "Simple Workflow 1" has no nodes!
// Using /rest/workflows without individual fetch
```

---

## 🏗️ Architecture Decisions

### Why Two Endpoint Paths?

**Decision:** Automatically select `/rest` or `/api/v1` based on available authentication

**Rationale:**
- `/api/v1` requires API keys (production-ready, but API key creation fails in tests)
- `/rest` accepts session cookies (works in tests, but has limitations)
- Automatic selection allows code to work in both scenarios

**Implementation:**
```typescript
const apiPath = (!apiKey && sessionCookie) ? '/rest' : '/api/v1';
```

### Why Fetch Individual Workflows?

**Decision:** When using `/rest`, fetch each workflow individually after getting summaries

**Rationale:**
- `/rest/workflows` returns summary data (fast, but incomplete)
- `/rest/workflows/{id}` returns full data (slower, but complete)
- Trade-off: More requests but gets complete data

**Alternative Considered:**
- Use `/api/v1` with session cookies → ❌ Doesn't work (requires API key)

### Why Explicit Environment Variable Cleanup?

**Decision:** Explicitly delete `N8N_API_KEY` when using session cookies only

**Rationale:**
- Environment variables can persist across test runs
- Old/invalid API keys override session cookies
- Explicit cleanup ensures correct authentication method

**Implementation:**
```typescript
if (instance.sessionCookie && !instance.apiKey) {
  delete process.env.N8N_API_KEY;
}
```

---

## 📝 Code Patterns

### Pattern 1: Safe Authentication Detection

```typescript
// ✅ Good: Explicit check, no fallback to env when config provided
const apiKey = config ? (config.apiKey ?? undefined) : getN8nApiKey();
const sessionCookie = config ? (config.sessionCookie ?? undefined) : getN8nSessionCookie();
const useRestEndpoint = !apiKey && !!sessionCookie;
```

### Pattern 2: Endpoint Selection

```typescript
// ✅ Good: Automatic selection based on auth
const apiPath = (!apiKey && sessionCookie) ? '/rest' : '/api/v1';
const client = axios.create({
  baseURL: `${baseURL}${apiPath}`,
  headers: {
    ...(apiKey ? { 'X-N8N-API-KEY': apiKey } : { 'Cookie': sessionCookie }),
  },
});
```

### Pattern 3: Response Unwrapping

```typescript
// ✅ Good: Handle both response formats
const importedWorkflow = useRestEndpoint && response.data && 'data' in response.data
  ? (response.data as any).data  // /rest: { data: {...} }
  : response.data;                // /api/v1: {...}
```

### Pattern 4: Full Data Export

```typescript
// ✅ Good: Fetch summaries, then individual workflows
if (useRestEndpoint) {
  const summaries = await client.get('/rest/workflows');
  for (const summary of summaries.data.data) {
    const full = await client.get(`/rest/workflows/${summary.id}`);
    workflows.push(full.data.data);
  }
} else {
  const response = await client.get('/workflows');
  workflows = response.data.data;
}
```

---

## 🔗 Related Files

- `src/utils/n8n-api.ts` - Main API client implementation
- `src/utils/backup-restore-test.ts` - Test utilities using API
- `src/tests/integration/backup-restore.test.ts` - Integration tests
- `src/utils/n8n-setup.ts` - n8n instance setup (creates session cookies)
- `.cursor/n8n-integration-methods.md` - General integration methods reference

---

## 📚 References

- n8n REST API Docs: https://docs.n8n.io/api/
- n8n Version: 1.122.5 (latest as of 2025-01-09)
- Test Environment: Podman containers with isolated n8n instances

---

## 🎓 Key Learnings Summary

1. **`/api/v1` requires API keys for ALL operations** (GET, POST, PUT, DELETE)
2. **`/rest` accepts session cookies** but returns summary data for list endpoints
3. **Individual workflow fetch required** when using `/rest` to get full data
4. **Response formats differ** - `/rest` wraps in `{ data: {...} }`, `/api/v1` is direct
5. **Environment variables can override config** - explicit cleanup needed
6. **`active` field required** for `/rest` POST (database constraint)
7. **Automatic endpoint selection** based on auth method works well
8. **Comprehensive logging** is essential for debugging auth issues

---

**Last Updated:** 2025-01-09  
**Maintained By:** AI Assistant (Auto)  
**Status:** ✅ Production-Ready

