# n8n Agent Scripts

Utility scripts for managing **production n8n** workflows.

> **Note**: Integration tests use containerized n8n instances and don't need these scripts. These scripts are for maintaining your local production n8n instance.

## 🚀 Quick Start

```bash
# Fix workflow references in production n8n database
npm run n8n:db:fix

# Check for issues without fixing
npm run n8n:db:check
```

---

## 📁 Scripts

### Production Database Maintenance

**`fix-workflow-references.py`** - Production n8n database fixer

Fixes in your local `~/.n8n/database.sqlite`:
- Missing `cachedResultUrl` in toolWorkflow nodes
- Wrong references in executeWorkflow nodes
- Hardcoded old workflow IDs
- Friendly names in fetchWorkflowId configs

```bash
python3 scripts/fix-workflow-references.py           # Fix all issues
python3 scripts/fix-workflow-references.py --check-only  # Check only
```

### Backup Workflow Support

**`post-backup-sync.ts`** - Post-backup synchronization

Used automatically by backup command. Can also run manually:
```bash
npm run n8n:workflows:sync
```

This script:
1. Removes duplicate " (2).json" files created by backup
2. Syncs workflow IDs from n8n to fix toolWorkflow references

---

## 📋 NPM Scripts

```bash
npm run n8n:workflows:downsync  # Export from production n8n
npm run n8n:workflows:upsync    # Import to production n8n  
npm run n8n:workflows:sync      # Sync after backup
npm run n8n:db:fix              # Fix production database
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

- **Production only**: These scripts work on `~/.n8n/database.sqlite`
- **Testing**: Integration tests use isolated containers (no scripts needed)
- **Backup recommended**: `cp ~/.n8n/database.sqlite ~/.n8n/database.sqlite.backup`
- Always restart n8n after running fixes
- Scripts are safe and idempotent

---

**See also**: `../README.md` for main documentation
