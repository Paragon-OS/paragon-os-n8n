# Discord MCP Server

**Part of ParagonOS by Metarune Labs Pvt Ltd**

A Model Context Protocol (MCP) server that enables AI assistants to interact with Discord through self-bot functionality, providing comprehensive access to channels, messages, and server management.

## Overview

This MCP server acts as a bridge between AI assistants like Claude and Discord, allowing programmatic access to read messages, manage channels, retrieve user information, and interact with Discord servers through the MCP protocol.

## Features

### Message Management
- Read channel messages with customizable limits
- Search messages by content, author, or date range
- Send messages to channels
- Reply to specific messages

### Server & Channel Management
- List accessible channels with guild filtering
- View all guilds/servers
- Manage server members and roles
- Contact management with pagination

### User Information
- Retrieve logged-in user information
- List guild members with role details
- Contact discovery and management

### Advanced Capabilities
- **Relative time formatting** for message timestamps
- **Support for attachments and embeds**
- **Robust error handling** and validation

## Installation

### Option 1: Direct use with npx (Recommended)

Configure your MCP client:

```json
{
  "mcpServers": {
    "discord": {
      "command": "npx",
      "args": ["-y", "discord-self-mcp"],
      "env": {
        "DISCORD_TOKEN": "your_discord_token_here"
      }
    }
  }
}
```

### Option 2: Global Installation

```bash
npm install -g discord-self-mcp
```

Then configure your MCP client:

```json
{
  "mcpServers": {
    "discord": {
      "command": "discord-self-mcp",
      "env": {
        "DISCORD_TOKEN": "your_discord_token_here"
      }
    }
  }
}
```

### Option 3: Local Development

```bash
git clone https://github.com/Paragon-OS/paragonos-discord-self-mcp.git
cd paragonos-discord-self-mcp
npm install
npm run build
```

## Configuration

### Discord Token

Obtain your Discord token using the browser console:

1. Open Discord in your browser
2. Press F12 to open developer tools
3. Go to the Console tab
4. Paste and execute the token extraction script
5. Your token will be copied to clipboard

## Usage Examples

- "List my Discord servers"
- "Read the last 20 messages from channel [ID]"
- "Search for messages containing 'meeting' in channel [ID]"
- "Send a message to channel [ID]"
- "Show my Discord contacts"

## Security Notice

This server uses Discord self-bot functionality, which is against Discord's Terms of Service. Use at your own risk and only for educational or personal purposes.

## About ParagonOS

ParagonOS is a suite of MCP servers developed by **Metarune Labs Pvt Ltd**, enabling seamless AI integration with modern communication platforms while maintaining security and privacy.

## License

This project is distributed under its original license terms. See LICENSE file for details.

---

**Developed by Metarune Labs Pvt Ltd**
Part of the ParagonOS ecosystem
