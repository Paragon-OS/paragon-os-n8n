# How to Inspect n8n Execution Logs

## Location

n8n stores execution logs and data in `~/.n8n/`:

- **Event logs**: `~/.n8n/n8nEventLog.log` and rotated files
- **Database**: `~/.n8n/database.sqlite` (SQLite database)
- **Total size**: ~397MB

## Quick Inspection Commands

### 1. Check Recent Test Runner Executions

```bash
sqlite3 ~/.n8n/database.sqlite "SELECT id, workflowId, finished, status, stoppedAt FROM execution_entity WHERE workflowId = 'TestRunnerHelper001' ORDER BY id DESC LIMIT 10;"
```

- `finished = 1` means success
- `finished = 0` means failure
- `status = 'error'` indicates an error occurred

### 2. Check Execution Data for Failed Tests

```bash
# Get execution ID from step 1, then:
sqlite3 ~/.n8n/database.sqlite "SELECT executionId, substr(data, 1, 5000) FROM execution_data WHERE executionId = <ID>;"
```

This shows the actual execution data with error messages.

### 3. Check Event Logs

```bash
# Recent workflow events
tail -100 ~/.n8n/n8nEventLog.log | grep -i "TestRunner\|error\|fail"

# Filter by execution ID
grep "executionId.*14022" ~/.n8n/n8nEventLog.log
```

### 4. Count Total Executions

```bash
sqlite3 ~/.n8n/database.sqlite "SELECT COUNT(*) FROM execution_entity;"
```

## Database Schema

### Key Tables

1. **execution_entity** - Execution metadata
   - `id` - Execution ID
   - `workflowId` - Workflow identifier
   - `finished` - 1 = success, 0 = failure
   - `status` - 'success', 'error', etc.
   - `stoppedAt` - Completion timestamp
   - `mode` - 'cli', 'integrated', etc.

2. **execution_data** - Actual execution data
   - `executionId` - Foreign key to execution_entity
   - `workflowData` - Workflow definition JSON
   - `data` - Execution result data (JSON)

3. **workflow_entity** - Workflow definitions
   - `id` - Workflow ID
   - `name` - Workflow name

## Finding Specific Test Failures

### Find Failed Test Runner Executions

```bash
sqlite3 ~/.n8n/database.sqlite "SELECT id, stoppedAt, status FROM execution_entity WHERE workflowId = 'TestRunnerHelper001' AND finished = 0 ORDER BY id DESC LIMIT 5;"
```

### Get Error Details for Failed Execution

```bash
# Replace <EXECUTION_ID> with actual ID from above
sqlite3 ~/.n8n/database.sqlite "SELECT data FROM execution_data WHERE executionId = <EXECUTION_ID>;" | jq .
```

### Search Event Logs for Errors

```bash
grep -i "error\|fail" ~/.n8n/n8nEventLog.log | tail -50
```

## Understanding Execution Status

- **finished = 1, status = 'success'**: Test passed
- **finished = 0, status = 'error'**: Test failed
- **finished = 0, status = 'waiting'**: Test is still running
- **stoppedAt = NULL**: Test hasn't completed yet

## Common Workflow IDs

- `TestRunnerHelper001` - Test Runner workflow
- `TestDataHelper001` - Test Data helper
- `TelegramContextScout` - Telegram Context Scout workflow
- `DiscordContextScout` - Discord Context Scout workflow
- `DynamicRAG` or `IZa7S90Z9W1qxysr` - Dynamic RAG workflow
- `TelegramSmartAgent` - Telegram Smart Agent
- `DiscordSmartAgent` or `zBL0JT7t26pK2x95` - Discord Smart Agent

## Tips

1. **Use jq for JSON formatting**:
   ```bash
   sqlite3 ~/.n8n/database.sqlite "SELECT data FROM execution_data WHERE executionId = 13742;" | jq .
   ```

2. **Check recent executions**:
   ```bash
   sqlite3 ~/.n8n/database.sqlite "SELECT id, workflowId, finished, stoppedAt FROM execution_entity ORDER BY id DESC LIMIT 10;"
   ```

3. **Filter by date**:
   ```bash
   sqlite3 ~/.n8n/database.sqlite "SELECT id, workflowId, finished, stoppedAt FROM execution_entity WHERE stoppedAt > datetime('now', '-1 hour') ORDER BY id DESC;"
   ```

4. **Export execution data**:
   ```bash
   sqlite3 ~/.n8n/database.sqlite "SELECT data FROM execution_data WHERE executionId = <ID>;" > execution_<ID>.json
   ```

## From n8n UI

1. Open n8n UI (usually http://localhost:5678)
2. Go to **Executions** tab
3. Filter by workflow name (e.g., "Test Runner")
4. Click on failed executions to see error details
5. Check **Execution Log** tab for node-by-node execution details

## Example Queries

### Find all failed tests in last hour

```bash
sqlite3 ~/.n8n/database.sqlite "SELECT id, workflowId, stoppedAt, status FROM execution_entity WHERE workflowId = 'TestRunnerHelper001' AND finished = 0 AND stoppedAt > datetime('now', '-1 hour') ORDER BY stoppedAt DESC;"
```

### Get execution count by workflow

```bash
sqlite3 ~/.n8n/database.sqlite "SELECT workflowId, COUNT(*) as count, SUM(CASE WHEN finished = 1 THEN 1 ELSE 0 END) as successes, SUM(CASE WHEN finished = 0 THEN 1 ELSE 0 END) as failures FROM execution_entity GROUP BY workflowId ORDER BY count DESC LIMIT 10;"
```

