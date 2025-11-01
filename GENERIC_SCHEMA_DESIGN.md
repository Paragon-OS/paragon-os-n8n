# Generic MCP Response Parser Schema Design

## Overview

The **Generic MCP Response Parser** replaces the hardcoded "Contact List Parser" to support all Discord MCP tool outputs dynamically. This schema is designed to handle various response patterns from MCP tools while maintaining structure for downstream processing.

## Schema Structure

### Core Fields

The schema has the following required and optional fields:

#### Required Fields
- **`toolName`** (string): Identifies which MCP tool generated the response
  - Examples: `"discord_list_channels"`, `"discord_send_message"`, `"mcp_list_tools"`, etc.
  
- **`responseType`** (enum): Categorizes the response structure
  - `"list"`: Arrays of items (channels, messages, guilds, members, etc.)
  - `"single"`: Single objects (user info, channel details, etc.)
  - `"action"`: Operation results (send, edit, delete, reply, etc.)
  - `"tool_catalog"`: Tool listing responses from `mcp_list_tools`
  - `"error"`: Error responses

#### Optional Fields

- **`data`** (array | object): Main response payload
  - For `"list"` and `"tool_catalog"`: Array of items
  - For `"single"` and `"action"`: Object with response details
  - Uses `oneOf` to allow flexible typing

- **`pagination`** (object | null): Pagination metadata (for list responses)
  - `offset`: Starting position (number)
  - `limit`: Items per page (number)
  - `hasMore`: Whether more items available (boolean)
  - `nextOffset`: Offset/cursor for next page (number | string)
  - `before`: Cursor/ID for pagination (string)
  - `after`: Cursor/ID for pagination (string)

- **`summary`** (object | null): Summary statistics
  - `total`: Total items available (number)
  - `returned`: Items in this response (number)
  - `hasMore`: Whether more available (boolean)

- **`status`** (enum | null): Operation status (for action responses)
  - `"success"`: Operation succeeded
  - `"error"`: Operation failed
  - `"partial"`: Partial success

- **`message`** (string | null): Human-readable result description

- **`error`** (object | null): Error details (when status is "error")
  - `code`: Error code (string | number)
  - `message`: Error message (string)
  - `details`: Additional error info (object | string)

- **`metadata`** (object | null): Tool-specific additional metadata
  - Flexible structure to accommodate any tool-specific fields

## Response Type Examples

### List Response (`responseType: "list"`)
```json
{
  "toolName": "discord_list_channels",
  "responseType": "list",
  "data": [
    {
      "id": "123456789",
      "name": "general",
      "type": "text"
    }
  ],
  "pagination": {
    "offset": 0,
    "limit": 50,
    "hasMore": true,
    "nextOffset": 50
  },
  "summary": {
    "total": 150,
    "returned": 50,
    "hasMore": true
  }
}
```

### Single Item Response (`responseType: "single"`)
```json
{
  "toolName": "discord_get_user_info",
  "responseType": "single",
  "data": {
    "id": "123456789",
    "username": "user123",
    "discriminator": "0001",
    "avatar": "https://..."
  }
}
```

### Action Response (`responseType: "action"`)
```json
{
  "toolName": "discord_send_message",
  "responseType": "action",
  "data": {
    "messageId": "987654321",
    "channelId": "123456789",
    "timestamp": "2024-01-01T12:00:00Z"
  },
  "status": "success",
  "message": "Message sent successfully"
}
```

### Tool Catalog Response (`responseType: "tool_catalog"`)
```json
{
  "toolName": "mcp_list_tools",
  "responseType": "tool_catalog",
  "data": [
    {
      "name": "discord_read_channel",
      "description": "Read messages from a Discord channel...",
      "schema": { ... }
    }
  ]
}
```

### Error Response (`responseType: "error"`)
```json
{
  "toolName": "discord_send_message",
  "responseType": "error",
  "status": "error",
  "message": "Failed to send message",
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "You do not have permission to send messages in this channel",
    "details": {}
  }
}
```

## Key Design Decisions

### 1. **Flexible Schema (`strict: false`, `additionalProperties: true`)**
   - Allows unknown fields to pass through
   - Tool-specific fields can be included in `data` or `metadata`
   - Prevents schema validation errors from unexpected MCP server responses

### 2. **Response Type Categorization**
   - Helps the AI agent understand what kind of response it received
   - Enables structured processing based on response type
   - Makes it easier to handle pagination, actions, and errors differently

### 3. **Optional Pagination Support**
   - Supports multiple pagination patterns:
     - Offset-based (`offset`/`limit`/`nextOffset`)
     - Cursor-based (`before`/`after`)
     - Summary-based (`hasMore` in summary)
   - Works with tools like `discord_read_channel`, `discord_list_channels`, etc.

### 4. **Unified Error Handling**
   - `error` object provides structured error information
   - `status` field allows quick error detection
   - `message` provides human-readable context

### 5. **Metadata Flexibility**
   - `metadata` field allows any tool-specific fields
   - Prevents schema from breaking when MCP tools add new fields
   - Maintains forward compatibility

## Compatibility with Discord MCP Tools

This schema supports all Discord MCP tools from the provided output:

### List Tools
- ✅ `discord_list_guilds` - Returns array of guilds
- ✅ `discord_list_channels` - Returns array with pagination
- ✅ `discord_list_guild_members` - Returns array of members
- ✅ `discord_list_channel_filters` - Returns filter configuration
- ✅ `discord_get_pending_guild_channels` - Returns array with pagination

### Read Tools
- ✅ `discord_read_channel` - Returns array of messages with pagination
- ✅ `discord_get_user_info` - Returns single user object

### Action Tools
- ✅ `discord_send_message` - Returns action result
- ✅ `discord_edit_message` - Returns action result
- ✅ `discord_reply_message` - Returns action result
- ✅ `discord_delete_message` - Returns action result
- ✅ `discord_download_attachments` - Returns action result
- ✅ `discord_update_channel_filters` - Returns action result

### Discovery Tools
- ✅ `mcp_list_tools` - Returns tool catalog array

## Benefits

1. **Generic & Extensible**: Works with any MCP tool, not just Discord contacts
2. **Type-Safe Structure**: Provides clear structure while remaining flexible
3. **Pagination Support**: Handles various pagination patterns
4. **Error Handling**: Unified error structure for consistent processing
5. **Future-Proof**: `additionalProperties: true` allows new fields without breaking changes
6. **AI-Friendly**: Clear response types help AI agent understand and process responses

## Usage in n8n Workflow

The parser is connected to the **Discord MCP Agent** as an `ai_outputParser`, allowing the agent to return structured responses that can be:
- Processed by downstream nodes
- Used for conditional logic
- Displayed in UI components
- Stored in databases
- Used for pagination handling

The agent is instructed to format its responses according to this schema, ensuring consistent structured output regardless of which MCP tool was executed.

