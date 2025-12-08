# Workflow Reference Fix Summary

## Problem Identified

All 25 `@n8n/n8n-nodes-langchain.toolWorkflow` nodes had **broken references** due to workflow ID mismatches between the n8n UI (which uses friendly names) and the actual workflow IDs in the JSON files.

## Root Cause

When using `"mode": "list"` in n8n's toolWorkflow nodes:
- The UI allows selecting workflows by name
- But stores a workflow ID in the `value` field
- When workflows are backed up/restored, n8n generates **new random IDs**
- The old IDs in the references become invalid, breaking the tool calls

## Solution

Created automated scripts to:
1. Scan all workflows for toolWorkflow nodes
2. Validate references against actual workflow IDs
3. Fix broken references by matching workflow names
4. Handle prefixed workflows ([LAB], [HELPERS], [LEGACY])

## Results

### Before Fix
- **Total references:** 25
- **Valid references:** 0 ❌
- **Broken references:** 25 ❌

### After Fix
- **Total references:** 25
- **Valid references:** 25 ✅
- **Broken references:** 0 ✅

## Fixed References

### 1. Discord Smart Agent (2 fixes)
- **Discord Context Scout Tool**
  - Old: `BB1zsros5LmyJO9N` → New: `Qp9xNaJkQraiWaP6`
- **Step Executor**
  - Old: `uoYXevOl4ePWKeNx` → New: `s2NhwrkH9FPXGCwN`

### 2. Telegram Smart Agent (2 fixes)
- **Telegram Context Scout Tool**
  - Old: `TelegramContextScout` → New: `sO4VcVy2m7hOCbJI`
- **Step Executor (Telegram)**
  - Old: `uoYXevOl4ePWKeNx` → New: `s2NhwrkH9FPXGCwN`

### 3. ParagonOS Manager (2 fixes)
- **Telegram Smart Agent Tool**
  - Old: `TelegramSmartAgent` → New: `CO0VXGivAsYQ9c6P`
- **Discord Smart Agent Tool**
  - Old: `zBL0JT7t26pK2x95` → New: `UTz2UUDkV6DZEpvT`

### 4. [LAB] Discord Manager (8 fixes)
All references to `Discord MCP Client` (old: `qXzz33pAVkLd4UOO` → new: `lkisW81LSe2jeWHy`):
- List last messages
- Search Discord Servers
- List Discord Servers
- List Discord Channels
- Get Channel Messages
- Send Discord Server Message
- Send Discord DM

Plus:
- **Call 'Discord Contact CRUD Agent'**
  - Old: `VIzl0XsRciC94VMQ` → New: `rTEquT4sS2RsfqCy`

### 5. [LAB] Discord Message Retriever (8 fixes)
Same as Discord Manager - all Discord MCP Client references fixed

### 6. [LAB] Discord Contact CRUD Agent (1 fix)
- **Fetch a user profile**
  - Old: `qXzz33pAVkLd4UOO` → New: `lkisW81LSe2jeWHy`

### 7. [LAB] MCP Server (1 fix)
- **Call 'ParagonOS Manager'**
  - Old: `z1Ry4y4k5dGR0BqR` → New: `b693RI56eldkhQEf`

### 8. [LAB] Playbook v1 ParagonOS Manager (1 fix)
- **Discord Agent with Caching**
  - Old: `vfcxqLBDDMKL5lnG` → New: `RImj9SkyH8aLV1Rg`

## Current Valid Workflow IDs

All toolWorkflow nodes now correctly reference these 9 workflows:

| Workflow ID | Workflow Name | References |
|-------------|---------------|------------|
| `CO0VXGivAsYQ9c6P` | Telegram Smart Agent | 1 |
| `Qp9xNaJkQraiWaP6` | Discord Context Scout | 1 |
| `RImj9SkyH8aLV1Rg` | [LAB] Discord MCP Client Sequencer | 1 |
| `UTz2UUDkV6DZEpvT` | Discord Smart Agent | 1 |
| `b693RI56eldkhQEf` | ParagonOS Manager | 1 |
| `lkisW81LSe2jeWHy` | [LAB] Discord MCP Client | 15 |
| `rTEquT4sS2RsfqCy` | [LAB] Discord Contact CRUD Agent | 2 |
| `s2NhwrkH9FPXGCwN` | [HELPERS] Discord & Telegram Step Executor | 2 |
| `sO4VcVy2m7hOCbJI` | Telegram Context Scout | 1 |

## Modified Files

8 workflow files were updated:
1. `workflows/Discord Smart Agent.json`
2. `workflows/Telegram Smart Agent.json`
3. `workflows/ParagonOS Manager.json`
4. `workflows/LAB/[LAB] Discord Contact CRUD Agent.json`
5. `workflows/LAB/[LAB] Discord Manager.json`
6. `workflows/LAB/[LAB] Discord Message Retriever.json`
7. `workflows/LAB/[LAB] MCP Server.json`
8. `workflows/LAB/[LAB] Playbook v1 ParagonOS Manager.json`

## Scripts Created

Four new TypeScript scripts in `scripts/`:
1. `scan-tool-workflows.ts` - Detailed scan of all toolWorkflow nodes
2. `scan-tool-workflows-simple.ts` - Simple list of referenced IDs
3. `validate-tool-workflow-references.ts` - Validate all references
4. `fix-tool-workflow-references.ts` - Automatically fix broken references

See `scripts/README.md` for usage details.

## Next Steps

1. **Test the workflows** - Deploy and test that tool calls now work correctly
2. **Add to CI/CD** - Run validation script in your pipeline
3. **Regular maintenance** - Run validation after any workflow restore/backup

## Validation

To verify all references are valid:
```bash
npx ts-node scripts/validate-tool-workflow-references.ts
```

Expected output: ✅ All references are valid!

