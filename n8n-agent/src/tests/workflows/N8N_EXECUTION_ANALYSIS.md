# n8n Execution Log Analysis Results

## Root Cause Found

After inspecting `~/.n8n/database.sqlite` and event logs, the actual error causing test failures has been identified.

## Error Details

### Execution ID: 13742
- **Workflow**: TestRunnerHelper001 → DiscordContextScout
- **Test Case**: `contact-empty-query`
- **Status**: Failed (finished = 0, status = 'error')
- **Timestamp**: 2025-12-07 11:16:14.770

### Error Message

```
[GoogleGenerativeAI Error]: Error fetching from 
https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent: 
[400 Bad Request] Request has empty input.
```

**Full error**: `Bad request - please check your parameters`

### Stack Trace

```
NodeApiError: Bad request - please check your parameters
    at Object.onFailedAttempt (/Users/nipuna/.nvm/versions/node/v20.19.5/lib/node_modules/n8n/node_modules/@n8n/n8n-nodes-langchain/nodes/llms/n8nLlmFailedAttemptHandler.ts:26:21)
    at RetryOperation._fn (/Users/nipuna/.nvm/versions/node/v20.19.5/lib/node_modules/n8n/node_modules/p-retry/index.js:67:20)
```

## Analysis

### What Happened

1. Test Runner executed with workflow: `DiscordContextScout`
2. Test case: `contact-empty-query` (query: `""`, entity: `"contact"`)
3. The workflow executed successfully until it reached a Gemini API call
4. The Gemini API rejected the request because it had **empty input**
5. This caused the entire workflow execution to fail
6. The Test Runner returned no output because the sub-workflow failed

### Why Tests Are Failing

The workflow tests are failing because:

1. **Empty query parameters** are being passed to workflows
2. Some workflows (like DiscordContextScout) use LLM APIs (Gemini) that **reject empty inputs**
3. When the LLM API fails, the entire workflow fails
4. The Test Runner workflow completes with no output because the sub-workflow failed

### Affected Test Cases

Tests with empty queries that may fail:
- `contact-empty-query` (DiscordContextScout) - **Confirmed failure**
- `self-profile` (various workflows) - May pass if workflow handles empty query
- Any test case with empty `query` or `input` fields

## Solution Options

### Option 1: Handle Empty Input in Workflows (Recommended)

Update workflows to handle empty inputs gracefully before calling LLM APIs:

1. Check if query/input is empty
2. Return appropriate default response instead of calling LLM
3. Or provide a default placeholder value

### Option 2: Update Test Cases

Modify test cases that use empty queries:
- Provide non-empty default values
- Skip tests that require empty queries if workflows don't support them
- Add conditional logic in tests to handle empty query scenarios

### Option 3: Workflow-Specific Handling

For `self-profile` type queries:
- Use a special entity type that doesn't require query input
- Bypass LLM calls for profile-only requests

## Database Query Results

### Test Runner Execution History

```
ID      | WorkflowId          | Finished | Status | StoppedAt
--------|---------------------|----------|--------|-------------------
13762   | TestRunnerHelper001 | 1        | success| 2025-12-07 11:18:15
13755   | TestRunnerHelper001 | 1        | success| 2025-12-07 11:18:01
13749   | TestRunnerHelper001 | 1        | success| 2025-12-07 11:16:44
13742   | TestRunnerHelper001 | 0        | error  | 2025-12-07 11:16:14
13735   | TestRunnerHelper001 | 0        | error  | 2025-12-07 11:15:27
```

### Key Findings

- **6,266 total executions** in database
- Recent executions show mixed success/failure
- Failures correlate with empty input scenarios
- Successful executions exist, indicating framework works when inputs are valid

## Next Steps

1. **Check workflow logic** for handling empty queries
2. **Review test cases** with empty inputs
3. **Update workflows** to handle empty inputs gracefully
4. **Consider test case modifications** if workflows shouldn't support empty queries

## Files Created

- `INSPECT_N8N_LOGS.md` - Guide for inspecting n8n execution logs
- This document - Analysis of the specific error found

## Commands Used

```bash
# Check execution status
sqlite3 ~/.n8n/database.sqlite "SELECT id, workflowId, finished, status, stoppedAt FROM execution_entity WHERE workflowId = 'TestRunnerHelper001' ORDER BY id DESC LIMIT 10;"

# Get error details
sqlite3 ~/.n8n/database.sqlite "SELECT substr(data, 1, 10000) FROM execution_data WHERE executionId = 13742;"

# Check event logs
grep -i "error\|fail\|TestRunner" ~/.n8n/n8nEventLog.log | tail -20
```

