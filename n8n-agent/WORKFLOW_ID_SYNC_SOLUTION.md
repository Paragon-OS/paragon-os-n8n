# Workflow ID Sync Solution

## The Problem

**n8n assigns NEW random IDs every time workflows are restored!**

### What Happens:

1. **Backup** workflows from n8n → Local files have IDs like `sO4VcVy2m7hOCbJI`
2. **Restore** workflows to n8n → n8n assigns NEW IDs like `GwCBsdxV4CkAQPPf`  
3. **Backup** again → Creates duplicate " (2).json" files with NEW workflow IDs
4. **Problem:** Tool workflow references INSIDE the workflows still point to OLD IDs!

### Example:

```json
// After restore, Telegram Smart Agent has NEW ID: GwCBsdxV4CkAQPPf
// But inside the workflow, it still references OLD ID:
{
  "workflowId": {
    "value": "sO4VcVy2m7hOCbJI",  // ❌ BROKEN! This ID no longer exists
    "cachedResultName": "Telegram Context Scout"
  }
}
```

## The Solution

**The backup command now automatically syncs workflow IDs!**

### Correct Workflow (Use This Always):

```bash
# 1. Restore workflows to n8n
npm run n8n:workflows:upsync

# 2. Backup workflows from n8n (automatically syncs!)
npm run n8n:workflows:downsync

# 3. Commit the corrected files
git add -A
git commit -m "Sync workflow IDs after backup/restore"
```

The backup command automatically:
1. ✅ Downloads workflows from n8n
2. ✅ Removes duplicate " (2).json" files
3. ✅ Fetches ACTUAL workflow IDs from running n8n instance
4. ✅ Updates all toolWorkflow references to match n8n's current IDs

### Manual Sync (If Needed):

If you need to manually sync without running a full backup:

```bash
npm run n8n:workflows:sync
```

## What Gets Fixed

### Before Sync:
```
[LAB] Discord Manager.json:
  "value": "lkisW81LSe2jeWHy"  ← OLD ID (doesn't exist in n8n)
```

### After Sync:
```
[LAB] Discord Manager.json:
  "value": "6gtq7qBAYQCuJBvY"  ← NEW ID (matches n8n)
```

## Scripts Available

### 1. `npm run n8n:workflows:sync` (POST-BACKUP SYNC)
**Run this after every backup!**
- Removes " (2).json" duplicates
- Syncs IDs from n8n
- Fixes all toolWorkflow references

### 2. `npx ts-node scripts/sync-workflow-ids-from-n8n.ts`
Manual sync (if you just need to update IDs without cleanup):
```bash
# Preview changes
npx ts-node scripts/sync-workflow-ids-from-n8n.ts

# Apply changes
npx ts-node scripts/sync-workflow-ids-from-n8n.ts --sync
```

### 3. `npx ts-node scripts/validate-tool-workflow-references.ts`
Validate all references are correct:
```bash
npx ts-node scripts/validate-tool-workflow-references.ts
```

### 4. `npx ts-node scripts/fix-tool-workflow-references.ts`
Fix references between local files (doesn't query n8n):
```bash
# Preview
npx ts-node scripts/fix-tool-workflow-references.ts

# Apply
npx ts-node scripts/fix-tool-workflow-references.ts --fix
```

## Why This Happens

n8n's workflow restore process:
1. Reads workflow JSON from file
2. **Ignores the `id` field** in the JSON
3. **Generates a NEW random ID** for the workflow
4. Saves workflow with the new ID

This means:
- Every restore creates different IDs
- References inside workflows become stale
- Tool calls break silently

## Requirements

The sync script needs to connect to your running n8n instance.

**Environment variables** (in `.env` or shell):
```bash
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=your-api-key-here
```

Or use session cookie authentication (see n8n-api.ts for details).

## Verification

After running the sync, verify everything is correct:

```bash
# Should show: ✓ All references are valid!
npx ts-node scripts/validate-tool-workflow-references.ts
```

## Current State

After running the sync script, all 25 toolWorkflow references now point to the correct IDs in your n8n instance:

| Workflow | Old ID (broken) | New ID (correct) |
|----------|----------------|------------------|
| Discord Context Scout | `BB1zsros5LmyJO9N` | `se6HJcNvN5iki6D3` |
| Telegram Context Scout | `sO4VcVy2m7hOCbJI` | `GwCBsdxV4CkAQPPf` |
| [LAB] Discord MCP Client | `lkisW81LSe2jeWHy` | `6gtq7qBAYQCuJBvY` |
| ... and 22 more | | |

## Remember

**The backup command now handles this automatically!**

Just run `npm run n8n:workflows:downsync` and workflow IDs will be synced automatically.

No manual intervention needed - the sync happens as part of the backup process.

