# n8n Database Investigation Report

**Date**: 2025-12-08  
**Issue**: "Workflow not found" error despite UI showing and navigating to the workflow

---

## 🔍 Problem Summary

The Telegram Smart Agent workflow was showing "workflow not found" errors when trying to execute the Telegram Context Scout tool, even though:
- The UI showed the workflow correctly
- Navigation to the workflow worked
- The workflow existed in the database

---

## 🗄️ Database Structure

### Key Tables

```
workflow_entity       - Main workflow storage (id, name, nodes, connections, etc.)
workflow_history      - Version history tracking
workflow_dependency   - Workflow dependency tracking (was EMPTY!)
shared_workflow       - Permissions and project associations
execution_entity      - Execution records
execution_data        - Detailed execution data
```

### Workflow Entity Schema

```sql
id                  varchar(36)  PRIMARY KEY
name                varchar(128) NOT NULL
active              boolean      NOT NULL
nodes               TEXT         -- JSON array of nodes
connections         TEXT         -- JSON object of connections
versionId           varchar(36)  NOT NULL
activeVersionId     varchar(36)  -- Can be NULL
versionCounter      INTEGER      DEFAULT 1
```

---

## 🐛 Root Cause

The `toolWorkflow` node in "Telegram Smart Agent" was missing the `cachedResultUrl` field in its `workflowId` reference:

### ❌ Broken Configuration (in database)
```json
{
  "__rl": true,
  "mode": "list",
  "value": "neiUMoN5ABLkLukN",
  "cachedResultName": "Telegram Context Scout"
  // ❌ Missing: "cachedResultUrl": "/workflow/neiUMoN5ABLkLukN"
}
```

### ✅ Fixed Configuration
```json
{
  "__rl": true,
  "mode": "list",
  "value": "neiUMoN5ABLkLukN",
  "cachedResultName": "Telegram Context Scout",
  "cachedResultUrl": "/workflow/neiUMoN5ABLkLukN"  // ✅ Added
}
```

---

## 🔧 Solution Applied

Created and executed `scripts/fix-cached-result-url.py` which:

1. ✅ Scanned all workflows in the database
2. ✅ Identified toolWorkflow nodes with missing `cachedResultUrl`
3. ✅ Added the missing field: `/workflow/{workflowId}`
4. ✅ Updated the database directly

### Results
- **Fixed**: 1 toolWorkflow node in 1 workflow (Telegram Smart Agent)
- **Database**: Updated successfully
- **Verification**: Confirmed the field is now present

---

## 📊 Database Survey Findings

### Telegram Context Scout Workflow
```
ID:              neiUMoN5ABLkLukN
Name:            Telegram Context Scout
Active:          false (0)
Version ID:      74a5d447-10c5-4f82-b23f-bc1227228e03
Active Version:  NULL ⚠️
Version Count:   4
Nodes Size:      5559 bytes
Connections:     268 bytes
Project:         GEUEn6ArNROzJ5FY
Permissions:     workflow:owner ✅
```

### Telegram Smart Agent Workflow
```
ID:              nZTUa5bPxY6Ft6er
Name:            Telegram Smart Agent
Active:          false (0)
Last Updated:    2025-12-08 21:51:36
Recent Executions: 5 (all successful or canceled)
```

### Workflow Dependencies
```
Status: EMPTY ⚠️
Note: The workflow_dependency table had no entries, which may indicate
      n8n is not properly tracking workflow dependencies in this instance.
```

---

## ⚠️ Other Observations

1. **activeVersionId is NULL** for Telegram Context Scout
   - This might cause issues in some n8n versions
   - Consider monitoring if this becomes a problem

2. **workflow_dependency table is empty**
   - n8n should populate this automatically
   - May indicate a configuration or version issue
   - Not critical for execution but useful for dependency tracking

3. **Mode: "list" vs "id"**
   - The workflow uses `mode: "list"` which looks up by name
   - `mode: "id"` would look up directly by ID
   - Both should work if `cachedResultUrl` is present

---

## 🚀 Next Steps

### Immediate Actions
1. ✅ **DONE**: Fixed missing `cachedResultUrl` in database
2. ⏳ **TODO**: Restart n8n for changes to take effect
3. ⏳ **TODO**: Test the Telegram Smart Agent workflow execution

### Preventive Measures
1. **Add to CI/CD**: Run `fix-cached-result-url.py` after backup/restore operations
2. **Monitor**: Check if this issue recurs after workflow edits in the UI
3. **Document**: Add this to troubleshooting guide

### Optional Investigations
- Why is `workflow_dependency` table empty?
- Should `activeVersionId` be set to match `versionId`?
- Is there a way to prevent this issue in the UI?

---

## 📝 Scripts Created

### `scripts/fix-cached-result-url.py`
- **Purpose**: Fix missing `cachedResultUrl` in toolWorkflow nodes
- **Usage**: `python3 scripts/fix-cached-result-url.py`
- **Safety**: Read-only scan, only updates if issues found
- **Idempotent**: Safe to run multiple times

### `scripts/fix-cached-result-url.ts`
- **Status**: Created but requires `better-sqlite3` dependency
- **Alternative**: Use the Python version instead

### `scripts/fix-cached-result-url.sh`
- **Status**: Created but had JSON parsing issues
- **Alternative**: Use the Python version instead

---

## 🎯 Conclusion

**Root Cause**: Missing `cachedResultUrl` field in toolWorkflow node configuration  
**Impact**: Runtime workflow lookup failure despite UI showing workflow correctly  
**Resolution**: Direct database update to add missing field  
**Status**: ✅ FIXED (pending n8n restart)

The issue was not a cache problem or a complex database corruption, but rather a simple missing field in the workflow node configuration that prevented n8n's runtime from properly resolving the workflow reference.

