# n8n Agent Scripts

Utility scripts for managing n8n workflows.

## 🚀 Quick Start

```bash
# Fix all workflow reference issues
npm run n8n:db:fix

# Check for issues without fixing
npm run n8n:db:check
```

---

## 📁 Scripts

### Database Fixes

**`fix-workflow-references.py`** - All-in-one workflow reference fixer

Fixes:
- Missing `cachedResultUrl` in toolWorkflow nodes
- Wrong references in executeWorkflow nodes
- Hardcoded old workflow IDs
- Friendly names in fetchWorkflowId configs

```bash
python3 scripts/fix-workflow-references.py           # Fix all issues
python3 scripts/fix-workflow-references.py --check-only  # Check only
```

### Workflow Management

**TypeScript utilities** for workflow sync and validation:
- `post-backup-sync.ts` - Post-backup tasks
- `sync-workflow-ids-from-n8n.ts` - Sync workflow IDs
- `fix-tool-workflow-references.ts` - Fix tool references
- `validate-tool-workflow-references.ts` - Validate references
- `scan-tool-workflows.ts` - Scan for tool workflows

---

## 📋 NPM Scripts

```bash
npm run n8n:workflows:downsync  # Export from n8n
npm run n8n:workflows:upsync    # Import to n8n
npm run n8n:db:fix              # Fix workflow references
npm run n8n:db:check            # Check for issues
```

---

## 🔧 Customization

To add custom ID replacements, edit `fix-workflow-references.py`:

```python
ID_REPLACEMENTS = {
    'oldId123': 'New Workflow Name',  # Will look up ID
    'oldId456': 'newId789',           # Direct replacement
}

FRIENDLY_NAME_TO_WORKFLOW = {
    'MyFriendlyName': '[HELPERS] Actual Workflow Name',
}
```

---

## ⚠️ Important

- Always restart n8n after running fixes
- Scripts are safe and idempotent
- Backup recommended: `cp ~/.n8n/database.sqlite ~/.n8n/database.sqlite.backup`

---

**See also**: `../README.md` for main documentation
