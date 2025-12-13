#!/usr/bin/env node
import { toolRegistry } from './server/tool-registry.js'
import { DiscordMCPSSEServer } from './server/sse-server.js'

// Import and register all tools
import {
  readChannelTool,
  searchMessagesTool,
  sendMessageTool,
  editMessageTool,
  replyMessageTool,
  deleteMessageTool,
  downloadAttachmentsTool,
} from './tools/messages/index.js'

import {
  listGuildsTool,
  listChannelsTool,
  listGuildMembersTool,
  listChannelFiltersTool,
  updateChannelFiltersTool,
} from './tools/guilds/index.js'

import {
  getUserInfoTool,
  listContactsTool,
  searchContactsTool,
} from './tools/users/index.js'

// Register all tools with the registry
toolRegistry.registerTool(readChannelTool)
toolRegistry.registerTool(searchMessagesTool)
toolRegistry.registerTool(sendMessageTool)
toolRegistry.registerTool(editMessageTool)
toolRegistry.registerTool(replyMessageTool)
toolRegistry.registerTool(deleteMessageTool)
toolRegistry.registerTool(downloadAttachmentsTool)
toolRegistry.registerTool(listGuildsTool)
toolRegistry.registerTool(listChannelsTool)
toolRegistry.registerTool(listGuildMembersTool)
toolRegistry.registerTool(listChannelFiltersTool)
toolRegistry.registerTool(updateChannelFiltersTool)
toolRegistry.registerTool(getUserInfoTool)
toolRegistry.registerTool(listContactsTool)
toolRegistry.registerTool(searchContactsTool)

const server = new DiscordMCPSSEServer()
server.run().catch(console.error)
