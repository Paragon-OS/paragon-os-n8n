# n8n Workflows CLI

A command-line tool for managing n8n workflows with backup, restore, organization, testing, and verification capabilities.

## Installation

```bash
cd n8n-agent
npm install
```

## Quick Reference

| Command | NPM Script | Description |
|---------|------------|-------------|
| `backup` | `npm run n8n:workflows:downsync` | Export workflows from n8n to JSON files |
| `restore` | `npm run n8n:workflows:upsync` | Import workflows from JSON files to n8n |
| `organize` | - | Organize workflow files into tag-based directories |
| `tree` | `npm run n8n:workflows:tree` | Display workflow folder structure |
| `test` | `npm run n8n:test` | Run integration tests against workflows |
| `verify` | `npm run n8n:verify` | Verify workflow trigger inputs match database |

---

## Commands

### `backup` - Export Workflows

Export all workflows from the n8n instance to JSON files.

```bash
# Using npm script
npm run n8n:workflows:downsync

# Using CLI directly
ts-node src/n8n-workflows-cli.ts backup [options]
```

**Options:**

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `--output <dir>` | `-o` | `./workflows` | Output directory for workflow files |
| `--yes` | `-y` | `false` | Skip confirmation prompt |

**Features:**
- Exports all workflows from n8n to the specified directory
- Automatically renames files to use workflow names instead of IDs
- Organizes files into subdirectories based on `[TAG]` prefixes in workflow names
- Removes archived workflows from exports
- Handles duplicate workflow IDs by keeping the most recent version
- Supports n8n passthrough flags (e.g., `--all`)

**Examples:**

```bash
# Export to default ./workflows directory
npm run n8n:workflows:downsync

# Export to custom directory
npm run n8n:workflows:downsync -- --output=./my-backups

# Skip confirmation prompt
npm run n8n:workflows:downsync -- -y
```

---

### `restore` - Import Workflows

Import workflows from JSON files back into the n8n instance.

```bash
# Using npm script
npm run n8n:workflows:upsync

# Using CLI directly
ts-node src/n8n-workflows-cli.ts restore [options]
```

**Options:**

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `--input <dir>` | `-i` | `./workflows` | Input directory containing workflow JSON files |
| `--yes` | `-y` | `false` | Skip confirmation prompt |

**Features:**
- Compares backup files with live n8n workflows before importing
- Only imports workflows that are new or have changed
- Shows summary of unchanged vs. changed workflows
- Recursively scans subdirectories for workflow files
- Preserves workflow IDs for proper correlation

**Examples:**

```bash
# Restore from default ./workflows directory
npm run n8n:workflows:upsync

# Restore from custom directory
npm run n8n:workflows:upsync -- --input=./my-backups

# Skip confirmation prompt
npm run n8n:workflows:upsync -- -y
```

---

### `organize` - Organize Workflow Files

Organize workflow JSON files into subdirectories based on their `[TAG]` prefixes.

```bash
ts-node src/n8n-workflows-cli.ts organize [options]
```

**Options:**

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `--input <dir>` | `-i` | `./workflows` | Input directory to organize |

**Behavior:**
- Scans for workflow files with `[TAG] Name.json` naming pattern
- Creates subdirectories named after the tag (e.g., `HELPERS/`, `LAB/`)
- Moves matching files into their tag directories
- Skips files that already exist in the target location

**Example:**

```bash
# Before:
# ./workflows/[HELPERS] Test Runner.json
# ./workflows/[LAB] Demo Workflow.json

ts-node src/n8n-workflows-cli.ts organize

# After:
# ./workflows/HELPERS/[HELPERS] Test Runner.json
# ./workflows/LAB/[LAB] Demo Workflow.json
```

---

### `tree` - Display Workflow Structure

Print a tree view of workflows organized by n8n folder structure.

```bash
# Using npm script (includes --all flag)
npm run n8n:workflows:tree

# Using CLI directly
ts-node src/n8n-workflows-cli.ts tree [options]
```

**Options:**

Supports n8n passthrough flags:

| Flag | Description |
|------|-------------|
| `--all` | Export all workflows (default if no flag specified) |
| `--active` | Export only active workflows |
| `--inactive` | Export only inactive workflows |
| `--id=<id>` | Export specific workflow by ID |

**Example Output:**

```
n8n workflow folder structure (by folderId):

├─ Folder abc123/
   ├─ Workflow A
   └─ Workflow B

└─ Uncategorized/
   ├─ Standalone Workflow 1
   └─ Standalone Workflow 2
```

---

### `test` - Run Integration Tests

Run test cases against n8n workflows using the Test Runner helper workflow.

```bash
# Using npm scripts
npm run n8n:test -- --list                              # List available tests
npm run n8n:test -- --workflow <name>                   # Run all tests for a workflow
npm run n8n:test -- --workflow <name> --test <case>     # Run specific test

# Using CLI directly
ts-node src/n8n-workflows-cli.ts test [options]
```

**Options:**

| Option | Alias | Description |
|--------|-------|-------------|
| `--workflow <name>` | `-w` | Workflow name to test |
| `--test <case>` | `-t` | Test case ID (optional - runs all if omitted) |
| `--list` | `-l` | List all available test cases |

**Features:**
- Auto-syncs workflow to n8n before testing
- Configures and executes the Test Runner helper workflow
- Parses and displays test results with formatted output
- Supports running all tests for a workflow with summary
- Shows pass/fail counts and lists failed tests

**Examples:**

```bash
# List all available tests
npm run n8n:test -- --list

# Run all tests for DynamicRAG workflow
npm run n8n:test -- --workflow DynamicRAG

# Run a specific test
npm run n8n:test -- --workflow TelegramContextScout --test contact-rag

# Short form
npm run n8n:test -- -w DynamicRAG -t status
```

