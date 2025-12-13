# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Discord MCP is a Model Context Protocol (MCP) server that enables AI assistants to interact with Discord through self-bot functionality. It's a TypeScript/Node.js project that provides 15 tools for channel reading, message management, guild operations, and user lookups.

## Development Commands

```bash
# Build the project
npm run build

# Run the MCP server - STDIO mode (after build)
npm run start              # or: node dist/index.js

# Run the MCP server - SSE mode (for containers/remote)
npm run start:sse          # or: node dist/index-sse.js

# Install dependencies
npm install

# For development with auto-rebuild
npm run dev

# Run tests
npm test                   # All tests
npm run test:container     # Container SSE test only
npm run test:watch         # Watch mode
```

## Architecture

### Entry Points
- `src/index.ts` - STDIO transport entry point (for local MCP clients)
- `src/index-sse.ts` - SSE transport entry point (for containers/remote access)

### Package Structure (`src/`)
- `server/` - MCP server implementation
  - `discord-mcp-base.ts` - Base class with Discord client and tool handlers
  - `server.ts` - STDIO transport server (extends base)
  - `sse-server.ts` - SSE/HTTP transport server using Express (extends base)
  - `tool-registry.ts` - Tool registration and management
- `tests/` - Test suites
  - `container-sse.test.ts` - Container SSE integration tests
- `tools/` - MCP tool implementations organized by domain:
  - `messages/` - Channel reading, message search, send, edit, reply, delete, attachments
  - `guilds/` - List guilds, channels, members, channel filters
  - `users/` - User info, contacts list, contact search
- `core/` - Discord client wrapper and connection management
- `types/` - TypeScript type definitions
- `utils/` - Shared utilities

### Available Tools (15 total)

**Message Tools:**
- `discord_read_channel` - Read messages from a channel
- `discord_search_messages` - Search messages by content/author/date
- `discord_send_message` - Send a message to a channel
- `discord_edit_message` - Edit an existing message
- `discord_reply_message` - Reply to a specific message
- `discord_delete_message` - Delete a message
- `discord_download_attachments` - Download message attachments

**Guild Tools:**
- `discord_list_guilds` - List all accessible servers
- `discord_list_channels` - List channels in a guild
- `discord_list_guild_members` - List members with roles
- `discord_list_channel_filters` - View channel filter settings
- `discord_update_channel_filters` - Update channel filters

**User Tools:**
- `discord_get_user_info` - Get logged-in user information
- `discord_list_contacts` - List contacts with pagination
- `discord_search_contacts` - Search contacts by name/username

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | Yes | - | Discord user token (self-bot token) |
| `MCP_HOST` | No | `0.0.0.0` | Host to bind SSE server |
| `MCP_PORT` | No | `8000` | Port for SSE server |

## Transport Modes

### STDIO Transport (Default)
For local MCP clients (Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/path/to/discord-self-mcp/dist/index.js"],
      "env": {
        "DISCORD_TOKEN": "your_discord_token"
      }
    }
  }
}
```

### SSE Transport (Container/Remote)
For containerized or remote deployments. Uses HTTP with Server-Sent Events.

**Endpoints:**
- `GET /health` - Health check (returns `{ status, discord_ready, sessions }`)
- `GET /sse` - Establish SSE connection (returns session ID)
- `POST /messages?sessionId=xxx` - Send JSON-RPC requests

**SSE Protocol Flow:**
1. Client connects to `/sse` endpoint
2. Server sends `event: endpoint` with `data: /messages?sessionId=xxx`
3. Client POSTs JSON-RPC requests to `/messages?sessionId=xxx`
4. Server responds via the SSE stream as `event: message`

## Container Deployment

### Build Image
```bash
npm run build
podman build -t discord-self-mcp:latest .
```

### Run Container
```bash
podman run -d --name discord-mcp \
  -p 8000:8000 \
  -e DISCORD_TOKEN="your_discord_token" \
  discord-self-mcp:latest
```

### Verify with Health Check
```bash
curl http://localhost:8000/health
# Returns: {"status":"ok","discord_ready":true,"sessions":0}
```

### Query Tools via SSE
The container test (`npm run test:container`) demonstrates how to:
1. Connect to `/sse` endpoint
2. Parse session ID from endpoint event
3. POST `tools/list` request to `/messages?sessionId=xxx`
4. Receive tool list via SSE stream

## Testing

Tests use **vitest** and **podman** for container testing.

```bash
npm test                   # All tests
npm run test:container     # Container SSE integration test
```

**Container SSE Test** (`src/tests/container-sse.test.ts`):
- Builds and starts container with Discord token
- Waits for health check (Discord client ready)
- Verifies `/health` endpoint
- Queries `tools/list` via SSE and verifies all 15 tools

## Monorepo Context

This is part of the `paragon-os-app` monorepo:
```
paragon-os-app/
├── n8n-agent/              # Workflow management & testing
├── n8n-nodes/              # Custom n8n nodes
└── mcp-servers/
    ├── telegram-mcp/       # Telegram MCP (Python)
    └── discord-self-mcp/   # This project
```

## Key Differences from Telegram MCP

| Feature | Discord MCP | Telegram MCP |
|---------|-------------|--------------|
| Language | TypeScript/Node.js | Python (FastMCP) |
| Transport | STDIO + SSE | STDIO + SSE |
| Tool Count | 15 | 82 |
| Auth | Discord token | Telegram session |
| SSE Framework | Express + MCP SDK | FastMCP built-in |
| Container | node:20-alpine | python:3.13-alpine |

## Dependencies

**Runtime:**
- `@modelcontextprotocol/sdk` (^1.24.0) - MCP protocol implementation
- `discord.js-selfbot-v13` - Discord self-bot client
- `express` (^5.0.1) - HTTP server for SSE transport
- `cors` - CORS middleware

**Dev:**
- `vitest` - Test framework
- `typescript` - Type checking
- `tsx` - TypeScript execution

## Security Notice

This uses Discord self-bot functionality, which is against Discord's Terms of Service. Use responsibly for personal/educational purposes only.
