import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { Channel, TextChannel, Message } from 'discord.js-selfbot-v13'
import type { DiscordClient } from '../../types/discord.js'
import type { EditMessageArgs } from '../../types/tool-args.js'
import { createMCPResponse } from '../../utils/index.js'
import type { ToolDefinition } from '../../server/tool-registry.js'

export async function editMessage(
  client: DiscordClient,
  args: EditMessageArgs,
) {
  const { channelId, messageId, content } = args

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
        'Channel not found or cannot send messages to this channel',
      )
    }

    const textChannel = channel as TextChannel
    
    // Fetch the message to edit
    const message = await textChannel.messages.fetch(messageId)
    if (!message) {
      throw new Error('Message not found')
    }

    // Verify message author is the current user (can only edit own messages)
    if (message.author.id !== client.user?.id) {
      throw new Error('You can only edit your own messages')
    }

    // Edit the message with new content
    const editedMessage = await message.edit(content)

    return createMCPResponse({
      success: true,
      messageId: editedMessage.id,
      channelId: channel.id,
      content: content,
      timestamp: editedMessage.createdTimestamp,
      editedTimestamp: editedMessage.editedTimestamp,
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to edit message: ${errorMsg}`,
    )
  }
}

export const editMessageTool: ToolDefinition = {
  name: 'discord_edit_message',
  description: 'Edit a previously sent Discord message. Can only edit your own messages. Accepts channel ID or user ID.',
  inputSchema: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'The Discord channel ID or user ID where the message was sent',
      },
      messageId: {
        type: 'string',
        description: 'The ID of the message to edit',
      },
      content: {
        type: 'string',
        description: 'The new message content',
      },
    },
    required: ['channelId', 'messageId', 'content'],
  },
  handler: editMessage,
}
