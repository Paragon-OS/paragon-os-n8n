# Workflow Reference Management Scripts

This directory contains TypeScript scripts for managing and validating n8n workflow references, specifically for `@n8n/n8n-nodes-langchain.toolWorkflow` nodes.

## Problem

When n8n workflows use the `toolWorkflow` node with `"mode": "list"`, the workflow references can break when workflows are backed up and restored because:

1. n8n generates new random IDs for workflows on restore
2. The `toolWorkflow` nodes store workflow IDs, not names
3. When IDs don't match, the tool references break silently

## Scripts

### 1. `scan-tool-workflows.ts`

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

## Workflow

Recommended workflow for maintaining workflow references:

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

