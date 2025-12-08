# Fixing Missing `cachedResultUrl` in n8n ToolWorkflow Nodes

## Problem

When n8n's `toolWorkflow` nodes are configured to call other workflows, they store a reference like this:

```json
{
  "__rl": true,
  "mode": "list",
  "value": "workflowId123",
  "cachedResultName": "My Workflow",
  "cachedResultUrl": "/workflow/workflowId123"  // ← This field
}
```

Sometimes the `cachedResultUrl` field is missing, causing **"workflow not found"** errors at runtime, even though:
- The workflow exists in the database
- The UI shows and navigates to the workflow correctly
- The workflow can be manually opened

## Why This Happens

This appears to be a UI bug where n8n doesn't always populate the `cachedResultUrl` field when you:
1. Configure a toolWorkflow node
2. Select a workflow from the dropdown
3. Save the workflow

The UI can navigate using the workflow name, but the runtime execution engine requires the `cachedResultUrl` for proper resolution.

---

## Solutions

We provide **three approaches** to fix this issue:

### 1. 🔧 Direct Database Fix (Fastest)

**When to use**: Quick fix, n8n is stopped or you can restart it

```bash
npm run n8n:db:fix-cached-urls
```

**What it does**:
- Directly modifies the SQLite database
- Scans all workflows for missing `cachedResultUrl`
- Adds the field: `/workflow/{workflowId}`
- ⚠️ **Requires n8n restart** to take effect

**Pros**:
- Very fast (< 1 second)
- Works even if n8n is stopped
- Safe and idempotent

**Cons**:
- Requires n8n restart
- Bypasses n8n's internal validation

---

### 2. 🔄 API-Based Regeneration (Proper)

**When to use**: n8n is running, you want n8n to handle the fix

```bash
npm run n8n:db:regenerate-cached-urls
```

**What it does**:
- Connects to n8n via REST API
- Fetches all workflows
- Identifies workflows with missing `cachedResultUrl`
- Re-saves each workflow via API
- n8n regenerates the field automatically

**Pros**:
- No restart needed
- Lets n8n handle field generation
- Respects n8n's internal logic

**Cons**:
- Slower (API calls for each workflow)
- Requires n8n to be running
- Needs API key or session cookie

---

### 3. 🎯 Combined Approach (Recommended)

**When to use**: You want both speed and proper regeneration

```bash
npm run n8n:db:fix-and-regenerate
```

**What it does**:
1. First: Direct database fix (instant)
2. Then: API regeneration (proper)
3. Verifies both approaches succeeded

**Options**:
```bash
# Only database fix
npm run n8n:db:fix-and-regenerate -- --db-only

# Only API regeneration
npm run n8n:db:fix-and-regenerate -- --api-only

# Both (default)
npm run n8n:db:fix-and-regenerate
```

---

## Manual Verification

After running any fix, verify the issue is resolved:

### Check Database

```bash
sqlite3 ~/.n8n/database.sqlite "
  SELECT nodes 
  FROM workflow_entity 
  WHERE name = 'Your Workflow Name'
" | python3 -m json.tool | grep -A 5 cachedResultUrl
```

You should see:
```json
"cachedResultUrl": "/workflow/workflowId123"
```

### Check via API

```bash
curl -H "X-N8N-API-KEY: your-api-key" \
  http://localhost:5678/api/v1/workflows/workflowId123 \
  | jq '.nodes[] | select(.type == "@n8n/n8n-nodes-langchain.toolWorkflow") | .parameters.workflowId'
```

### Test Execution

1. Open the affected workflow in n8n UI
2. Click "Test workflow" or "Execute"
3. Verify the toolWorkflow node executes successfully

---

## Prevention

To prevent this issue from recurring:

### 1. After Backup/Restore

Always run the fix after restoring workflows:

```bash
npm run n8n:workflows:upsync
npm run n8n:db:fix-and-regenerate
```

### 2. After Manual Edits

If you manually edit toolWorkflow nodes in the UI:
1. Save the workflow
2. Run `npm run n8n:db:regenerate-cached-urls`
3. Or restart n8n to ensure changes are applied

### 3. CI/CD Integration

Add to your deployment scripts:

```bash
# After deploying n8n workflows
npm run n8n:db:fix-cached-urls
# Restart n8n
systemctl restart n8n
```

---

## Troubleshooting

### "No issues found" but still getting errors

1. **Check if you restarted n8n** (required for database fixes)
2. **Clear browser cache** (UI might be cached)
3. **Check the actual error message** - might be a different issue
4. **Verify workflow exists**:
   ```bash
   sqlite3 ~/.n8n/database.sqlite "SELECT id, name FROM workflow_entity WHERE id = 'workflowId123';"
   ```

### API regeneration fails

1. **Check n8n is running**: `curl http://localhost:5678/healthz`
2. **Set API credentials**:
   ```bash
   export N8N_API_KEY="your-api-key"
   # OR
   export N8N_SESSION_COOKIE="your-session-cookie"
   ```
3. **Check n8n URL**:
   ```bash
   export N8N_URL="http://localhost:5678"
   ```

### Database is locked

If you get "database is locked" error:
1. Stop n8n: `systemctl stop n8n` (or kill the process)
2. Run the database fix
3. Start n8n: `systemctl start n8n`

---

## Technical Details

### Database Location

```
~/.n8n/database.sqlite
```

### Affected Table

```sql
workflow_entity
  - id (workflow ID)
  - name (workflow name)
  - nodes (JSON array, contains toolWorkflow nodes)
```

### Node Structure

```typescript
{
  type: '@n8n/n8n-nodes-langchain.toolWorkflow',
  parameters: {
    workflowId: {
      __rl: true,
      mode: 'list' | 'id',
      value: string,              // The workflow ID
      cachedResultName: string,   // Human-readable name
      cachedResultUrl: string     // URL path (THIS FIELD)
    }
  }
}
```

### Why `cachedResultUrl` is Important

n8n's runtime uses this field to:
1. Quickly resolve workflow references without database lookups
2. Validate that the referenced workflow exists
3. Generate proper execution context

Without it, the runtime falls back to slower lookups that may fail if:
- The workflow name changed
- Multiple workflows have similar names
- The workflow was moved to a different folder

---

## Related Issues

- Workflow dependency table empty: Not critical, but indicates n8n might not be tracking dependencies
- `activeVersionId` is NULL: Monitor if this causes issues in your n8n version
- Mode `list` vs `id`: Both should work if `cachedResultUrl` is present

---

## Scripts Reference

| Script | File | Purpose |
|--------|------|---------|
| `n8n:db:fix-cached-urls` | `fix-cached-result-url.py` | Direct DB fix |
| `n8n:db:regenerate-cached-urls` | `regenerate-cached-urls.ts` | API regeneration |
| `n8n:db:fix-and-regenerate` | `fix-and-regenerate-cached-urls.py` | Combined approach |

All scripts are:
- ✅ Safe to run multiple times (idempotent)
- ✅ Read-only scan first
- ✅ Only modify if issues found
- ✅ Provide detailed output

---

## Questions?

See also:
- `DB_INVESTIGATION_REPORT.md` - Detailed investigation of the original issue
- `n8n-agent/src/utils/n8n-api.ts` - API client implementation
- n8n documentation: https://docs.n8n.io/

