# .cursor Directory

This directory contains AI assistant context and instructions for working with this project.

## Files

### `ai-context.md`
**Purpose:** Comprehensive debugging journal and AI context for the n8n credential injection system.

**When to use:**
- Starting a new AI session
- Debugging credential injection issues
- Understanding past decisions and failures
- Avoiding repeated mistakes

**Key sections:**
- ✅ What works (successes)
- ❌ What doesn't work (failures & lessons)
- 🔑 Critical insights
- 🐛 Debugging guide
- 📋 Implementation checklist

### `n8n-integration-methods.md`
**Purpose:** Comprehensive reference for all n8n integration methods used in the project.

**When to use:**
- Understanding which API/CLI method to use for a task
- Debugging integration issues
- Planning refactoring or consolidation
- Checking API endpoint availability

**Key sections:**
- Quick reference table of all methods
- Detailed endpoint documentation
- Integration flow diagrams
- Decision matrix for choosing methods
- Known limitations and workarounds
- File reference map

### `n8n-api-authentication-guide.md`
**Purpose:** Comprehensive guide for n8n API authentication, endpoint selection, and common pitfalls.

**When to use:**
- Debugging authentication failures (401 Unauthorized)
- Understanding `/rest` vs `/api/v1` endpoint differences
- Fixing "missing nodes" issues after restore
- Understanding response format differences
- Setting up test environments with session cookies

**Key sections:**
- Quick reference: Which endpoint for which auth method
- Critical authentication rules
- Common pitfalls and solutions
- Do's and don'ts
- Code patterns and examples
- Debugging checklist

## How AI Assistants Should Use This

1. **Start every session** by reading `ai-context.md`
2. **Check integration methods** in `n8n-integration-methods.md` before choosing an approach
3. **Check authentication guide** in `n8n-api-authentication-guide.md` when dealing with API auth issues
4. **Check the document** before attempting fixes
5. **Update the document** when discovering new insights
6. **Reference specific sections** when debugging

## Why This Exists

This project has gone through extensive debugging of:
- CLI-based credential injection
- API key scope validation issues
- Container management and cleanup
- Test isolation and port conflicts

The AI context document captures all learnings to prevent repeating failed approaches.

## Maintenance

- Update `ai-context.md` when discovering new insights
- Keep the document current with implementation changes
- Add new sections as the project evolves
- Remove outdated information

## Related Documentation

- `../n8n-agent/docs/CREDENTIALS.md` - User guide
- `../n8n-agent/docs/TESTING.md` - Test guide
- `../n8n-agent/docs/CLI-CREDENTIAL-IMPLEMENTATION.md` - Implementation details
- `n8n-integration-methods.md` - Integration methods reference (this directory)
- `n8n-api-authentication-guide.md` - API authentication patterns and pitfalls (this directory)

