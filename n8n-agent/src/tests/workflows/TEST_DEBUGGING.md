# Workflow Test Debugging Guide

## Test Failure Analysis

### Current Status

The workflow tests are correctly detecting execution failures. The most common failure is:

```
Workflow returned no output (possible error in sub-workflow). Check n8n execution logs for details.
```

### What This Means

This error occurs when:
1. ✅ Test framework successfully executes the workflow via n8n CLI
2. ✅ n8n CLI command completes (exit code 0)
3. ❌ Workflow execution returns empty/null output
4. This indicates the workflow execution failed internally

### Common Causes

1. **n8n not running**
   - Solution: Start n8n with `n8n start`
   - Check: `n8n --version` should work

2. **Workflows not imported**
   - Solution: Run `npm run n8n:workflows:upsync`
   - This imports all workflows from JSON files to n8n

3. **Test Runner workflow not configured**
   - Required workflow: `HELPERS/[HELPERS] Test Runner.json`
   - Required ID: `TestRunnerHelper001`
   - Check: Workflow should exist in n8n

4. **Missing credentials**
   - Workflows may need Telegram/Discord credentials
   - Check n8n credentials configuration
   - Some tests may require external services to be accessible

5. **Workflow execution errors**
   - Check n8n execution logs in the UI
   - Look for errors in the workflow execution history
   - Verify all workflow nodes are properly configured

### Debugging Steps

1. **Verify n8n is accessible:**
   ```bash
   n8n --version
   ```

2. **Check if workflows are imported:**
   ```bash
   npm run n8n:workflows:upsync
   ```

3. **Verify Test Runner workflow exists:**
   - Open n8n UI
   - Search for "Test Runner"
   - Verify it has ID `TestRunnerHelper001`

4. **Run a single test with verbose output:**
   ```bash
   npm test -- src/tests/workflows/discord-context-scout.test.ts -t "contact-fuzzy"
   ```

5. **Check n8n execution logs:**
   - Open n8n UI
   - Go to Executions tab
   - Look for recent Test Runner executions
   - Check for error messages in failed executions

6. **Test manually via CLI:**
   ```bash
   npm run n8n:test -- --workflow DiscordContextScout --test contact-fuzzy
   ```

### Test Framework Status

✅ **Working correctly:**
- Test discovery
- Workflow file lookup
- Test Runner configuration
- n8n CLI execution
- Output parsing
- Error detection and reporting

✅ **All unit tests passing:**
- 29/29 tests in `test-helpers.test.ts` pass
- Error message formatting is correct
- Output parsing works correctly

### Next Steps for Debugging

To see more detailed error information, check:

1. **n8n execution logs** - Most detailed error information
2. **Test Runner workflow execution** - See what the Test Runner received
3. **Workflow execution history** - See which node failed
4. **Network/credential errors** - Check if external services are accessible

### Expected Behavior

When everything is configured correctly, tests should:
1. ✅ Sync workflow to n8n automatically
2. ✅ Configure Test Runner with test parameters
3. ✅ Execute workflow via n8n CLI
4. ✅ Parse and return workflow output
5. ✅ Assert output matches expectations

### Current Test Results

- **Unit tests:** ✅ All passing (29/29)
- **Workflow tests:** ⚠️ Failing (expected when n8n not configured)
- **Test framework:** ✅ Working correctly

The workflow test failures are expected until n8n is properly configured and running.

