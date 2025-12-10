# FuzzySearch Node - Architecture Documentation

## System Overview

The FuzzySearch node is a custom n8n transform node that provides fuzzy string matching capabilities using the `fuzzysort` library. It processes n8n workflow items and returns filtered results based on configurable search criteria.

## Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     n8n Workflow Engine                       │
│                  (IExecuteFunctions Interface)                │
└───────────────────────────┬───────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    FuzzySearch Node                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Node Description (Metadata)                          │  │
│  │  - Display name, version, properties                 │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Execute Method (Main Logic)                         │  │
│  │  1. Parameter Extraction                             │  │
│  │  2. Search Mode Routing                              │  │
│  │  3. Text Extraction                                  │  │
│  │  4. Fuzzy Matching                                   │  │
│  │  5. Result Processing                                │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────┬───────────────────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
        ▼                                       ▼
┌───────────────────┐                 ┌───────────────────┐
│  Search Mode 1:   │                 │  Search Mode 2:   │
│  Across Items     │                 │  In Array Field   │
└───────────────────┘                 └───────────────────┘
```

## Data Flow

### Input Processing Flow

```
Input Items (INodeExecutionData[])
    │
    ├─► Extract Parameters
    │   ├─► searchMode
    │   ├─► query
    │   ├─► searchKeys
    │   ├─► matchQuality → threshold conversion
    │   ├─► limit
    │   └─► advancedOptions
    │
    ├─► Route by Search Mode
    │   │
    │   ├─► searchAcrossItems
    │   │   ├─► Process all items (itemIndex === 0)
    │   │   ├─► Extract searchable text from each item
    │   │   └─► Return matching items
    │   │
    │   └─► searchInArray
    │       ├─► Validate array field exists
    │       ├─► Extract searchable text from array elements
    │       └─► Return item with filtered array
    │
    └─► Text Extraction
        ├─► Specific Keys Mode (searchKeys provided)
        │   └─► Extract values from specified fields using lodash.get()
        │
        └─► All Fields Mode (searchKeys empty)
            └─► Recursive extraction:
                ├─► Nested objects
                ├─► Arrays
                └─► Primitives
```

### Matching Flow

```
Search Targets Prepared
    │
    ├─► Check matchIndividualWords
    │   │
    │   ├─► TRUE: Individual Word Matching
    │   │   ├─► Split query into words
    │   │   ├─► Search each word independently
    │   │   ├─► Aggregate matches per item
    │   │   ├─► Calculate average scores
    │   │   └─► Sort by word count + average score
    │   │
    │   └─► FALSE: Single Query Matching
    │       └─► fuzzysort.go(query, targets, options)
    │
    ├─► Apply Threshold
    │   └─► Filter results by matchQuality threshold
    │
    ├─► Progressive Fallback (if no results)
    │   └─► Try thresholds: [80%, 60%, 40%, 20%, -1000]
    │
    ├─► Sort Results
    │   └─► By match score (descending)
    │
    ├─► Apply Limit
    │   └─► Slice results array
    │
    └─► Add Metadata (if includeScore)
        ├─► _fuzzyScore
        ├─► _isAboveThreshold
        └─► _wordMatches (if matchIndividualWords)
```

## Class Structure

### FuzzySearch Class

```typescript
class FuzzySearch implements INodeType {
  description: INodeTypeDescription {
    // Node metadata
    displayName: 'FuzzySearch'
    name: 'fuzzySearch'
    version: 1
    properties: [
      // Parameter definitions
    ]
  }
  
  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    // Main execution logic
  }
}
```

### Key Methods

1. **execute()** - Main entry point
   - Processes input items
   - Routes by search mode
   - Performs fuzzy matching
   - Returns filtered results

2. **Text Extraction Helpers** (internal)
   - `extractValues()` - Recursive value extraction
   - Field-specific extraction using lodash.get()

3. **Matching Logic** (internal)
   - Single query matching
   - Individual word matching
   - Progressive threshold lowering

## Dependencies

### External Libraries

```
FuzzySearch Node
├── fuzzysort (v3.1.0)
│   └── Core fuzzy matching algorithm
│       └── Uses scoring system: higher = better match
│
├── lodash (v4.17.21)
│   ├── get() - Extract nested object values
│   └── set() - Set nested object values
│
└── n8n-workflow (peer dependency)
    ├── IExecuteFunctions - Execution context
    ├── INodeExecutionData - Data items
    ├── INodeType - Node interface
    └── deepCopy() - Deep cloning utility
