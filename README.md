# ParagonOS n8n Tooling & Workflow System - Comprehensive Documentation

## Table of Contents

1. [Overview](#overview)
2. [Product Roadmap](#product-roadmap)
3. [n8n-Agent CLI Tooling](#n8n-agent-cli-tooling)
4. [Custom n8n Nodes](#custom-n8n-nodes)
5. [Workflow Architecture](#workflow-architecture)
6. [Testing System](#testing-system)
7. [Workflow Logic & Patterns](#workflow-logic--patterns)

---

## Product Roadmap

For detailed product roadmap, feature priorities, and strategic planning, see [ROADMAP.md](./ROADMAP.md).

The roadmap includes:
- **Phase 1 (Months 1-3)**: Foundation & Productization
- **Phase 2 (Months 4-6)**: Team Collaboration & Scalability
- **Phase 3 (Months 7-9)**: Custom Nodes Expansion
- **Phase 4 (Months 10-12)**: Agentic Patterns & Templates
- **Phase 5 (Months 13-18)**: SaaS Platform Launch
- **Phase 6 (Months 19-24)**: Enterprise Features

---

## Overview

This project provides a comprehensive tooling ecosystem for managing n8n workflows, custom nodes, and integration testing. The system consists of:

- **n8n-agent**: CLI tooling for workflow backup, restore, organization, testing, and verification
- **n8n-nodes**: Custom n8n nodes (FuzzySearch, JsonDocumentLoader, TextManipulation)
- **Workflows**: Production workflows for Discord/Telegram context scouting, RAG, and smart agents
- **Test Infrastructure**: Unit tests (Vitest) and integration tests (n8n workflow-based)

---

## n8n-Agent CLI Tooling

### Architecture

The CLI is built with TypeScript using Commander.js for command parsing. It interfaces with the n8n CLI to manage workflows.

**Entry Point**: `src/n8n-workflows-cli.ts`

**Key Components**:
- `src/commands/` - Command implementations
- `src/utils/` - Shared utilities
- `src/types/` - TypeScript type definitions

### Commands

#### 1. `backup` (Export Workflows)

**Purpose**: Export all workflows from n8n instance to JSON files

**Implementation** (`src/commands/backup.ts`):
- Uses `n8n export:workflow --backup --output=<dir>`
- Automatically renames files from IDs to workflow names
- Organizes files into tag-based subdirectories (`[TAG] Name.json` → `TAG/Name.json`)
- Removes archived workflows
- Handles duplicate workflow IDs (keeps most recent)
- Moves existing files to temp directory before export to ensure fresh exports

**Key Features**:
- Tag extraction from workflow names: `[HELPERS] Test Runner` → tag: `HELPERS`, name: `Test Runner`
- Sanitizes filenames (removes unsafe characters)
- Preserves workflow IDs in JSON for correlation
- Supports n8n passthrough flags (`--all`, `--active`, etc.)

**Usage**:
```bash
npm run n8n:workflows:downsync
npm run n8n:workflows:downsync -- --output=./my-backups
```

#### 2. `restore` (Import Workflows)

**Purpose**: Import workflows from JSON files to n8n instance

**Implementation** (`src/commands/restore.ts`):
- Recursively scans input directory for JSON files
- Compares backup files with live n8n workflows using deep equality
- Only imports workflows that are new or have changed
- Uses workflow IDs for correlation
- Normalizes workflows before comparison (removes volatile fields: `updatedAt`, `createdAt`, `versionId`, `meta`)
- **Unified API import**: Uses n8n REST API for all workflow imports (consistent schema handling)
- **ID mapping during import**: Builds accurate old ID → new ID mappings as workflows are imported
- **Automatic reference fixing**: Updates `Execute Workflow` and `Tool Workflow` node references after import

**Key Features**:
- Selective restore: skips unchanged workflows
- Shows summary: unchanged vs. changed vs. new
- Handles workflows without IDs (always imports)
- Handles deleted workflows: removes old ID to force creation of new workflow
- **Accurate reference resolution**: Uses ID mappings from import process (not fragile name-based matching)
- **Subworkflow pointer repair**: Automatically fixes broken workflow references after restore
- **Schema validation**: All workflows go through API schema cleaning (`cleanWorkflowForApi`)

**Usage**:
```bash
npm run n8n:workflows:upsync
npm run n8n:workflows:upsync -- --input=./my-backups
```

#### 3. `organize` (Organize by Tags)

**Purpose**: Organize workflow files into tag-based subdirectories

**Implementation** (`src/commands/organize.ts`):
- Scans for files matching `[TAG] Name.json` pattern
- Creates subdirectories named after tags
- Moves files into appropriate directories
- Skips files already in correct location

**Usage**:
```bash
ts-node src/n8n-workflows-cli.ts organize
```

#### 4. `tree` (Display Folder Structure)

**Purpose**: Print logical folder structure of workflows from n8n

**Implementation** (`src/commands/tree.ts`):
- Uses `n8n export:workflow` with passthrough flags
- Parses workflow folder structure from n8n
- Displays tree view organized by `folderId`

**Usage**:
```bash
npm run n8n:workflows:tree
```

#### 5. `test` (Integration Testing)

**Purpose**: Run integration tests against n8n workflows

**Implementation** (`src/commands/test.ts`):
- Loads test cases from `test-cases.js`
- Auto-syncs workflow to n8n before testing
- Modifies Test Runner workflow's "⚙️ Test Config" node with test parameters
- Executes Test Runner workflow via `n8n execute --id=TestRunnerHelper001`
- Parses execution output and extracts results
- Supports single test or batch mode (all tests for a workflow)

**Test Runner Workflow** (`HELPERS/[HELPERS] Test Runner.json`):
- Uses "Route to Workflow" switch node to route to target workflow
- Routes based on `workflow` field from test config
- Supported workflows: TelegramContextScout, DynamicRAG, DiscordContextScout, DiscordSmartAgent, TelegramSmartAgent
- Each workflow has a corresponding "Run: X" execute workflow node

**Test Data Helper** (`HELPERS/[HELPERS] Test Data.json`):
- Loads test cases from same `test-cases.js` file
- Returns test data based on workflow name and test case ID

**Key Features**:
- Auto-sync: automatically imports workflow before testing
- Timeout handling: 2-minute timeout for workflow execution
- Output parsing: handles both `--rawOutput` format and full execution JSON
- Error detection: identifies errors in workflow execution nodes
- Batch mode: runs all tests for a workflow with summary

**Usage**:
```bash
npm run n8n:test -- --list                              # List available tests
npm run n8n:test -- --workflow DynamicRAG              # Run all tests
npm run n8n:test -- --workflow DynamicRAG --test status # Run specific test
```

#### 6. `verify` (Verify Trigger Inputs)

**Purpose**: Verify workflow trigger inputs match between JSON files and database

**Implementation** (`src/commands/verify.ts`):
- Extracts `executeWorkflowTrigger` node inputs from JSON files
- Exports workflows from n8n database
- Compares inputs between JSON and database
- Identifies mismatches (extra/missing inputs)

**Key Features**:
- Supports filtering by workflow name
- Shows detailed differences
- Summary with OK/Mismatch/Error counts

**Usage**:
```bash
npm run n8n:verify
npm run n8n:verify -- --workflow TelegramContextScout
```

### Utility Functions

#### `src/utils/n8n.ts`
- `runN8n()`: Execute n8n command with output inherited
- `runN8nCapture()`: Execute n8n command and capture stdout/stderr
- `runN8nQuiet()`: Execute n8n command with filtered warnings
- Special handling for `execute` commands: 2-minute timeout, streaming detection

#### `src/utils/n8n-api.ts`
- `exportWorkflows()`: Export all workflows from n8n via REST API (with pagination support)
- `importWorkflow()`: Import/update workflow via REST API (handles schema cleaning, creates or updates)
- `importWorkflowFromFile()`: Import workflow from file path via REST API
- `deleteWorkflow()`: Delete workflow via REST API
- `cleanWorkflowForApi()`: Clean workflow data for API requests (removes read-only fields)
- Handles authentication via `N8N_API_KEY` or `N8N_SESSION_COOKIE` environment variables

#### `src/utils/workflow.ts`
- `parseTagFromName()`: Extract `[TAG]` prefix from workflow names
- `sanitizeWorkflowName()`: Remove unsafe filename characters
- `normalizeWorkflowForCompare()`: Remove volatile fields for comparison

#### `src/utils/test-helpers.ts`
- `findWorkflowFile()`: Find workflow file by ID, name, or basename
- `parseExecutionOutput()`: Parse JSON from n8n execution output (handles multiple formats)
- `extractWorkflowResults()`: Extract workflow results from execution JSON

#### `src/utils/compare.ts`
- `deepEqual()`: Deep equality comparison using lodash
- `exportCurrentWorkflowsForCompare()`: Export all workflows from n8n for comparison

#### `src/utils/file.ts`
- `collectJsonFilesRecursive()`: Recursively collect JSON files from directory
- `removeEmptyDirectoriesUnder()`: Clean up empty directories

---

## Custom n8n Nodes

### 1. FuzzySearch Node

**Location**: `n8n-nodes/nodes/FuzzySearch/`

**Purpose**: Perform fuzzy search on strings or objects using MiniSearch

**Key Features**:
- **Two Search Modes**:
  - `searchAcrossItems`: Search across all incoming items
  - `searchInArray`: Search within an array field
- **Flexible Field Selection**: Search specific fields or all fields recursively
- **Match Quality Control**: 0-100% threshold with progressive fallback
- **Individual Word Matching**: Split query into words, match any (OR logic)
- **Score Metadata**: Optional `_fuzzyScore` field with match quality
- **Prefix/Substring Boost**: Prioritizes exact prefix matches

**Implementation Details**:
- Uses `minisearch` library (v7.2.0) for fuzzy matching
- Converts match quality percentage (0-100) to MiniSearch fuzzy level (0.0-1.0)
- Progressive threshold lowering: if no results, tries 80%, 60%, 40%, 20%, then accepts anything
- Prefix boost calculation: exact prefix matches get +100 boost, substring matches get +50 boost
- Recursive value extraction when `searchKeys` is empty

**Configuration**:
- `searchMode`: `searchAcrossItems` | `searchInArray`
- `query`: Search query text
- `arrayField`: JSON path to array (for array mode)
- `searchKeys`: Newline-separated field names (empty = all fields)
- `matchQuality`: 0-100 (default: 70)
- `limit`: Maximum results (10, 25, 50, 100, All, Custom)
- Advanced: `keepOnlySet`, `includeScore`, `matchIndividualWords`

**Testing**: Comprehensive test suite with 7 test files covering all features

### 2. JsonDocumentLoader Node

**Location**: `n8n-nodes/nodes/JsonDocumentLoader/`

**Purpose**: Split JSON data into batch-ready documents for embedding

**Key Features**:
- **Two Operations**:
  - `splitArray`: Split a JSON array into individual documents
  - `autoSplit`: Auto-detect and split arrays within objects
- **Text Formats**:
  - `dense`: Values only, no labels (optimal for semantic search)
  - `readable`: Human-readable text with field labels
  - `json`: Raw JSON string
  - `template`: Custom template with `{{ fieldName }}` placeholders
- **Output Modes**:
  - `batch`: Single output item with all documents (for batch APIs)
  - `multiple`: Each document as separate output item
- **Metadata Extraction**: Configurable ID field, metadata fields, raw JSON inclusion

**Implementation Details**:
- Uses `findAndFlattenArrays()` to detect arrays in objects
- Recursively extracts values for text generation
- Supports dot notation for nested fields
- Skips empty documents if `skipEmpty` is enabled

**Configuration**:
- `operation`: `splitArray` | `autoSplit`
- `sourceField`: JSON path to data (empty = entire input)
- `textFormat`: `dense` | `readable` | `json` | `template`
- `template`: Custom template string (for template format)
- `outputMode`: `batch` | `multiple`
- Options: `includeRawJson`, `idField`, `metadataFields`, `skipEmpty`

**Testing**: Unit tests in `tests/JsonDocumentLoader.test.ts`

### 3. TextManipulation Node

**Location**: `n8n-nodes/nodes/TextManipulation/`

**Purpose**: Comprehensive text manipulation with multiple operations

**Key Features**:
- **Read Operations**: From text, file, or JSON
- **Write Operations**: To file or JSON
- **Manipulations**:
  - Concat, Decode/Encode, Decode/Encode Entities
  - Letter Case (camelCase, kebabCase, snakeCase, etc.)
  - Normalize, Pad, Repeat, Replace, Substring, Trim
- **Encoding Support**: Multiple encodings via `iconv-lite`
- **Entity Handling**: HTML, XML, URL encoding/decoding

**Implementation Details**:
- Supports multiple data sources and manipulations in sequence
- Handles binary data for file operations
- Supports extended escape character replacement
- Regex replacement with pattern support

---

## Workflow Architecture

### Helper Workflows

#### 1. Test Runner (`HELPERS/[HELPERS] Test Runner.json`)

**Workflow ID**: `TestRunnerHelper001`

**Purpose**: Execute tests against target workflows

**Flow**:
1. **Run Test** (Manual Trigger): Starts test execution
2. **⚙️ Test Config** (Set Node): Receives test configuration from CLI
   - Input: `{ workflow, testCase, testData }`
3. **Load Test Data** (Execute Workflow): Calls Test Data helper to get test data
4. **Route to Workflow** (Switch Node): Routes to target workflow based on `workflow` field
   - Routes: TelegramContextScout, DynamicRAG, DiscordContextScout, DiscordSmartAgent, TelegramSmartAgent
5. **Run: X** (Execute Workflow): Executes target workflow with test data
6. **Results** (Set Node): Returns workflow output

**Adding New Testable Workflows**:
1. Add route condition in "Route to Workflow" switch node
2. Add corresponding "Run: X" execute workflow node
3. Connect route output to execute node
4. Connect execute node to Results node

#### 2. Test Data (`HELPERS/[HELPERS] Test Data.json`)

**Workflow ID**: `TestDataHelper001`

**Purpose**: Load test cases from `test-cases.js`

**Flow**:
1. Receives `{ workflow, testCase }` as input
2. Uses Code node to load `test-cases.js` (same file used by CLI)
3. Returns test data for specified workflow and test case

#### 3. Global Cache System (`HELPERS/[HELPERS] Global Cache System.json`)

**Workflow ID**: `zZfQPFI7JkUjGspq`

**Purpose**: Redis-based caching system for workflows

**Flow**:
1. **When Executed by Another Workflow** (Trigger): Receives cache operations
   - Inputs: `trueToWrite` (boolean), `cacheKey` (string), `writeValue` (any), `writeTTLms` (number)
2. **Check Action Type** (If Node): Routes based on `trueToWrite`
   - `true`: Write path
   - `false`: Read path
3. **Write Path**:
   - Redis Set: Stores value with TTL (converts milliseconds to seconds)
   - Return Value: Returns written value
4. **Read Path**:
   - Redis Get: Retrieves value
   - Parse Cache Result: Parses JSON, handles cache miss (throws error)
   - Error handling: "No Entry or Expired Cache Item" error triggers error output

**Redis Setup**:
- Runs locally via Podman: `podman run -d --name n8n-redis -p 6379:6379 redis:alpine`
- Credential ID: `I9K02BUMIbHYp1nQ`
- Manual flush: "Clear All Cache (Manual)" trigger runs `podman exec n8n-redis redis-cli FLUSHDB`

**Usage**: Used by Discord Context Scout, Telegram Context Scout, and other workflows needing caching

#### 4. Dynamic RAG (`HELPERS/[HELPERS] Dynamic RAG.json`)

**Purpose**: Pinecone-based RAG system for vector search

**Modes**:
- `STATUS`: Check collection status
- `SEARCH`: Search collection with query
- `CREATE`: Create new collection
- `DELETE`: Delete collection
- `CLEAR`: Clear all vectors from collection
- `INSERT`: Insert documents with embeddings

**Used By**: Context Scout workflows for knowledge retrieval

#### 5. Stream Update Sender (`HELPERS/[HELPERS] Stream Update Sender.json`)

**Purpose**: Send streaming updates (likely for real-time UI updates)

### Production Workflows

#### 1. Telegram Context Scout

**Purpose**: Search Telegram contacts, messages, chats, tools, and self profile

**Entities**:
- `contact`: Search contacts using RAG
- `message-rag`: Search messages using RAG
- `chat`: Search chats with all parameters
- `tool`: Lookup tools by name/description
- `self`: Return self profile

**Flow**:
1. Receives `{ query, entity }` input
2. Routes by entity type
3. Uses Dynamic RAG for contact/message search
4. Uses FuzzySearch for tool lookup
5. Returns context data

**Test Cases**: 8 test cases covering all entity types

#### 2. Discord Context Scout

**Purpose**: Search Discord contacts, guilds, tools, and self profile

**Similar to Telegram Context Scout but for Discord**

**Uses Global Cache System** for caching search results

#### 3. Telegram Smart Agent / Discord Smart Agent

**Purpose**: AI-powered agents that use context scouting and MCP tools

**Flow**:
1. Receives user prompt
2. Uses Context Scout to gather context
3. Uses MCP tools to perform actions
4. Returns AI-generated response

---

## Testing System

### Unit Tests

**Framework**: Vitest

**Location**: 
- `n8n-agent/src/utils/test-helpers.test.ts` - Test helper utilities
- `n8n-nodes/nodes/*/tests/` - Node-specific tests

**Coverage**:
- Test helper functions (findWorkflowFile, parseExecutionOutput, extractWorkflowResults)
- FuzzySearch node (7 test files, comprehensive coverage)
- JsonDocumentLoader node

**Running Tests**:
```bash
# n8n-agent
cd n8n-agent
npm run test
npm run test:watch
npm run test:coverage

# n8n-nodes
cd n8n-nodes
npm run test
npm run test:watch
```

### Integration Tests

**Framework**: n8n workflow execution via CLI

**Test Cases File**: `n8n-agent/test-cases.js`

**Structure**:
```javascript
const TESTS = {
  'WorkflowName': {
    'test-case-id': {
      param1: 'value1',
      param2: 'value2'
    }
  }
};
```

**Supported Workflows**:
- TelegramContextScout (8 tests)
- DynamicRAG (8 tests)
- DiscordContextScout (5 tests)
- DiscordSmartAgent (3 tests)
- TelegramSmartAgent (5 tests)

**Test Execution Flow**:
1. CLI loads test cases from `test-cases.js`
2. CLI modifies Test Runner workflow's config node
3. CLI imports modified Test Runner to n8n
4. CLI executes Test Runner workflow
5. Test Runner routes to target workflow
6. Target workflow executes with test data
7. CLI parses execution output and displays results

**Output Formats**:
- Single test: Detailed output with test input and results
- Batch mode: Summary with pass/fail counts and failed test list

---

## Workflow Logic & Patterns

### Common Patterns

#### 1. Entity-Based Routing

Many workflows use switch nodes to route by entity type:
- Telegram/Discord Context Scout: Routes by `entity` field (contact, message, tool, etc.)
- Each entity has dedicated processing logic

#### 2. RAG Integration

Workflows use Dynamic RAG helper for vector search:
- Contacts: Stored in `paragon-os-contacts` collection
- Messages: Stored in `paragon-os-knowledge` collection
- Search uses semantic similarity via Pinecone

#### 3. Caching Strategy

Workflows use Global Cache System for:
- Expensive operations (API calls, RAG searches)
- TTL-based expiration (configurable per cache entry)
- Cache miss handling via error output path

#### 4. MCP Tool Integration

Smart Agent workflows use MCP (Model Context Protocol) tools:
- Discord MCP Client: For Discord operations
- Telegram MCP Client: For Telegram operations
- Tools are discovered and executed dynamically

#### 5. Error Handling

Workflows use error output paths for:
- Cache misses (Global Cache System)
- Workflow execution failures (Test Runner)
- Invalid inputs (validation nodes)

### Workflow Organization

**Directory Structure**:
```
workflows/
├── HELPERS/          # Reusable helper workflows
│   ├── [HELPERS] Test Runner.json
│   ├── [HELPERS] Test Data.json
│   ├── [HELPERS] Global Cache System.json
│   ├── [HELPERS] Dynamic RAG.json
│   └── [HELPERS] Stream Update Sender.json
├── LAB/              # Experimental workflows
│   └── [LAB] *.json
├── LEGACY/           # Deprecated workflows
│   └── [LEGACY] *.json
└── *.json            # Production workflows
```

**Naming Convention**:
- Helper workflows: `[HELPERS] Name.json`
- Lab workflows: `[LAB] Name.json`
- Legacy workflows: `[LEGACY] Name.json`
- Production: `Name.json`

### Workflow IDs

**Fixed IDs** (for CLI/test system):
- Test Runner: `TestRunnerHelper001`
- Test Data: `TestDataHelper001`
- Global Cache: `zZfQPFI7JkUjGspq`

**Dynamic IDs**: Other workflows use n8n-generated IDs

---

## Development Workflow

### Adding a New Testable Workflow

1. **Create Workflow** in n8n
2. **Add Test Cases** to `test-cases.js`:
   ```javascript
   'NewWorkflow': {
     'test-1': { param1: 'value1' },
     'test-2': { param2: 'value2' }
   }
   ```
3. **Update Test Runner**:
   - Add route condition in "Route to Workflow" switch
   - Add "Run: NewWorkflow" execute workflow node
   - Connect route → execute → Results
4. **Test**: `npm run n8n:test -- --workflow NewWorkflow`

### Adding a New Custom Node

1. **Create Node** in `n8n-nodes/nodes/NewNode/`
2. **Implement** `NewNode.node.ts` following n8n node interface
3. **Add Tests** in `tests/NewNode.test.ts`
4. **Register** in `package.json` under `n8n.nodes`
5. **Build**: `npm run build`
6. **Use** in workflows

### Workflow Backup/Restore Workflow

1. **Development**: Edit workflows in n8n UI
2. **Backup**: `npm run n8n:workflows:downsync`
3. **Commit**: Git commit workflow JSON files
4. **Restore** (on other instance): `npm run n8n:workflows:upsync`
   - Automatically fixes subworkflow references after import
   - Handles deleted workflows by creating new ones with updated IDs
   - Maps old workflow IDs to new IDs during import
5. **Verify**: `npm run n8n:verify` to check trigger inputs match

**Note**: The restore process uses the n8n REST API for all imports, ensuring consistent schema handling and accurate ID mapping. Subworkflow references (`Execute Workflow` and `Tool Workflow` nodes) are automatically updated after import.

---

## Key Technologies

- **n8n**: Workflow automation platform
- **TypeScript**: Primary language for CLI and nodes
- **Commander.js**: CLI framework
- **Vitest**: Unit testing framework
- **MiniSearch**: Fuzzy search library (FuzzySearch node)
- **Redis**: Caching (via Podman)
- **Pinecone**: Vector database (RAG system)
- **MCP**: Model Context Protocol (tool integration)

---

## File Structure Summary

```
paragon-os-app/
├── n8n-agent/                    # CLI tooling
│   ├── src/
│   │   ├── commands/             # CLI commands
│   │   ├── utils/                # Utilities
│   │   └── n8n-workflows-cli.ts  # Entry point
│   ├── workflows/                # Workflow backups
│   ├── test-cases.js             # Integration test cases
│   └── package.json
├── n8n-nodes/                    # Custom nodes
│   ├── nodes/
│   │   ├── FuzzySearch/
│   │   ├── JsonDocumentLoader/
│   │   └── TextManipulation/
│   └── package.json
└── PROJECT_DOCUMENTATION.md      # This file
```

---

## Maintenance Notes

- **Workflow IDs**: Some workflows have fixed IDs for CLI/test system integration
- **Test Cases**: Must be kept in sync between `test-cases.js` and Test Data workflow
- **Redis**: Must be running for Global Cache System to work
- **n8n CLI**: Must be installed and configured for CLI tooling to work
- **Workflow Tags**: Used for organization; extracted from workflow names