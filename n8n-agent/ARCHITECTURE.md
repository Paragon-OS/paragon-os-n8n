# Context Scout Hybrid Architecture

## Overview

This document describes the hybrid architecture for context scouting workflows that supports multiple platforms (Telegram, Discord, etc.) through a shared core.

## Architecture Layers

### Layer 1: Core Helper Workflows

#### `[HELPERS] MCP Data Normalizer`
- **Purpose**: Normalizes MCP response data using configurable mapper functions
- **Inputs**: `rawData`, `dataKey`, `mcpDataKey`, `mapper` (function as string), `errorMsg`
- **Output**: `{ [dataKey]: normalized[], error?, shouldFetch? }`
- **Status**: ✅ Created

#### `[HELPERS] Entity Cache Handler`
- **Purpose**: Handles cache read/write with automatic fetch on cache miss
- **Inputs**: `cacheKey`, `ttl`, `fetchWorkflowId`, `fetchWorkflowInputs`
- **Output**: Cached or fetched entity data
- **Status**: ✅ Created

#### `[HELPERS] Generic Context Scout Core`
- **Purpose**: Main orchestration workflow that routes entities, handles caching, and applies search
- **Inputs**: `query`, `entity`, `platformConfig`
- **Output**: Search results with scores
- **Status**: ✅ Created (needs refinement)

### Layer 2: Entity Fetch Workflows

These workflows handle platform-specific MCP calls and normalization:

**Telegram:**
- ✅ `[HELPERS] Telegram Contact Fetch` - Fetches contacts
- ✅ `[HELPERS] Telegram Chat Fetch` - Fetches chats
- ⏳ `[HELPERS] Telegram Tool Fetch` - Fetches MCP tools
- ⏳ `[HELPERS] Telegram Profile Fetch` - Fetches user profile
- ⏳ `[HELPERS] Telegram Message Fetch` - Fetches messages (for RAG)

**Discord:**
- ✅ `[HELPERS] Discord Contact Fetch` - Fetches contacts
- ⏳ `[HELPERS] Discord Guild Fetch` - Fetches guilds
- ⏳ `[HELPERS] Discord Tool Fetch` - Fetches MCP tools
- ⏳ `[HELPERS] Discord Profile Fetch` - Fetches user profile

### Layer 3: Platform Wrapper Workflows

Thin wrappers that:
1. Load platform configuration
2. Execute the core workflow
3. Preserve existing workflow IDs for backward compatibility

**Status**: ⏳ To be created

## Platform Configuration Schema

```typescript
interface PlatformConfig {
  platform: "TELEGRAM" | "DISCORD" | "SLACK" | ...;
  mcpCredentialId: string;
  cacheKeyPrefix: string; // "telegram" | "discord"
  defaultTTL: number; // milliseconds
  
  entities: {
    [entityType: string]: {
      // Cache configuration
      cacheKey: string; // Full cache key
      ttl?: number; // Override default TTL
      
      // Fetch workflow
      fetchWorkflowId: string; // Workflow ID for fetching this entity
      
      // MCP tool configuration (for reference)
      mcpTool?: {
        name: string; // "telegram_list_chats"
        parameters: object; // {limit: 50}
        mcpDataKey: string; // "items" | "contacts"
      };
      
      // Normalization
      mapper: string; // JS function as string
      dataKey: string; // Output key: "channels", "contacts"
      
      // Search configuration
      searchType: "fuzzy" | "rag" | "none";
      fuzzyConfig?: {
        searchKeys: string[]; // ["name", "kind"]
        matchQuality: number; // 50
        limit: number; // 10
      };
      ragConfig?: {
        collectionId: string; // "paragon-os-contacts"
        autoIngest: boolean; // Should we ingest fetched data?
      };
      
      // Special handling
      skipQuery?: boolean; // For "self" entity
      requiresRAGStatusCheck?: boolean; // For RAG entities
    };
  };
}
```

## Example: Telegram Platform Config

```javascript
const TELEGRAM_CONFIG = {
  platform: "TELEGRAM",
  mcpCredentialId: "aiYCclLDUqob5iQ0",
  cacheKeyPrefix: "telegram",
  defaultTTL: 6 * 60 * 60 * 1000, // 6 hours
  
  entities: {
    "contact": {
      cacheKey: "telegramContacts",
      fetchWorkflowId: "TelegramContactFetch",
      mcpTool: {
        name: "telegram_list_contacts",
        parameters: { limit: 200 },
        mcpDataKey: "contacts"
      },
      mapper: "(c) => ({ id: c.id, username: c.username, displayName: c.name, lastMessage: c.lastMessageAtRelative, contactType: c.type, phone: c.phone, platform: 'TELEGRAM' })",
      dataKey: "contacts",
      searchType: "rag",
      ragConfig: {
        collectionId: "paragon-os-contacts",
        autoIngest: true
      },
      requiresRAGStatusCheck: true
    },
    "chat": {
      cacheKey: "telegramChannels",
      fetchWorkflowId: "TelegramChatFetch",
      mcpTool: {
        name: "telegram_list_chats",
        parameters: { limit: 50 },
        mcpDataKey: "items"
      },
      mapper: "(g) => ({ id: g.id, name: g.name, members: g.memberCount, kind: g.kind, unread: g.unread })",
      dataKey: "channels",
      searchType: "fuzzy",
      fuzzyConfig: {
        searchKeys: ["name", "kind"],
        matchQuality: 50,
        limit: 10
      }
    },
    // ... other entities
  }
};
```