```

## Search Mode Implementations

### Mode 1: Search Across Items

**Execution Pattern:**
- Processes all items when `itemIndex === 0`
- Breaks loop after first iteration
- Returns matching items as separate output items

**Code Structure:**
```typescript
if (searchMode === 'searchAcrossItems') {
  if (itemIndex === 0) {
    // Prepare all items for search
    const searchTargets = [];
    for (let i = 0; i < items.length; i++) {
      // Extract searchable text
      searchTargets.push({ item, index: i, searchableText });
    }
    
    // Perform search
    const results = fuzzysort.go(query, searchTargets, options);
    
    // Build return data
    for (const result of results) {
      returnData.push({ json: newItemJson, ... });
    }
    
    break; // Exit loop
  }
}
```

### Mode 2: Search in Array Field

**Execution Pattern:**
- Processes each item individually
- Validates array field exists
- Filters array elements
- Returns item with filtered array

**Code Structure:**
```typescript
if (searchMode === 'searchInArray') {
  const arrayField = getNodeParameter('arrayField');
  const arrayData = get(item.json, arrayField);
  
  // Validate
  if (!Array.isArray(arrayData)) {
    throw new NodeOperationError(...);
  }
  
  // Prepare array elements for search
  const searchTargets = [];
  for (let i = 0; i < arrayData.length; i++) {
    // Extract searchable text
    searchTargets.push({ element, index: i, searchableText });
  }
  
  // Perform search
  const results = fuzzysort.go(query, searchTargets, options);
  
  // Filter array
  const filteredArray = results.map(r => r.obj.element);
  
  // Update item
  set(newItemJson, arrayField, filteredArray);
  returnData.push({ json: newItemJson, ... });
}
```

## Text Extraction Strategies

### Strategy 1: Specific Fields (searchKeys provided)

```typescript
const searchKeys = searchKeysRaw
  .split('\n')
  .map(key => key.trim())
  .filter(key => key.length > 0);

const textParts: string[] = [];
for (const key of searchKeys) {
  const value = get(item.json, key);
  if (value !== undefined && value !== null) {
    textParts.push(
      typeof value === 'string' 
        ? value 
        : JSON.stringify(value)
    );
  }
}
searchableText = textParts.join(' ');
```

### Strategy 2: All Fields (searchKeys empty)

```typescript
const extractValues = (obj: any): string[] => {
  const values: string[] = [];
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];
      if (value !== undefined && value !== null) {
        if (typeof value === 'object' && !Array.isArray(value)) {
          // Recursive: nested objects
          values.push(...extractValues(value));
        } else if (Array.isArray(value)) {
          // Recursive: arrays
          for (const item of value) {
            if (typeof item === 'object' && item !== null) {
              values.push(...extractValues(item));
            } else {
              values.push(String(item));
            }
          }
        } else {
          // Primitive: convert to string
          values.push(String(value));
        }
      }
    }
  }
  return values;
};

searchableText = extractValues(item.json).join(' ');
```

## Matching Algorithms

### Algorithm 1: Single Query Matching

```typescript
results = fuzzysort.go(query, searchTargets, {
  key: 'searchableText',
  threshold: matchQuality / 100,
  limit: limit > 0 ? limit : undefined,
});

// Fallback if no results
if (results.length === 0) {
  const thresholds = [
    threshold * 0.8,
    threshold * 0.6,
    threshold * 0.4,
    threshold * 0.2,
    -1000
  ];
  for (const fallbackThreshold of thresholds) {
    results = fuzzysort.go(query, searchTargets, {
      key: 'searchableText',
      threshold: fallbackThreshold,
      limit: 1,
    });
    if (results.length > 0) break;
  }
}
```

### Algorithm 2: Individual Word Matching

```typescript
const words = query.trim().split(/\s+/).filter(w => w.length > 0);
const matchedItemsMap = new Map<number, {
  item: any;
  scores: number[];
  totalScore: number;
}>();

// Search each word
for (const word of words) {
  const wordResults = fuzzysort.go(word, searchTargets, {
    key: 'searchableText',
    threshold,
  });
  
  // Aggregate matches
  for (const result of wordResults) {
    const itemIndex = result.obj.index;
    if (!matchedItemsMap.has(itemIndex)) {
      matchedItemsMap.set(itemIndex, {
        item: result.obj,
        scores: [],
        totalScore: 0,
      });
    }
    const matchInfo = matchedItemsMap.get(itemIndex)!;
    matchInfo.scores.push(result.score);
    matchInfo.totalScore += result.score;
  }
}

