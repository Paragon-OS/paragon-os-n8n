# Workflow ID Preservation

## Overview

The restore command now supports preserving workflow IDs during import by using direct database access. This bypasses the n8n API limitation where IDs are auto-generated.

## Usage

```bash
# Standard restore (may assign new IDs)
npm run n8n:workflows:upsync

# Restore with ID preservation (requires n8n to be stopped)
npm run n8n:workflows:upsync -- --preserve-ids
```

## How It Works

### Standard API Import (Default)
- Uses n8n REST API
- n8n must be running
- Workflows get new IDs if they don't exist
- References are automatically converted to name-based during import
- Post-import reference fixing updates all references to new IDs

### Direct Database Import (--preserve-ids)
- Uses direct SQLite database access
- **n8n MUST be stopped** to prevent database corruption
- Workflows are imported with their backup IDs preserved
- If a workflow with the same ID exists but different name, it's deleted and replaced
- If a workflow with the same ID and name exists, it's updated
- References are converted BEFORE import (since we bypass the API)
- Database safety check ensures n8n is not running

## Safety Features

1. **Database Safety Check**: Verifies database is not locked (n8n is stopped)
2. **Transaction Support**: All database operations use transactions
3. **Foreign Key Handling**: Properly handles related tables (tags, executions, history)
4. **Conflict Resolution**: 
   - Same ID, different name → Delete old, insert new
   - Same ID, same name → Update existing
   - Different ID, same name → Delete old, insert with backup ID

## Example Workflow

```bash
# 1. Stop n8n
# (stop your n8n instance)

# 2. Restore with ID preservation
npm run n8n:workflows:upsync -- --preserve-ids

# 3. Restart n8n
# (start your n8n instance)
```

## Important Notes

⚠️ **WARNING**: Direct database access while n8n is running can cause:
- Database corruption
- Data loss
- Inconsistent state

✅ **Best Practices**:
- Always backup your database before using `--preserve-ids`
- Only use `--preserve-ids` when n8n is stopped
- Test in a development environment first
- After import, restart n8n to load the changes

## Implementation Details

The database import module (`src/utils/n8n-database.ts`) provides:
- `createDatabaseConnection()`: Connect to n8n SQLite database
- `importWorkflowToDatabase()`: Import workflow with ID preservation
- `checkDatabaseSafe()`: Verify database is safe to modify
- `deleteWorkflowById()`: Delete workflow and handle foreign keys

Database operations handle:
- Workflow entity table
- Foreign key constraints
- Related tables (tags, executions, history)
- Version tracking

## Troubleshooting

**Error: "Database is locked"**
- n8n is still running - stop it first

**Error: "Cannot connect to database"**
- Check that n8n database exists at `~/.n8n/database.sqlite`
- Verify file permissions

**Workflows not appearing after import**
- Restart n8n - workflows are loaded from database on startup

**References still broken**
- References are converted before import
- If issues persist, run: `npm run n8n:db:fix`