## Example: Discord Platform Config

```javascript
const DISCORD_CONFIG = {
  platform: "DISCORD",
  mcpCredentialId: "ZFofx3k2ze1wsifx",
  cacheKeyPrefix: "discord",
  defaultTTL: 6 * 60 * 60 * 1000, // 6 hours
  
  entities: {
    "contact": {
      cacheKey: "discordContacts",
      fetchWorkflowId: "DiscordContactFetch",
      mcpTool: {
        name: "discord_list_contacts",
        parameters: { limit: 100 },
        mcpDataKey: "contacts"
      },
      mapper: "(c) => ({ id: c.id, username: c.tag, displayName: c.displayName, lastMessage: c.lastMessageAtRelative, contactType: c.type, platform: 'DISCORD' })",
      dataKey: "contacts",
      searchType: "rag",
      ragConfig: {
        collectionId: "paragon-os-contacts",
        autoIngest: true
      },
      requiresRAGStatusCheck: true
    },
    "guild": {
      cacheKey: "discordGuilds",
      fetchWorkflowId: "DiscordGuildFetch",
      mcpTool: {
        name: "discord_list_guilds",
        parameters: {},
        mcpDataKey: "guilds"
      },
      mapper: "(g) => ({ id: g.id, name: g.name, members: g.memberCount, channels: g.channels ?? [] })",
      dataKey: "guilds",
      searchType: "fuzzy",
      fuzzyConfig: {
        searchKeys: ["name", "channels"],
        matchQuality: 50,
        limit: 10
      }
    },
    // ... other entities
  }
};
```

## Implementation Status

### ✅ Completed
- ✅ MCP Data Normalizer helper
- ✅ Entity Cache Handler helper
- ✅ Generic Context Scout Core (basic structure)
- ✅ All entity fetch workflows:
  - Telegram: Contact, Chat, Tool, Profile, Message
  - Discord: Contact, Guild, Tool, Profile
- ✅ Platform wrapper workflows:
  - Telegram Context Scout (preserves ID: `TelegramContextScout`)
  - Discord Context Scout (preserves ID: `BB1zsros5LmyJO9N`)

### ⚠️ Needs Refinement
- Core workflow RAG status checking logic (for entities with `requiresRAGStatusCheck`)
- Message entity handling (requires chat_id parameter)
- Profile entity special handling (skipQuery - returns data without search)
- Data flow from cache handler to search nodes

### 📋 Next Steps
1. Test end-to-end with existing test cases
2. Refine core workflow based on testing:
   - Add RAG status check workflow calls
   - Handle message entity chat_id parameter
   - Implement skipQuery logic for "self" entity
3. Verify backward compatibility with existing workflows
4. Update test cases if needed

## File Structure

```
workflows/
├── HELPERS/
│   ├── [HELPERS] MCP Data Normalizer.json ✅
│   ├── [HELPERS] Entity Cache Handler.json ✅
│   ├── [HELPERS] Generic Context Scout Core.json ✅
│   └── Entity Fetch Workflows/
│       ├── [HELPERS] Telegram Contact Fetch.json ✅
│       ├── [HELPERS] Telegram Chat Fetch.json ✅
│       ├── [HELPERS] Telegram Tool Fetch.json ✅
│       ├── [HELPERS] Telegram Profile Fetch.json ✅
│       ├── [HELPERS] Telegram Message Fetch.json ✅
│       ├── [HELPERS] Discord Contact Fetch.json ✅
│       ├── [HELPERS] Discord Guild Fetch.json ✅
│       ├── [HELPERS] Discord Tool Fetch.json ✅
│       └── [HELPERS] Discord Profile Fetch.json ✅
├── Telegram Context Scout.json ✅ (wrapper - preserves ID)
└── Discord Context Scout.json ✅ (wrapper - preserves ID)
```

## Notes

- Workflow IDs must be preserved for backward compatibility
- Credentials are hardcoded in entity fetch workflows (n8n limitation)
- Mapper functions are passed as strings and evaluated in the normalizer
- The core workflow handles routing, caching, and search orchestration
- Platform wrappers are thin - they just load config and call core