**Test Output (Single Test):**

```
╭────── Running Test ──────╮
│                          │
│   Workflow: DynamicRAG   │
│   Test:     status       │
│                          │
╰──────────────────────────╯
📥 Test Input:
{
  "mode": "STATUS",
  "collectionId": "paragon-os-contacts"
}

🔄 Auto-syncing workflow "DynamicRAG" to n8n...
✅ Workflow "DynamicRAG" synced successfully

╭───────────────────── Test Results ─────────────────────╮
│                                                        │
│   Workflow Output:                                     │
│   { "status": "green", "pointsCount": 200 }            │
│                                                        │
╰────────────────────────────────────────────────────────╯
✅ Test completed successfully
```

**Test Output (All Tests):**

```
╭──── Running All Tests ─────╮
│                            │
│   Workflow: DynamicRAG     │
│   Tests:    8 test cases   │
│                            │
╰────────────────────────────╯

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [1/8] status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ status - PASSED
     {"status": "green", ...}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [2/8] search-contacts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ search-contacts - PASSED

...

╭─────────────── ✅ All Tests Passed ───────────────╮
│                                                   │
│   Total:  8 tests                                 │
│   Passed: 8                                       │
│   Failed: 0                                       │
│                                                   │
╰───────────────────────────────────────────────────╯
```

---

### `verify` - Verify Workflow Inputs

Verify that workflow trigger inputs in the n8n database match the JSON backup files.

```bash
# Using npm script
npm run n8n:verify

# Using CLI directly
ts-node src/n8n-workflows-cli.ts verify [options]
```

**Options:**

| Option | Alias | Description |
|--------|-------|-------------|
| `--workflow <name>` | `-w` | Specific workflow to verify (partial match supported) |

**Features:**
- Compares `executeWorkflowTrigger` node inputs between JSON files and database
- Identifies mismatches where database has extra or missing inputs
- Shows summary with OK/Mismatch/Error counts
- Useful for detecting stale workflow definitions

**Examples:**

```bash
# Verify all workflows
npm run n8n:verify

# Verify specific workflow
npm run n8n:verify -- --workflow TelegramContextScout
```

**Example Output:**

```
╭───────── Workflow Trigger Input Verification ─────────╮
│                                                       │
│   Checking 15 workflow(s)...                          │
│                                                       │
╰───────────────────────────────────────────────────────╯

✅ WorkflowA (abc123)
   JSON inputs: query, mode, collectionId

✅ WorkflowB (def456)
   JSON inputs: none

❌ WorkflowC (ghi789)
   JSON inputs: query, entity
   DB inputs:   query, entity, newField
   Database has extra input: "newField" (not in JSON file)

╭─────────────────────────────╮
│ Summary:                    │
│   ✅ OK:        13          │
│   ❌ Mismatch:  1           │
│   ⚠️  Errors:   1           │
╰─────────────────────────────╯
```

---

## Unit Testing

The CLI includes unit tests for utility functions using Vitest.

```bash
# Run tests once
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

**Test Files:**
- `src/utils/test-helpers.test.ts` - Tests for `findWorkflowFile`, `parseExecutionOutput`, `extractWorkflowResults`

---

## Adding Integration Tests

Test cases are defined in `test-cases.js`:

```javascript
const TESTS = {
  'WorkflowName': {
    'test-case-id': {
      // Test input data passed to the workflow
      param1: 'value1',
      param2: 'value2'
    },
    'another-test': {
      mode: 'SEARCH',
      query: 'example'
    }
  }
};

module.exports = TESTS;
```

**Requirements:**
1. The workflow must exist in n8n
2. A Test Runner helper workflow must be set up at `HELPERS/[HELPERS] Test Runner.json`
3. Test data is injected into the workflow via the "⚙️ Test Config" node

---

## Directory Structure

```
n8n-agent/
├── src/
│   ├── commands/           # CLI command implementations
│   │   ├── backup.ts       # Export workflows
│   │   ├── restore.ts      # Import workflows
│   │   ├── organize.ts     # Organize by tags
│   │   ├── tree.ts         # Display folder structure
│   │   ├── test.ts         # Run integration tests
│   │   └── verify.ts       # Verify trigger inputs
│   ├── utils/              # Shared utilities
│   │   ├── n8n.ts          # n8n CLI wrappers
│   │   ├── file.ts         # File operations
│   │   ├── workflow.ts     # Workflow parsing
│   │   ├── compare.ts      # Deep comparison
│   │   ├── prompt.ts       # User prompts
│   │   ├── args.ts         # Argument parsing
│   │   └── test-helpers.ts # Test utilities
│   ├── types/              # TypeScript types
│   └── n8n-workflows-cli.ts # Main CLI entry point
├── workflows/              # Workflow JSON backups
├── test-cases.js           # Integration test definitions
├── vitest.config.ts        # Unit test configuration
└── package.json
```

---

## NPM Scripts Reference

| Script | Command |
|--------|---------|
| `n8n:workflows:downsync` | `ts-node src/n8n-workflows-cli.ts backup` |
| `n8n:workflows:upsync` | `ts-node src/n8n-workflows-cli.ts restore` |
| `n8n:workflows:tree` | `ts-node src/n8n-workflows-cli.ts tree --all` |
| `n8n:test` | `ts-node src/n8n-workflows-cli.ts test` |
| `n8n:test:list` | `ts-node src/n8n-workflows-cli.ts test --list` |
| `n8n:verify` | `ts-node src/n8n-workflows-cli.ts verify` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `test:coverage` | `vitest run --coverage` |
