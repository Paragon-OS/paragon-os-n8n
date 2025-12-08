# Workflow Reference Fixes

Quick guide for fixing "Workflow does not exist" errors.

## 🎯 Quick Fix

```bash
npm run n8n:db:fix
# Restart n8n
```

---

## 🐛 What Gets Fixed

| Issue | Cause |
|-------|-------|
| Missing `cachedResultUrl` | UI doesn't populate field |
| Wrong workflow references | Using names instead of IDs |
| Old workflow IDs | Workflow deleted/recreated |
| Friendly names in config | Platform config using names |

---

## 🔧 Usage

```bash
# Fix all issues
npm run n8n:db:fix

# Check without fixing
npm run n8n:db:check
```

---

## 📋 When to Run

- After importing/exporting workflows
- After deleting/recreating workflows
- When seeing "Workflow does not exist" errors
- After manual workflow edits

---

## ⚠️ Important

1. **Always restart n8n** after running fixes
2. Scripts are safe and idempotent
3. Backup recommended (optional):
   ```bash
   cp ~/.n8n/database.sqlite ~/.n8n/database.sqlite.backup
   ```

---

## 🆘 Still Having Issues?

1. Check logs: `tail -100 ~/.n8n/n8nEventLog.log`
2. Verify workflow exists: `sqlite3 ~/.n8n/database.sqlite "SELECT id, name FROM workflow_entity;"`
3. Run fix again: `npm run n8n:db:fix`

---

**See also**: `scripts/README.md` for technical details
