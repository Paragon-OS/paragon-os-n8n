# Root Cause Analysis: testMode Parameter Leaking into Agent Tool Schema

## Problem Statement

The `testMode` parameter is appearing in the tool schema presented to the AI agent, even though:
- All JSON workflow files are correct (no `testMode` in workflow trigger inputs)
- Redis cache is being flushed
- Workflows are being re-imported

The agent sees `testMode` in the schema and tries to send it, causing issues.

## Root Cause

### The Core Issue

n8n's `toolWorkflow` node has a **runtime schema generation behavior** that can override manual schema definitions:

1. **When `mode: "list"` is used**: The `toolWorkflow` node reads the workflow definition from n8n's database at runtime (not from the JSON file)
2. **Schema generation**: Even with `mappingMode: "defineBelow"`, n8n may:
   - Read the workflow's trigger node definition from the database
   - Generate a schema from the trigger's `workflowInputs.values` array
   - Merge this with the manual schema, or use it as the source of truth
3. **Stale database state**: If the workflow in the database still has `testMode` in its trigger inputs (from previous Test Runner executions or imports), the toolWorkflow node will see it and include it in the tool schema

### Evidence

Looking at the codebase:

1. **Telegram Context Scout workflow** (`Telegram Context Scout.json`):
   - Trigger node (lines 10-37) defines only: `query`, `entity`, `mode`
   - **No `testMode` in the trigger definition**

2. **Test Runner workflow** (`[HELPERS] Test Runner.json`):
   - When executing Telegram Context Scout (lines 234-300), it passes `testMode: true` (line 246)
   - Includes `testMode` in the schema (lines 277-285)
   - This execution may persist `testMode` in the database workflow definition

3. **Telegram Smart Agent** (`Telegram Smart Agent.json`):
   - Uses `toolWorkflow` node with `mode: "list"` (line 145)
   - This causes it to read the workflow definition from the database at runtime
   - If the database has `testMode`, it will appear in the schema

### Why This Happens

The `toolWorkflow` node's behavior when `mode: "list"`:
- Uses `cachedResultUrl` and `cachedResultName` to reference workflows
- At runtime, queries n8n's database for the workflow definition
- Extracts trigger inputs from the database version, not the JSON file
- Generates tool schema from these trigger inputs

This is a **design behavior** of n8n - it allows workflows to be updated in the UI without needing to update all referencing toolWorkflow nodes. However, it creates a dependency on the database state.

## Current Solution Analysis

The implemented solution works by:

1. **Flushing Redis cache**: Clears any cached workflow definitions
2. **Double re-import**: Forces n8n to process the workflow twice, ensuring database is updated
3. **Re-import Telegram Smart Agent last**: Refreshes its tool references after all tool workflows are updated
4. **Delays**: Gives n8n time to process and persist changes

**Why it works**: The double import ensures the database state matches the JSON files, and importing the Smart Agent last ensures it reads the correct state.

**Limitations**: 
- Fragile - depends on timing and order
- May not work if n8n has internal caching beyond Redis
- Doesn't address the root cause (database/workflow state divergence)

## Alternative Approaches

### 1. Delete and Re-create Workflows (Most Reliable)

Instead of just importing, delete workflows first, then import:

```bash
# Delete workflow
n8n delete:workflow --id=<workflow-id>

# Then import
n8n import:workflow --input=<file>
```

**Pros**: 
- Ensures clean state
- No stale data in database
- Most reliable

**Cons**:
- Loses execution history
- More disruptive
- Requires workflow IDs

### 2. Check Workflow Versioning

n8n has workflow versioning (`versionId`, `activeVersionId`, `versionCounter`). Check if:
- Multiple versions exist with different trigger inputs
- Active version differs from latest version
- Version history contains `testMode`

**Action**: Export workflow and check version metadata:
```bash
n8n export:workflow --id=<workflow-id> --pretty
```

### 3. Verify Database State Directly

Export the workflow from n8n and verify what's actually stored:

```bash
# Export current workflow from n8n
n8n export:workflow --id=TelegramContextScout --pretty > current-workflow.json

# Check trigger inputs
jq '.nodes[] | select(.type == "n8n-nodes-base.executeWorkflowTrigger") | .parameters.workflowInputs.values' current-workflow.json
```

**If `testMode` appears here but not in JSON file**: Database is out of sync.

