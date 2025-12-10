# FuzzySearch Node System Documentation

## Overview

The FuzzySearch node is a custom n8n node that provides powerful fuzzy search capabilities for searching through data items and arrays. It uses the `fuzzysort` library to perform intelligent, typo-tolerant searches with configurable match quality thresholds.

**Version:** 1.4  
**Node Type:** `n8n-nodes-paragon-os.fuzzySearch`  
**Category:** Transform

## Table of Contents

- [Architecture](#architecture)
- [Core Features](#core-features)
- [Search Modes](#search-modes)
- [Configuration Options](#configuration-options)
- [Implementation Details](#implementation-details)
- [Testing](#testing)
- [Usage Examples](#usage-examples)
- [Dependencies](#dependencies)
- [File Structure](#file-structure)

## Architecture

### Core Components

1. **FuzzySearch.node.ts** - Main node implementation
2. **FuzzySearch.test.helpers.ts** - Test utilities and mock factories
3. **tests/** - Comprehensive test suite covering all features

### Key Dependencies

- **fuzzysort** (v3.1.0) - Core fuzzy matching algorithm
- **lodash** (v4.17.21) - Utility functions for object manipulation (`get`, `set`)
- **n8n-workflow** - n8n workflow execution framework

## Core Features

### 1. Dual Search Modes

The node supports two distinct search modes:

#### Search Across Items (`searchAcrossItems`)
- Searches across all incoming items from the previous node
- Returns matching items as separate output items
- Processes all items in a single batch when `itemIndex === 0`
- Useful for filtering large datasets

#### Search in Array Field (`searchInArray`)
- Searches within a specific array field in the JSON data
- Returns the original item with filtered array
- Supports nested arrays using dot notation (e.g., `data.products`)
- Useful for filtering arrays within objects

### 2. Flexible Field Selection

- **Specific Fields**: Search only in specified fields using dot notation
- **All Fields**: When `searchKeys` is empty, recursively searches all fields including:
  - Nested objects
  - Arrays within objects
  - Nested arrays
  - All primitive values

### 3. Match Quality Control

- **Threshold System**: 0-100% match quality percentage
  - 100% = Perfect match only
  - 90%+ = Very strict matching
  - 70% = Balanced (recommended default)
  - 50% = Lenient matching
  - 0% = Accept all matches
- **Progressive Fallback**: Automatically lowers threshold if no matches found
  - Falls back to: 80%, 60%, 40%, 20%, then -1000 (accept anything)
  - Ensures at least one result when possible

### 4. Advanced Matching Options

#### Match Individual Words (`matchIndividualWords`)
- Splits query into individual words
- Matches items containing ANY of the words (OR logic)
- Ranks results by:
  1. Number of words matched (more is better)
  2. Average match score (higher is better)
- Example: Query "apple iphone" matches items with "apple" OR "iphone"

#### Include Match Score (`includeScore`)
- Adds `_fuzzyScore` field to results (0-1 scale, higher = better)
- Adds `_isAboveThreshold` boolean indicating if match met original threshold
- For array mode, adds `_fuzzyScoreInfo` object with:
  - `totalMatches`: Number of matches found
  - `topScore`: Best match score
  - `isAboveThreshold`: Whether top match met threshold

### 5. Result Limiting

- Predefined limits: 10, 25, 50, 100, All Results
- Custom limit option for any number
- Applied after sorting by match quality

### 6. Data Preservation

- **keepOnlySet**: When `true`, removes all fields except search results
- **Binary Data**: Preserves binary attachments from input items
- **Paired Item**: Maintains reference to original item index

## Search Modes

### Mode 1: Search Across Items

**Use Case**: Filter a collection of items based on search criteria

**Input**: Multiple items, each with JSON data
```json
[
  { "name": "John Doe", "email": "john@example.com" },
  { "name": "Jane Smith", "email": "jane@example.com" }
]
```

**Output**: Filtered items matching the query
```json
[
  { "name": "John Doe", "email": "john@example.com", "_fuzzyScore": 0.95 }
]
```

**Key Characteristics**:
- Processes all items in first iteration (`itemIndex === 0`)
- Breaks out of loop after processing
- Returns matching items as separate output items

### Mode 2: Search in Array Field

**Use Case**: Filter elements within an array field

**Input**: Single item with array field
```json
{
  "products": [
    { "name": "Apple iPhone", "price": 999 },
    { "name": "Samsung Galaxy", "price": 899 }
  ]
}
```

**Output**: Same structure with filtered array
```json
{
  "products": [
    { "name": "Apple iPhone", "price": 999, "_fuzzyScore": 0.92 }
  ],
  "_fuzzyScoreInfo": {
    "totalMatches": 1,
    "topScore": 0.92,
    "isAboveThreshold": true
  }
}
```

**Key Characteristics**:
- Validates array field exists and is an array
- Supports nested paths: `data.products`, `user.items.list`
- Handles string arrays and object arrays
- Preserves original item structure

## Configuration Options

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `searchMode` | `options` | Either `searchAcrossItems` or `searchInArray` |
| `query` | `string` | The search query text |
| `arrayField` | `string` | Required when `searchMode` is `searchInArray`. JSON path to array field |

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `searchKeys` | `string` | `''` | Newline-separated list of fields to search. Empty = search all fields |
| `matchQuality` | `number` | `70` | Match quality threshold (0-100) |
| `limit` | `options` | `50` | Maximum results to return (10, 25, 50, 100, All, Custom) |
| `customLimit` | `number` | `50` | Custom limit when `limit` is set to Custom (-1) |

### Advanced Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keepOnlySet` | `boolean` | `false` | Remove all fields except search results |
| `includeScore` | `boolean` | `false` | Add `_fuzzyScore` and related metadata |
| `matchIndividualWords` | `boolean` | `false` | Split query into words and match any |

## Implementation Details

### Search Algorithm Flow

1. **Input Processing**
   - Extract items from input data
   - Parse parameters for current item index
   - Convert match quality percentage to fuzzysort threshold

2. **Search Target Preparation**
   - Extract searchable text from items/array elements
   - Handle field selection (specific keys vs. all fields)
   - Recursively extract values from nested structures

3. **Fuzzy Matching**
   - Use `fuzzysort.go()` with configured threshold
   - Handle individual word matching if enabled
   - Apply progressive threshold lowering if no results

4. **Result Processing**
   - Sort results by match quality
   - Apply limit
   - Add metadata (scores, thresholds)
   - Preserve binary data and item references

### Text Extraction Logic

When `searchKeys` is empty, the node recursively extracts all values:

```typescript
extractValues(obj):
  - Iterate through all object keys
  - For nested objects: recursively extract
  - For arrays: extract from each element
  - For primitives: convert to string
  - Join all values with spaces
```

### Threshold Conversion

- **User Input**: 0-100 percentage
- **Fuzzysort**: 0.0-1.0 decimal (or negative for very lenient)
- **Formula**: `threshold = matchQuality / 100`
- **Fallback Sequence**: `[threshold * 0.8, threshold * 0.6, threshold * 0.4, threshold * 0.2, -1000]`

### Individual Word Matching

When `matchIndividualWords` is enabled:

1. Split query by whitespace: `"apple iphone"` → `["apple", "iphone"]`
2. Search each word independently
3. Track matches per item:
   - Count words matched
   - Sum scores
   - Calculate average score
4. Sort by:
   - Primary: Number of words matched (descending)
   - Secondary: Average score (descending)

## Testing

### Test Structure

The test suite uses Vitest and includes:

- **Test Helpers** (`FuzzySearch.test.helpers.ts`):
  - `createMockExecuteFunctions()` - Mock n8n execution context
  - `buildSearchAcrossItemsParams()` - Parameter builder for items mode
  - `buildSearchInArrayParams()` - Parameter builder for array mode
  - `TestDataFactory` - Data generators for common scenarios
  - `AssertionHelpers` - Utility assertions

### Test Coverage

1. **searchAcrossItems.test.ts** - Items mode functionality
2. **searchInArray.test.ts** - Array mode functionality
3. **matchIndividualWords.test.ts** - Word matching feature
4. **includeScore.test.ts** - Score metadata feature
5. **searchAllFields.test.ts** - Empty searchKeys behavior
6. **edgeCases.test.ts** - Error handling and edge cases
7. **nodeDescription.test.ts** - Node metadata validation

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm test -- --coverage
```

## Usage Examples

### Example 1: Search Users by Name

**Workflow Context**: Filter user list based on search query

```json
{
  "searchMode": "searchAcrossItems",
  "query": "{{ $json.searchTerm }}",
  "searchKeys": "name\nemail",
  "matchQuality": 70,
  "limit": 10,
  "advancedOptions": {
    "includeScore": true
  }
}
```

**Input**:
```json
[
  { "name": "John Doe", "email": "john@example.com" },
  { "name": "Jane Smith", "email": "jane@example.com" },
  { "name": "Bob Johnson", "email": "bob@example.com" }
]
```

**Query**: "John"

**Output**:
```json
[
  { "name": "John Doe", "email": "john@example.com", "_fuzzyScore": 0.95 },
  { "name": "Bob Johnson", "email": "bob@example.com", "_fuzzyScore": 0.65 }
]
```

### Example 2: Filter Products in Array

**Workflow Context**: Search within product catalog

```json
{
  "searchMode": "searchInArray",
  "arrayField": "products",
  "query": "{{ $json.query }}",
  "searchKeys": "name\ndescription",
  "matchQuality": 60,
  "limit": 25,
  "advancedOptions": {
    "includeScore": true,
    "matchIndividualWords": true
  }
}
```

**Input**:
```json
{
  "products": [
    { "name": "Apple iPhone 14", "price": 999 },
    { "name": "Samsung Galaxy S23", "price": 899 },
    { "name": "Apple MacBook Pro", "price": 2499 }
  ]
}
```

**Query**: "apple samsung"

**Output**:
```json
{
  "products": [
    { "name": "Apple iPhone 14", "price": 999, "_fuzzyScore": 0.92 },
    { "name": "Samsung Galaxy S23", "price": 899, "_fuzzyScore": 0.88 },
    { "name": "Apple MacBook Pro", "price": 2499, "_fuzzyScore": 0.75 }
  ],
  "_fuzzyScoreInfo": {
    "totalMatches": 3,
    "topScore": 0.92,
    "isAboveThreshold": true
  }
}
```

### Example 3: Deep Nested Search

**Workflow Context**: Search in nested array structure

```json
{
  "searchMode": "searchInArray",
  "arrayField": "data.orders.items",
  "query": "laptop",
  "searchKeys": "",
  "matchQuality": 50
}
```

**Input**:
```json
{
  "data": {
    "orders": {
      "items": [
        { "name": "Laptop", "category": "Electronics" },
        { "name": "Mouse", "category": "Accessories" },
        { "name": "Keyboard", "category": "Accessories" }
      ]
    }
  }
}
```

**Output**:
```json
{
  "data": {
    "orders": {
      "items": [
        { "name": "Laptop", "category": "Electronics" }
      ]
    }
  }
}
```

### Real-World Usage

The node is used in production workflows:

1. **Discord Context Scout** (`Discord Context Scout.json`):
   - Searches Discord contacts by username, displayName, contactType
   - Match quality: 60%, Limit: 10
   - Includes scores for ranking

2. **Telegram Context Scout** (`Telegram Context Scout.json`):
   - Searches tools by name and description
   - Match quality: 50%, Limit: 10
   - Uses individual word matching for multi-word queries

## Dependencies

### Runtime Dependencies

```json
{
  "fuzzysort": "^3.1.0",
  "lodash": "^4.17.21"
}
```

### Peer Dependencies

```json
{
  "n8n-workflow": "*"
}
```

### Dev Dependencies

- **vitest** - Testing framework
- **typescript** - TypeScript compiler
- **@types/lodash** - TypeScript definitions

## File Structure

```
n8n-nodes/nodes/FuzzySearch/
├── FuzzySearch.node.ts          # Main node implementation (620 lines)
├── FuzzySearch.test.helpers.ts   # Test utilities (217 lines)
├── FuzzySearch.svg               # Node icon
└── tests/
    ├── edgeCases.test.ts         # Edge case tests
    ├── includeScore.test.ts       # Score feature tests
    ├── matchIndividualWords.test.ts  # Word matching tests
    ├── nodeDescription.test.ts    # Metadata tests
    ├── searchAcrossItems.test.ts  # Items mode tests
    ├── searchAllFields.test.ts    # All-fields search tests
    └── searchInArray.test.ts      # Array mode tests
```

## Key Implementation Patterns

### 1. Progressive Threshold Lowering

```typescript
if (results.length === 0 && searchTargets.length > 0) {
  const thresholds = [
    threshold * 0.8,
    threshold * 0.6,
    threshold * 0.4,
    threshold * 0.2,
    -1000  // Accept anything
  ];
  // Try each threshold until we get a result
}
```

### 2. Recursive Value Extraction

```typescript
const extractValues = (obj: any): string[] => {
  // Recursively extract all string values
  // Handles nested objects, arrays, and primitives
};
```

### 3. Individual Word Matching

```typescript
// Split query into words
const words = query.trim().split(/\s+/).filter(w => w.length > 0);

// Track matches per item
const matchedItemsMap = new Map<number, {
  item: any;
  scores: number[];
  totalScore: number;
}>();

// Aggregate scores and sort by word matches + average score
```

## Performance Considerations

1. **Batch Processing**: `searchAcrossItems` mode processes all items in first iteration
2. **Recursive Extraction**: Empty `searchKeys` requires full object traversal
3. **Threshold Fallback**: May perform multiple searches if initial threshold too strict
4. **Memory**: Large datasets may require limiting results

## Error Handling

- **Invalid Array Field**: Throws `NodeOperationError` if field doesn't exist or isn't an array
- **Invalid Search Mode**: Throws error for unrecognized modes
- **Empty Input**: Returns empty results array (no error)
- **Empty Query**: Processes normally (may return all or no results depending on threshold)

## Future Enhancements

Potential improvements based on code analysis:

1. **Case Sensitivity Option**: Add toggle for case-sensitive matching
2. **Custom Threshold Fallback**: Allow configuration of fallback sequence
3. **Multi-field Weighting**: Assign weights to different search fields
4. **Result Highlighting**: Mark matched portions in results
5. **Performance Optimization**: Add caching for repeated searches

## Version History

- **v1.4** - Current version with individual word matching and score metadata
- **v1.0** - Initial release with basic fuzzy search functionality

---

**Maintained by**: ParagonTheDev  
**License**: MIT  
**Repository**: https://github.com/ParagonTheDev/n8n-nodes-paragon-os