// Convert to results and sort
results = Array.from(matchedItemsMap.values())
  .map(matchInfo => ({
    obj: matchInfo.item,
    score: matchInfo.totalScore / matchInfo.scores.length,
    _wordMatches: matchInfo.scores.length,
  }))
  .sort((a, b) => {
    // Sort by word matches first, then score
    if (b._wordMatches !== a._wordMatches) {
      return b._wordMatches - a._wordMatches;
    }
    return b.score - a.score;
  });
```

## Error Handling

### Validation Points

1. **Array Field Validation**
   ```typescript
   if (!Array.isArray(arrayData)) {
     throw new NodeOperationError(
       this.getNode(),
       `The field "${arrayField}" is not an array or does not exist`,
       { itemIndex }
     );
   }
   ```

2. **Invalid Search Mode**
   ```typescript
   else {
     throw new NodeOperationError(
       this.getNode(),
       'searchAcrossItems or searchInArray are valid options',
       { itemIndex }
     );
   }
   ```

### Graceful Degradation

- Empty input → Returns empty results (no error)
- Empty query → Processes normally
- No matches → Progressive threshold lowering
- Invalid field → Throws descriptive error

## Performance Characteristics

### Time Complexity

- **Text Extraction**: O(n * m) where n = items, m = fields
- **Fuzzy Matching**: O(n * log n) - fuzzysort sorting
- **Progressive Fallback**: O(k * n * log n) where k = fallback attempts (max 5)

### Space Complexity

- **Search Targets**: O(n) - stores all items/elements
- **Results**: O(limit) - limited result set
- **Word Matching**: O(n * w) where w = words in query

### Optimization Strategies

1. **Early Exit**: `searchAcrossItems` breaks after first iteration
2. **Limit Application**: Reduces result set size
3. **Lazy Evaluation**: Only processes when needed
4. **Threshold Optimization**: Progressive fallback prevents unnecessary searches

## Testing Architecture

### Test Structure

```
tests/
├── Unit Tests
│   ├── nodeDescription.test.ts      - Metadata validation
│   └── edgeCases.test.ts             - Error handling
│
├── Integration Tests
│   ├── searchAcrossItems.test.ts    - Items mode
│   ├── searchInArray.test.ts        - Array mode
│   └── searchAllFields.test.ts      - All-fields mode
│
└── Feature Tests
    ├── includeScore.test.ts          - Score metadata
    └── matchIndividualWords.test.ts  - Word matching
```

### Test Helpers

```typescript
// Mock execution context
createMockExecuteFunctions(inputData, parameters)

// Parameter builders
buildSearchAcrossItemsParams(overrides)
buildSearchInArrayParams(arrayField, overrides)

// Test data factories
TestDataFactory.users(count)
TestDataFactory.products()
TestDataFactory.withArrayField(name, items)

// Assertion helpers
AssertionHelpers.allItemsHaveProperty(items, property)
AssertionHelpers.noItemsHaveProperty(items, property)
```

## Integration Points

### n8n Workflow Integration

```
Workflow Item Flow:
  Previous Node → FuzzySearch → Next Node
       │              │              │
       │              │              │
    JSON Data    Search & Filter   Filtered Data
    Binary Data  Preserve Binary   Binary Data
```

### Usage in Production Workflows

1. **Discord Context Scout**
   - Searches contact cache
   - Returns top 10 matches
   - Includes scores for ranking

2. **Telegram Context Scout**
   - Searches tool cache
   - Multi-word queries
   - Returns top 10 matches

## Extension Points

### Potential Enhancements

1. **Custom Scoring Functions**
   - Allow user-defined scoring algorithms
   - Weight different fields differently

2. **Result Highlighting**
   - Mark matched portions in results
   - Visual indication of match quality

3. **Caching Layer**
   - Cache search targets for repeated queries
   - Improve performance on large datasets

4. **Multi-language Support**
   - Language-specific matching rules
   - Character normalization

5. **Fuzzy Operators**
   - AND/OR/NOT logic for complex queries
   - Field-specific operators

---

For usage examples, see [README.md](./README.md)  
For quick reference, see [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)





