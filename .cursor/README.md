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

## How AI Assistants Should Use This

1. **Start every session** by reading `ai-context.md`
2. **Check the document** before attempting fixes
3. **Update the document** when discovering new insights
4. **Reference specific sections** when debugging

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

