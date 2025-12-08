# Workflow Reference Management Scripts

This directory contains TypeScript scripts for managing and validating n8n workflow references, specifically for `@n8n/n8n-nodes-langchain.toolWorkflow` nodes.

## Problem

When n8n workflows use the `toolWorkflow` node with `"mode": "list"`, the workflow references can break when workflows are backed up and restored because:

1. n8n generates new random IDs for workflows on restore
2. The `toolWorkflow` nodes store workflow IDs, not names
3. When IDs don't match, the tool references break silently

## The Critical Problem

**When you restore workflows to n8n, n8n assigns NEW workflow IDs!**

This means:
1. You backup workflows from n8n → local JSON files have IDs like `sO4VcVy2m7hOCbJI`
2. You restore workflows to n8n → n8n assigns NEW IDs like `GwCBsdxV4CkAQPPf`
3. Your local files still reference the OLD IDs → **all toolWorkflow references are broken!**

## The Solution

**The backup command now automatically syncs workflow IDs!** Just run:

```bash
npm run n8n:workflows:downsync
```

This will:
1. Download workflows from n8n
2. Remove duplicate " (2).json" files
3. Automatically sync all toolWorkflow references to match n8n's current IDs

No manual intervention needed!

## Scripts

### 🔥 1. `sync-workflow-ids-from-n8n.ts` (MOST IMPORTANT)

**Syncs workflow IDs from your live n8n instance to local files.**

This is the script you need after every restore!

```bash
# Preview what will be synced
npx ts-node scripts/sync-workflow-ids-from-n8n.ts

# Apply the sync
npx ts-node scripts/sync-workflow-ids-from-n8n.ts --sync
```

**Requirements:**
- n8n must be running
- Set environment variables (in `.env` or shell):
  - `N8N_BASE_URL` (e.g., `http://localhost:5678`)
  - `N8N_API_KEY` or session cookie

**What it does:**
1. Fetches all workflows from n8n via API
2. Compares workflow names between n8n and local files
3. Updates local file references to match n8n's actual IDs

**Example output:**
```
[SYNC] Telegram Smart Agent
  Node: "Telegram Context Scout Tool"
  Target: Telegram Context Scout
  Local ID:  sO4VcVy2m7hOCbJI  ← OLD (from previous restore)
  n8n ID:    GwCBsdxV4CkAQPPf  ← NEW (current n8n instance)
```

### 2. `scan-tool-workflows.ts`

Scans all workflows and lists detailed information about `toolWorkflow` nodes.

```bash
npx ts-node scripts/scan-tool-workflows.ts
```

**Output:**
- Source workflow information
- Tool node names and IDs
- Target workflow IDs and names
- Summary of all unique target workflows

### 2. `scan-tool-workflows-simple.ts`

Simple list of unique workflow IDs referenced by `toolWorkflow` nodes.

```bash
npx ts-node scripts/scan-tool-workflows-simple.ts
```

**Output:**
- Alphabetically sorted list of workflow IDs
- Total count

### 3. `validate-tool-workflow-references.ts`

Validates all `toolWorkflow` references and identifies broken ones.

```bash
npx ts-node scripts/validate-tool-workflow-references.ts
```

**Output:**
- ✅ Valid references (workflow exists)
- ❌ Broken references (workflow missing)
- 💡 Suggestions for fixing (finds workflows by name)
- Summary statistics

**Exit codes:**
- `0` - All references valid
- `1` - Broken references found

### 4. `fix-tool-workflow-references.ts`

Automatically fixes broken `toolWorkflow` references by matching workflow names.

```bash
# Dry run (preview changes)
npx ts-node scripts/fix-tool-workflow-references.ts

# Apply fixes
npx ts-node scripts/fix-tool-workflow-references.ts --fix
```

**Features:**
- Matches workflows by exact name
- Tries common prefixes: `[LAB]`, `[HELPERS]`, `[LEGACY]`
- Updates workflow ID, cached URL, and cached name
- Preserves JSON formatting

## Recommended Workflows

### After Restoring Workflows to n8n

**The backup command now handles syncing automatically!**

```bash
# 1. Restore workflows to n8n
npm run n8n:workflows:upsync

# 2. Backup workflows from n8n (automatically syncs IDs!)
npm run n8n:workflows:downsync

# 3. Commit the updated workflow files
git add workflows/
git commit -m "Sync workflow IDs after backup/restore"
```

The backup command will automatically:
- Remove duplicate " (2).json" files
- Sync all toolWorkflow references to match n8n's current IDs
- Log the number of references fixed

### When Working with Local Files Only

If you're just fixing references between local files (not syncing with n8n):

```bash
# 1. Validate current state
npx ts-node scripts/validate-tool-workflow-references.ts

# 2. Preview fixes
npx ts-node scripts/fix-tool-workflow-references.ts

# 3. Apply fixes
npx ts-node scripts/fix-tool-workflow-references.ts --fix

# 4. Verify all references are valid
npx ts-node scripts/validate-tool-workflow-references.ts
```

## Example Fix

**Before (Broken):**
```json
{
  "workflowId": {
    "__rl": true,
    "value": "TelegramContextScout",
    "mode": "list",
    "cachedResultUrl": "/workflow/TelegramContextScout",
    "cachedResultName": "Telegram Context Scout"
  }
}
```

**After (Fixed):**
```json
{
  "workflowId": {
    "__rl": true,
    "value": "sO4VcVy2m7hOCbJI",
    "mode": "list",
    "cachedResultUrl": "/workflow/sO4VcVy2m7hOCbJI",
    "cachedResultName": "Telegram Context Scout"
  }
}
```

## CI/CD Integration

Add validation to your CI pipeline:

```bash
# In your CI script
npx ts-node scripts/validate-tool-workflow-references.ts
if [ $? -ne 0 ]; then
  echo "❌ Broken workflow references detected!"
  echo "Run: npx ts-node scripts/fix-tool-workflow-references.ts --fix"
  exit 1
fi
```

## Notes

- All scripts recursively scan the `workflows/` directory
- Scripts handle workflows in subdirectories (LAB, HELPERS, LEGACY)
- JSON files are preserved with 2-space indentation
- Scripts are safe to run multiple times (idempotent)

