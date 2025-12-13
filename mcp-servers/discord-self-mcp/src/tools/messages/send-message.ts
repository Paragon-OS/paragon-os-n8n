import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { Channel, TextChannel, Message } from 'discord.js-selfbot-v13'
import type { DiscordClient } from '../../types/discord.js'
import type { SendMessageArgs } from '../../types/tool-args.js'
import { createMCPResponse } from '../../utils/index.js'
import { prepareAttachments } from '../../utils/file-upload.js'
import type { ToolDefinition } from '../../server/tool-registry.js'

export async function sendMessage(
  client: DiscordClient,
  args: SendMessageArgs,
) {
  const { channelId, content, replyToMessageId, filePaths, maxFileSizeMB } = args

  try {
    // Prepare file attachments if provided
    let attachments: any[] = []
    let attachmentMetadata: Array<{ filename: string; size: number }> = []
    let warnings: Array<{ filename: string; filePath: string; error: string; reason: string }> = []
    
    if (filePaths && filePaths.length > 0) {
      const result = await prepareAttachments(filePaths, maxFileSizeMB)
      attachments = result.attachments.map(a => a.attachment)
      attachmentMetadata = result.attachments.map(a => ({
        filename: a.filename,
        size: a.size,
      }))
      warnings = result.warnings
    }

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
    let sentMessage: Message

    if (replyToMessageId) {
      const replyMessage = await textChannel.messages.fetch(replyToMessageId)
      if (!replyMessage) {
        throw new Error('Reply message not found')
      }

      sentMessage = await replyMessage.reply({
        content,
        files: attachments,
      })
    } else {
      sentMessage = await textChannel.send({
        content,
        files: attachments,
      })
    }

    const response: any = {
      success: true,
      messageId: sentMessage.id,
      channelId: channel.id, // Use the actual channel ID (might be different from input)
      content: content,
      timestamp: sentMessage.createdTimestamp,
      replyTo: replyToMessageId || null,
      attachmentCount: attachmentMetadata.length,
    }

    // Add attachments metadata if any were attached
    if (attachmentMetadata.length > 0) {
      response.attachments = attachmentMetadata
    }

    // Add warnings if any files failed validation
    if (warnings.length > 0) {
      response.warnings = warnings
      response.warningCount = warnings.length
    }

    return createMCPResponse(response)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to send message: ${errorMsg}`,
    )
  }
}

export const sendMessageTool: ToolDefinition = {
  name: 'discord_send_message',
  description: 'Send a message to a specific Discord channel or user. Can accept either a channel ID or user ID (will create DM channel automatically). Supports file attachments.',
  inputSchema: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'The Discord channel ID or user ID to send the message to',
      },
      content: {
        type: 'string',
        description: 'The message content to send',
      },
      replyToMessageId: {
        type: 'string',
        description: 'Optional: Message ID to reply to',
      },
      filePaths: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'Optional: Array of local file paths to attach (max 10 files)',
      },
      maxFileSizeMB: {
        type: 'number',
        description: 'Optional: Maximum file size in MB (default: 10MB, Discord limit for non-Nitro users)',
      },
    },
    required: ['channelId', 'content'],
  },
  handler: sendMessage,
}
