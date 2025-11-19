<!-- af325fce-c064-4132-9bec-b8e0feab52d0 63c09da7-3535-48fe-b7d5-4acdd2cf7973 -->
# N8N Architecture Incremental Improvements

## Phase 1: Critical Reliability Fixes (High Priority)

### 1.1 Add Max Retry Limit

**File:** `workflows/Discord MCP Client Sequencer.json`

Add retry counter logic to prevent infinite loops:

- In "Edit Fields" node (line 429), add a retry counter field
- In "When Executed by Another Workflow" node (line 8), initialize counter to 0
- Before "Enrich With Discord Context" call, add an IF node checking if retries < 3
- If max retries exceeded, return error instead of looping

### 1.2 Fix Cache Expiration Logic

**File:** `workflows/HELPERS/[HELPERS] Global Cache System.json`

Line 185 has inverted logic:

- Current: `"leftValue": "={{ $now }}", "rightValue": "={{ $json.ttl }}", "operation": "after"`
- Should be: `"leftValue": "={{ $json.ttl }}", "rightValue": "={{ $now }}", "operation": "before"`
- This makes cache return data when TTL is in the future (valid), error when in the past (expired)

### 1.3 Enable Cache Cleanup

**File:** `workflows/HELPERS/[HELPERS] Global Cache System.json`

Line 349: Remove `"dryRun": true` option to actually delete expired entries

## Phase 2: Performance Optimizations (Medium Priority)

### 2.1 Parallelize Cache Checks

**File:** `workflows/HELPERS/[HELPERS] Discord Context Enricher.json`

Modify Cache Config node (line 31) connections:

- Currently sends to 3 cache checks sequentially
- Change to send to all 3 simultaneously with no dependencies
- Keep same merge point at Context Aggregator
- Expected: ~60% reduction in enrichment time (from ~9s to ~3.5s)

### 2.2 Remove Context Optimizer AI Agent (Optional)

**File:** `workflows/HELPERS/[HELPERS] Discord Context Enricher.json`

Lines 641-673: This agent adds 2-4s latency for minimal value:

- Replace with direct passthrough from Context Aggregator → Prepare Planner Context
- Move simple prompt reformatting to Execution Planner system prompt
- Keep tool filtering in Prepare Planner Context using simple JS filter logic
- Expected: 2-4 second latency reduction per request

### 2.3 Remove Execution Planning Memory

**File:** `workflows/Discord MCP Client Sequencer.json`

Lines 414-427: Memory buffer is unnecessary for stateless planning:

- Remove "Execution Planning Memory" node
- Remove connection from Memory to Execution Planner AI Agent
- Expected: Simplified architecture, reduced state management overhead

## Phase 3: Simplification & Code Quality (Low Priority)

### 3.1 Add MCP Tool Timeout Handling

**File:** `workflows/HELPERS/[HELPERS] Discord Step Executor.json`

Lines 238-261 (Discord Step Executor) and 263-286 (Telegram Step Executor):

- Add timeout parameter (e.g., 30 seconds) to MCP client nodes
- Add timeout-specific error handling

### 3.2 Pass Error Context to Validator

**File:** `workflows/Discord MCP Client Sequencer.json`

In "Format Step Results" node (line 163):

- Capture and include error information from failed MCP calls
- Pass to Result Validator AI Agent's context
- Update validator system prompt to analyze errors

### 3.3 Consolidate Data Simplifiers (Future)

**File:** `workflows/HELPERS/[HELPERS] Discord Context Enricher.json`

Unify Contact/Guild/Tool Data Simplifiers into single configurable transformer:

- Create reusable sub-workflow
- Pass transformation schema as parameter
- Reduces code duplication from ~100 lines to ~30 lines

## Impact Summary

**Reliability:**

- Eliminates infinite retry loops (prevents runaway costs)
- Fixes cache returning stale data
- Enables automatic cache cleanup

**Performance:**

- 60% faster context enrichment (parallel cache checks)
- 15-25% total latency reduction (remove Context Optimizer)
- Reduced LLM token usage

**Simplicity:**

- Removes stateful memory from stateless planner
- Better error visibility for debugging
- Clearer execution flow

## Implementation Order

1. Fix cache expiration bug (5 min, zero risk)
2. Enable cache cleanup (2 min, zero risk)
3. Add max retry limit (15 min, low risk)
4. Parallelize cache checks (10 min, low risk)
5. Remove Context Optimizer AI (20 min, medium risk - test thoroughly)
6. Remove planning memory (5 min, low risk)
7. Add timeout handling (10 min, low risk)
8. Improve error context (15 min, low risk)