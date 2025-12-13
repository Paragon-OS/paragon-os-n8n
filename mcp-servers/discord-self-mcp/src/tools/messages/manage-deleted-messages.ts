import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { DiscordClient } from '../../types/discord.js'
import { createMCPResponse, deletedMessagesManager } from '../../utils/index.js'
import type { ToolDefinition } from '../../server/tool-registry.js'

export interface ManageDeletedMessagesArgs {
  action: 'list' | 'restore' | 'clear' | 'info'
  messageId?: string
  channelId?: string
}

export async function manageDeletedMessages(
  client: DiscordClient,
  args: ManageDeletedMessagesArgs,
) {
  const { action, messageId, channelId } = args

  try {
    switch (action) {
      case 'list': {
        const deletedMessages = channelId 
          ? await deletedMessagesManager.getDeletedMessagesForChannel(channelId)
          : await deletedMessagesManager.getAllDeletedMessages()
        
        return createMCPResponse({
          action: 'list',
          count: deletedMessages.length,
          channelId: channelId || 'all',
          deletedMessages: deletedMessages.map(msg => ({
            messageId: msg.messageId,
            channelId: msg.channelId,
            originalAuthor: msg.originalAuthor,
            deletedBy: msg.deletedBy,
            deletedAt: msg.deletedAt,
            reason: msg.reason,
            originalContent: msg.originalContent,
            originalTimestamp: msg.originalTimestamp,
          })),
        })
      }

      case 'restore': {
        if (!messageId) {
          throw new Error('messageId is required for restore action')
        }

        const deletedMessage = await deletedMessagesManager.getDeletedMessage(messageId)
        if (!deletedMessage) {
          throw new Error('Message not found in deleted messages database')
        }

        await deletedMessagesManager.removeDeletedMessage(messageId)

        return createMCPResponse({
          action: 'restore',
          messageId,
          restoredMessage: deletedMessage,
          message: 'Message restored successfully (removed from hidden list)',
        })
      }

      case 'clear': {
        const deletedMessages = await deletedMessagesManager.getAllDeletedMessages()
        const count = deletedMessages.length
        
        await deletedMessagesManager.clearDatabase()

        return createMCPResponse({
          action: 'clear',
          clearedCount: count,
          message: `Cleared ${count} deleted messages from database`,
        })
      }

      case 'info': {
        const deletedMessages = await deletedMessagesManager.getAllDeletedMessages()
        const channelCounts: Record<string, number> = {}
        
        deletedMessages.forEach(msg => {
          channelCounts[msg.channelId] = (channelCounts[msg.channelId] || 0) + 1
        })

        return createMCPResponse({
          action: 'info',
          totalDeletedMessages: deletedMessages.length,
          channelBreakdown: channelCounts,
          softDeletedCount: deletedMessages.filter(msg => msg.reason === 'soft_delete').length,
          hardDeletedCount: deletedMessages.filter(msg => msg.reason === 'hard_delete').length,
        })
      }

      default:
        throw new Error(`Unknown action: ${action}. Valid actions are: list, restore, clear, info`)
    }
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to manage deleted messages: ${error}`,
    )
  }
}

export const manageDeletedMessagesTool: ToolDefinition = {
  name: 'discord_manage_deleted_messages',
  description: 'Manage soft-deleted messages database. List, restore, clear, or get info about hidden messages.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform: "list" (show deleted messages), "restore" (unhide a message), "clear" (remove all from database), "info" (get statistics)',
        enum: ['list', 'restore', 'clear', 'info'],
      },
      messageId: {
        type: 'string',
        description: 'Message ID (required for restore action)',
      },
      channelId: {
        type: 'string',
        description: 'Channel ID (optional, filters list action to specific channel)',
      },
    },
    required: ['action'],
  },
  handler: manageDeletedMessages,
}
