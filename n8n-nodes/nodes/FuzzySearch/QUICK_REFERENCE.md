# FuzzySearch Node - Quick Reference

## Quick Start

### Basic Usage - Search Across Items

```json
{
  "searchMode": "searchAcrossItems",
  "query": "search term",
  "searchKeys": "name\nemail",
  "matchQuality": 70,
  "limit": 50
}
```

### Basic Usage - Search in Array

```json
{
  "searchMode": "searchInArray",
  "arrayField": "products",
  "query": "search term",
  "matchQuality": 70,
  "limit": 50
}
```

## Parameter Cheat Sheet

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `searchMode` | options | ✅ | `searchInArray` | `searchAcrossItems` or `searchInArray` |
| `query` | string | ✅ | - | Search query text |
| `arrayField` | string | ✅* | - | JSON path to array (required for `searchInArray`) |
| `searchKeys` | string | ❌ | `''` | Newline-separated fields (empty = all fields) |
| `matchQuality` | number | ❌ | `70` | Match threshold 0-100 |
| `limit` | options | ❌ | `50` | Max results (10/25/50/100/All/Custom) |
| `customLimit` | number | ❌ | `50` | Custom limit when limit = -1 |

*Required only when `searchMode` is `searchInArray`

## Advanced Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keepOnlySet` | boolean | `false` | Remove all fields except results |
| `includeScore` | boolean | `false` | Add `_fuzzyScore` metadata |
| `matchIndividualWords` | boolean | `false` | Match ANY word (OR logic) |

## Match Quality Guide

| Value | Behavior | Use Case |
|-------|----------|----------|
| 100% | Perfect match only | Exact searches |
| 90%+ | Very strict | High precision needed |
| **70%** | **Balanced (recommended)** | **General purpose** |
| 50% | Lenient | Typo-tolerant |
| 0% | Accept all | Very permissive |

## Common Patterns

### Pattern 1: User Search
```json
{
  "searchMode": "searchAcrossItems",
  "query": "{{ $json.searchTerm }}",
  "searchKeys": "name\nemail\nusername",
  "matchQuality": 70,
  "limit": 10,
  "advancedOptions": {
    "includeScore": true
  }
}
```

### Pattern 2: Product Catalog Filter
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

### Pattern 3: Deep Nested Search
```json
{
  "searchMode": "searchInArray",
  "arrayField": "data.orders.items",
  "query": "laptop",
  "searchKeys": "",
  "matchQuality": 50
}
```

### Pattern 4: Multi-word Search (OR logic)
```json
{
  "searchMode": "searchAcrossItems",
  "query": "apple samsung",
  "searchKeys": "name",
  "matchQuality": 70,
  "advancedOptions": {
    "matchIndividualWords": true
  }
}
```
Returns items matching "apple" OR "samsung"

## Output Format

### Search Across Items Mode
```json
[
  {
    "name": "John Doe",
    "email": "john@example.com",
    "_fuzzyScore": 0.95,
    "_isAboveThreshold": true
  }
]
```

### Search in Array Mode
```json
{
  "products": [
    {
      "name": "Apple iPhone",
      "_fuzzyScore": 0.92
    }
  ],
  "_fuzzyScoreInfo": {
    "totalMatches": 1,
    "topScore": 0.92,
    "isAboveThreshold": true
  }
}
```

## Dot Notation Examples

| Path | Targets |
|------|---------|
| `name` | Top-level field |
| `user.name` | Nested object field |
| `data.products` | Nested array |
| `user.profile.email` | Deeply nested field |

## Tips & Tricks

1. **Empty searchKeys**: Searches ALL fields recursively (useful for unknown structure)
2. **Progressive Fallback**: Node automatically lowers threshold if no matches found
3. **Individual Words**: Use for multi-term queries where ANY match is acceptable
4. **Include Score**: Enable to rank/prioritize results by match quality
5. **Limit Early**: Set reasonable limits to improve performance on large datasets

## Common Issues

### Issue: No results returned
**Solution**: Lower `matchQuality` or enable `matchIndividualWords`

### Issue: Too many results
**Solution**: Increase `matchQuality` or reduce `limit`

### Issue: Wrong fields searched
**Solution**: Specify `searchKeys` explicitly (don't leave empty)

### Issue: Array field not found
**Solution**: Check `arrayField` path uses correct dot notation

## Real-World Examples

### Discord Contact Search (from workflows)
```json
{
  "searchMode": "searchInArray",
  "arrayField": "discordContacts",
  "query": "{{ $json.query }}",
  "searchKeys": "username\ndisplayName\ncontactType",
  "matchQuality": 60,
  "limit": 10,
  "advancedOptions": {
    "includeScore": true,
    "matchIndividualWords": false
  }
}
```

### Telegram Tool Search (from workflows)
```json
{
  "searchMode": "searchInArray",
  "arrayField": "tools",
  "query": "{{ $json.query }}",
  "searchKeys": "name\ndescription",
  "matchQuality": 50,
  "limit": 10,
  "advancedOptions": {
    "includeScore": true,
    "matchIndividualWords": true
  }
}
```

---

For detailed documentation, see [README.md](./README.md)