### 4. Add Logging to Agent Calls

Add logging to see what the agent is actually sending:

- Log tool schema when toolWorkflow node initializes
- Log actual tool calls from the agent
- Compare schema vs. actual calls

This helps identify if:
- Schema generation is the issue
- Agent is hallucinating `testMode`
- There's a different source of the parameter

### 5. Use `mode: "id"` Instead of `mode: "list"`

Change toolWorkflow nodes to use `mode: "id"` instead of `mode: "list"`:

**Current**:
```json
"workflowId": {
  "__rl": true,
  "value": "TelegramContextScout",
  "mode": "list"
}
```

**Alternative**:
```json
"workflowId": {
  "__rl": true,
  "value": "TelegramContextScout",
  "mode": "id"
}
```

**Pros**: 
- May use workflow ID directly instead of querying database
- Less dependent on database state

**Cons**:
- May not work if n8n still queries database for workflow definition
- Need to verify behavior

### 6. Explicitly Remove testMode from Schema

In toolWorkflow nodes, explicitly define schema without `testMode`:

```json
"workflowInputs": {
  "mappingMode": "defineBelow",
  "schema": [
    { "id": "query", "type": "string" },
    { "id": "entity", "type": "string" },
    { "id": "mode", "type": "string" }
    // Explicitly exclude testMode
  ]
}
```

**Pros**: 
- Explicit control over schema
- Less dependent on database state

**Cons**:
- May be overridden by n8n's runtime behavior
- Need to maintain manually

## Recommended Solution

### Short-term (Immediate Fix)

1. **Verify database state**: Export workflows and check for `testMode`
2. **Delete and re-import**: For affected workflows, delete then import to ensure clean state
3. **Add verification step**: After import, export and verify trigger inputs match JSON files

### Long-term (Preventive)

1. **Isolate test workflows**: 
   - Create separate test versions of workflows
   - Use different workflow IDs for test vs. production
   - Don't use production workflows in Test Runner

2. **Schema validation**:
   - Add a script to verify workflow trigger inputs match expected schema
   - Run after imports to catch divergence early

3. **Workflow state management**:
   - Document which workflows are used by Test Runner
   - Create cleanup script to reset workflows after tests
   - Consider workflow templates vs. instances

4. **Monitor tool schema generation**:
   - Add logging to toolWorkflow nodes
   - Track when schemas diverge from expected
   - Alert on unexpected parameters

## Verification Steps

### Automated Verification (Recommended)

Use the new `verify` command to automatically check all workflows:

```bash
# Check all workflows
npm run n8n:verify

# Check specific workflow
npm run n8n:verify -- --workflow=TelegramContextScout
```

This will:
- Export each workflow from the database
- Compare trigger inputs with JSON files
- Report any mismatches (especially testMode)
- Exit with error code if issues found

### Manual Verification

1. **Export workflow from n8n**:
   ```bash
   n8n export:workflow --id=TelegramContextScout --pretty > /tmp/current.json
   ```

2. **Check trigger inputs**:
   ```bash
   jq '.nodes[] | select(.id == "telegram-trigger") | .parameters.workflowInputs.values' /tmp/current.json
   ```

3. **Compare with JSON file**:
   ```bash
   jq '.nodes[] | select(.id == "telegram-trigger") | .parameters.workflowInputs.values' n8n-agent/workflows/Telegram\ Context\ Scout.json
   ```

4. **If they differ**: Database is out of sync - delete and re-import

5. **Check toolWorkflow schema**:
   - Export Telegram Smart Agent
   - Check toolWorkflow node schema
   - Verify it matches expected (no testMode)

## Related Files

- `n8n-agent/workflows/Telegram Context Scout.json` - Tool workflow definition
- `n8n-agent/workflows/Telegram Smart Agent.json` - Uses toolWorkflow with mode: "list"
- `n8n-agent/workflows/HELPERS/[HELPERS] Test Runner.json` - Passes testMode to workflows
- `n8n-agent/src/commands/restore.ts` - Workflow import logic

## Questions to Investigate

1. Does n8n cache workflow definitions beyond Redis?
2. Does `mode: "id"` vs `mode: "list"` change the behavior?
3. Can we force toolWorkflow to use JSON file schema instead of database?
4. Is there a way to lock workflow trigger inputs?
5. Does workflow versioning affect this behavior?

