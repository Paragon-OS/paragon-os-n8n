# Vitest Workflow Tests

This directory contains Vitest test files for n8n workflow integration tests. The tests use `test.each` for parameterized testing, making it easy to add new test cases.

## Structure

- `workflows/` - Test files for individual workflows
  - `telegram-context-scout.test.ts`
  - `discord-context-scout.test.ts`
  - `dynamic-rag.test.ts`
  - `discord-smart-agent.test.ts`
  - `telegram-smart-agent.test.ts`

## Usage

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Specific Workflow Tests

```bash
npm test telegram-context-scout
```

### Run Tests with Coverage

```bash
npm run test:coverage
```

### Run a Single Test Case

```bash
npm test -- -t "contact-rag"
```

## Test Structure

Each test file follows this pattern:

```typescript
import { describe, test, expect, beforeAll } from 'vitest';
import { executeWorkflowTest, syncWorkflow } from '../../utils/workflow-test-runner';

describe('WorkflowName', () => {
  beforeAll(async () => {
    await syncWorkflow('WorkflowName');
  });

  test.each([
    {
      testCase: 'test-name',
      testData: { /* test data */ }
    },
    // ... more test cases
  ])('$testCase', async ({ testCase, testData }) => {
    const result = await executeWorkflowTest('WorkflowName', testCase, testData);
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    if (result.error) {
      throw new Error(result.error);
    }
  });
});
```

## Adding New Test Cases

To add a new test case, simply add it to the `test.each` array in the appropriate test file:

```typescript
test.each([
  // ... existing test cases
  {
    testCase: 'new-test-case',
    testData: {
      query: 'test query',
      entity: 'contact'
    }
  }
])('$testCase', async ({ testCase, testData }) => {
  // ... test implementation
});
```

## Test Utilities

The `workflow-test-runner.ts` utility provides:

- `syncWorkflow(workflowName)` - Syncs workflow to n8n before running tests
- `executeWorkflowTest(workflowName, testCase, testData)` - Executes a single test case

These utilities handle:
- Auto-syncing workflows to n8n
- Configuring the Test Runner workflow
- Executing tests via n8n CLI
- Parsing execution output
- Error handling and cleanup

## Benefits Over CLI Tests

✅ Native Vitest features (filtering, watch, parallel execution)
✅ Type-safe test cases
✅ Better IDE integration
✅ Standard test structure
✅ Coverage reporting
✅ No manual test case loading
✅ Can use Vitest's test filtering and organization features

## Migration from CLI Tests

The original CLI test command (`npm run n8n:test`) still works for backward compatibility. The Vitest tests use the same underlying execution logic but provide a better developer experience.

## Notes

- Tests require n8n to be running and accessible
- The Test Runner workflow (`TestRunnerHelper001`) must be imported to n8n
- Tests may take several seconds to execute due to n8n workflow execution time
- Some tests have dependencies (e.g., DynamicRAG tests must run in order)

