import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { Channel, TextChannel, Message, DMChannel } from 'discord.js-selfbot-v13'
import type { DiscordClient } from '../../types/discord.js'
import type { DeleteMessageArgs } from '../../types/tool-args.js'
import { createMCPResponse, deletedMessagesManager } from '../../utils/index.js'
import type { ToolDefinition } from '../../server/tool-registry.js'

export async function deleteMessage(
  client: DiscordClient,
  args: DeleteMessageArgs,
) {
  const { channelId, messageId, force = false } = args

  try {
    let channel: Channel
    
    // First, check if channel is in cache
    const cachedChannel = client.channels.cache.get(channelId)
    if (cachedChannel) {
      channel = cachedChannel as Channel
    } else {
      // Try to fetch as a channel
      try {
        channel = (await client.channels.fetch(channelId)) as Channel
      } catch (error) {
        const channelError = error instanceof Error ? error.message : String(error)
        const errorLower = channelError.toLowerCase()
        
        // If error is "Unknown Channel", it's definitely not a user ID
        // Only try user fetch for other errors (like permission issues)
        if (errorLower.includes('unknown channel')) {
          throw new Error(
            `Channel with ID "${channelId}" not found or not accessible. ` +
            `The channel may not exist, you may not have access to it, or the channel ID may be incorrect. ` +
            `Use discord_list_channels to see available channels.`
          )
        }
        
        // For other errors, it might be a user ID
        // Try to create a DM channel with the user
        try {
          const user = await client.users.fetch(channelId)
          if (!user) {
            throw new Error('User not found')
          }
          
          // Create DM channel with the user
          const dmChannel = await user.createDM()
          channel = dmChannel as Channel
          console.error(`[MESSAGE] Created DM channel ${dmChannel.id} for user ${user.tag}`)
        } catch (userError) {
          const userErrorMsg = userError instanceof Error ? userError.message : String(userError)
          throw new Error(
            `Channel with ID "${channelId}" not found (${channelError}). ` +
            `Also tried as user ID but failed: ${userErrorMsg}. ` +
            `Please verify the channel ID is correct and that you have access to it. ` +
            `Use discord_list_channels to see available channels.`
          )
        }
      }
    }

    if (!channel || !channel.isText()) {
      throw new Error(
        'Channel not found or cannot delete messages from this channel',
      )
    }

    const textChannel = channel as TextChannel
    
    // Fetch the message to delete
    const message = await textChannel.messages.fetch(messageId)
    if (!message) {
      throw new Error('Message not found')
    }

    const isOwnMessage = message.author.id === client.user?.id

    // Store message details before deletion
    const messageDetails = {
      id: message.id,
      content: message.content,
      timestamp: message.createdTimestamp,
      author: {
        id: message.author.id,
        username: message.author.username,
        discriminator: message.author.discriminator,
        tag: message.author.tag,
      },
    }

    let deletionMethod: 'hard_delete' | 'soft_delete'
    let success = false
    let errorMessage: string | undefined

    if (isOwnMessage) {
      // Always try hard delete for own messages
      try {
        await message.delete()
        deletionMethod = 'hard_delete'
        success = true
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to delete your own message: ${errorMsg}`)
      }
    } else {
      // For other users' messages, check if force is enabled
      if (!force) {
        throw new Error('You can only delete your own messages. Use force=true to bypass this check (requires proper Discord permissions)')
      }

      // Try hard delete first (for guild messages with proper permissions)
      try {
        await message.delete()
        deletionMethod = 'hard_delete'
        success = true
      } catch (error) {
        // If hard delete fails, use soft delete (hide the message)
        console.error(`Hard delete failed for message ${message.id}, using soft delete:`, error)
        
        await deletedMessagesManager.addDeletedMessage({
          messageId: message.id,
          channelId: channel.id,
          originalAuthor: messageDetails.author,
          deletedBy: client.user?.id || 'unknown',
          deletedAt: Date.now(),
          reason: 'soft_delete',
          originalContent: message.content,
          originalTimestamp: message.createdTimestamp,
        })
        
        deletionMethod = 'soft_delete'
        success = true
        errorMessage = `Message hidden (soft delete) - Discord API restriction: ${error}`
      }
    }

    return createMCPResponse({
      success,
      messageId: messageDetails.id,
      channelId: channel.id,
      deletedAt: Date.now(),
      message: success ? 
        (deletionMethod === 'hard_delete' ? 'Message deleted successfully' : 'Message hidden successfully') : 
        'Failed to delete message',
      deletedContent: messageDetails.content,
      originalTimestamp: messageDetails.timestamp,
      originalAuthor: messageDetails.author,
      forcedDeletion: force,
      wasOwnMessage: isOwnMessage,
      deletionMethod,
      errorMessage,
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to delete message: ${errorMsg}`,
    )
  }
}

export const deleteMessageTool: ToolDefinition = {
  name: 'discord_delete_message',
  description: 'Delete a Discord message. For your own messages: always deletes from Discord. For others\' messages with force=true: tries Discord deletion first, falls back to hiding the message locally if Discord API restricts it (e.g., in DMs).',
  inputSchema: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'The Discord channel ID or user ID where the message is located',
      },
      messageId: {
        type: 'string',
        description: 'The ID of the message to delete',
      },
      force: {
        type: 'boolean',
        description: 'Bypass ownership check and attempt to delete any message. For others\' messages: tries Discord deletion first, falls back to hiding locally if restricted. Default: false',
        default: false,
      },
    },
    required: ['channelId', 'messageId'],
  },
  handler: deleteMessage,
}
