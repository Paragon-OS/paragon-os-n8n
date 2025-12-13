# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Telegram MCP is a Model Context Protocol (MCP) server that provides Claude Desktop integration with Telegram via the Telethon library. It exposes 70+ MCP tools for chat management, messaging, contacts, media, and admin operations.

## Development Commands

```bash
# Run the MCP server (main entry point)
uv run main.py

# Generate a Telegram session string (interactive - requires phone auth)
python session_string_generator.py

# Install dependencies
pip install -r requirements.txt
# or with uv
uv sync

# Container (Docker/Podman)
podman build -t telegram-mcp .
podman run --rm --env-file .env -it telegram-mcp

# Or with docker-compose/podman-compose
podman-compose up --build
```

## Architecture

### Entry Point
- `main.py` - Initializes FastMCP server, registers all tools, handles Telegram client lifecycle and graceful shutdown

### Package Structure (`telegram_mcp/`)
- `config.py` - Telegram client initialization (TelegramClient), logging setup, environment variable loading
- `tools/` - MCP tool implementations organized by domain:
  - `chat_tools.py` - Chat listing, creation, membership, invites, archiving
  - `message_tools.py` - Send, edit, delete, forward, pin, search messages
  - `contact_tools.py` - Contact CRUD, blocking, import/export
  - `media_tools.py` - File/voice/sticker sending, media download, GIF search
  - `admin_tools.py` - Group/channel admin: participants, bans, promotions
  - `profile_tools.py` - User profile, photos, privacy settings
  - `reaction_tools.py` - Message reactions
  - `misc_tools.py` - Mute/unmute, public chat search, bot commands
- `utils/` - Shared utilities:
  - `helpers.py` - Entity formatting, message formatting, `get_entity_with_fallback()` for ID resolution
  - `errors.py` - Centralized error logging with `log_and_format_error()`
  - `media_storage.py` - Downloaded media tracking and MCP resource serving

### Key Patterns

**Tool Registration**: Tools are async functions in `telegram_mcp/tools/`, registered in `main.py` via `mcp.tool()()`. Each tool returns JSON strings.

**Entity Resolution**: Use `get_entity_with_fallback()` from `helpers.py` for chat/user lookups - it handles positive/negative ID conversion for groups.

**Error Handling**: All tools use `log_and_format_error()` to log to `mcp_errors.log` and return user-friendly error codes.

**MCP Resources**: Media files are exposed via `tgfile://{chat_id}/{message_id}` URI scheme.

## Configuration

Required environment variables in `.env`:
- `TELEGRAM_API_ID` - From https://my.telegram.org/apps
- `TELEGRAM_API_HASH` - From https://my.telegram.org/apps
- `TELEGRAM_SESSION_STRING` or `TELEGRAM_SESSION_NAME` - Session authentication

Optional:
- `TELEGRAM_MCP_INCLUDE_DEPRECATED=true` - Enable deprecated tools

## Testing

```bash
# Run container integration test (requires .env with valid credentials)
python tests/test_mcp_container.py

# Run with pytest
pytest tests/test_mcp_container.py -v
```

The integration test (`tests/test_mcp_container.py`) builds a container, starts the MCP server, and verifies:
- Server initializes with correct protocol version
- All 80+ tools are registered
- Tool schemas are valid

**MCP Protocol**: The server uses JSON-RPC 2.0 over stdio. To manually test:
```bash
podman run --rm -i --env-file .env telegram-mcp << 'EOF'
{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0.0"}}}
{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
EOF
```

## SSE Transport Mode (For Container-to-Container Communication)

The MCP server supports **SSE (Server-Sent Events) transport** in addition to stdio. This is essential for running MCP in a container that other containers (like n8n) need to connect to.

### Why SSE?
- **STDIO** works for local processes but not for container-to-container communication
- **SSE** allows HTTP-based communication over a network (localhost in a podman pod)
- n8n's MCP Client Tool node supports SSE endpoints

### Running in SSE Mode

Create an SSE entrypoint (`run_sse.py`):
```python
#!/usr/bin/env python3
"""SSE mode entrypoint for Telegram MCP server."""
import asyncio
import nest_asyncio

nest_asyncio.apply()

from main import mcp, client, cleanup

async def main():
    try:
        await client.start()

        # Configure for container networking
        mcp.settings.host = "0.0.0.0"  # Bind to all interfaces
        mcp.settings.port = 8000

        # Run SSE server (not stdio)
        await mcp.run_sse_async()
    finally:
        await cleanup()

if __name__ == "__main__":
    asyncio.run(main())
```

### SSE Dockerfile

```dockerfile
FROM python:3.13-alpine
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py telegram_mcp/ run_sse.py ./

EXPOSE 8000
CMD ["python", "run_sse.py"]
```

### Running with n8n in a Podman Pod

Containers in a podman pod share localhost network:

```bash
# Create pod with published ports
podman pod create --name telegram-n8n-pod -p 5678:5678 -p 8000:8000

# Start MCP container (SSE mode)
podman run -d --pod telegram-n8n-pod --name telegram-mcp \
  --env-file .env \
  telegram-mcp-sse:latest

# Start n8n container
podman run -d --pod telegram-n8n-pod --name n8n \
  localhost/n8n-paragon-os:latest

# n8n can now connect to MCP at http://localhost:8000/sse
```

### SSE Protocol Details

1. **Client connects** to `/sse` endpoint (EventSource)
2. **Server sends** `endpoint` event with session URL: `data: /messages/?session_id=xxx`
3. **Client POSTs** JSON-RPC requests to `/messages/?session_id=xxx`
4. **Server responds** via SSE stream as `message` events

### FastMCP SSE API

The `mcp.server.fastmcp.FastMCP` class provides:
- `mcp.settings.host` - Bind address (default: "127.0.0.1", use "0.0.0.0" for containers)
- `mcp.settings.port` - Port (default: 8000)
- `mcp.settings.sse_path` - SSE endpoint path (default: "/sse")
- `mcp.settings.message_path` - Message POST path (default: "/messages/")
- `mcp.run_sse_async()` - Run SSE server
- `mcp.sse_app()` - Get Starlette app for custom mounting

### n8n MCP Credential Configuration

In n8n, configure an MCP Client credential with:
- **Transport Type**: SSE
- **SSE Endpoint**: `http://localhost:8000/sse` (when in same pod)

## Monorepo Context

This is part of the `paragon-os-app` monorepo:
```
paragon-os-app/
├── n8n-agent/              # Workflow management & testing
├── n8n-nodes/              # Custom n8n nodes
└── mcp-servers/
    ├── telegram-mcp/       # This project (82 tools)
    └── discord-self-mcp/   # Discord MCP (TypeScript, 14 tools)
```

### Integration Testing from n8n-agent

The `n8n-agent` project includes integration tests that run this MCP server in a container with SSE transport. See `n8n-agent/src/tests/integration/mcp-container.test.ts`.

## Claude Desktop Integration

Add to Claude Desktop config:
```json
{
  "mcpServers": {
    "telegram-mcp": {
      "command": "/path/to/uv",
      "args": ["--directory", "/path/to/telegram-mcp", "run", "main.py"]
    }
  }
}
```
