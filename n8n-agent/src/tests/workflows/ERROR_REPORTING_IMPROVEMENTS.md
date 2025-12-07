# Error Reporting Improvements

## Summary

All workflow test files have been updated to provide clear, actionable error messages instead of generic assertion failures.

## Changes Made

### Before
Tests would fail with generic messages like:
```
AssertionError: expected false to be true // Object.is equality
- Expected: true
+ Received: false
```

This provided no context about what actually went wrong.

### After
Tests now show detailed error messages:
```
Error: Workflow returned no output (possible error in sub-workflow). Check n8n execution logs for details.
```

This clearly indicates:
- What went wrong
- Where to look for more information
- How to debug the issue

## Updated Test Files

All workflow test files now check for errors first before assertions:

1. ✅ `discord-context-scout.test.ts`
2. ✅ `discord-smart-agent.test.ts`
3. ✅ `dynamic-rag.test.ts`
4. ✅ `telegram-context-scout.test.ts`
5. ✅ `telegram-smart-agent.test.ts`

## Error Reporting Pattern

All tests now follow this pattern:

```typescript
const result = await executeWorkflowTest('WorkflowName', testCase, testData);

if (!result.success) {
  const errorMsg = result.error || 'Test failed with unknown error';
  const details = result.errorDetails ? `\nError details: ${JSON.stringify(result.errorDetails, null, 2)}` : '';
  throw new Error(`${errorMsg}${details}`);
}

expect(result.success).toBe(true);
expect(result.output).toBeDefined();
```

## Benefits

1. **Clear Error Messages**: Tests now show what actually failed
2. **Actionable Information**: Error messages guide you to next steps (e.g., "Check n8n execution logs")
3. **Error Details**: When available, error details are included in JSON format
4. **Easier Debugging**: Developers can immediately see what went wrong without digging into test output

## Test Results

- **Unit tests**: ✅ All 29 tests passing
- **Test framework**: ✅ Working correctly
- **Error reporting**: ✅ All tests now show clear error messages
- **Workflow tests**: ⚠️ Failing as expected (require n8n configuration)

## Common Error Messages

When workflow tests fail, you'll now see messages like:

- `"Workflow returned no output (possible error in sub-workflow). Check n8n execution logs for details."`
- `"Test timed out after 2 minutes. The workflow may be stuck or taking too long to execute."`
- `"Error in Run: WorkflowName: [specific error message]"`

All of these provide clear guidance on what went wrong and how to investigate further.

