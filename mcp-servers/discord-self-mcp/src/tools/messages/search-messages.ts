import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { Channel, TextChannel, Message } from 'discord.js-selfbot-v13'
import type { DiscordClient, MessageData } from '../../types/discord.js'
import type { SearchMessagesArgs, FetchMessagesOptions } from '../../types/tool-args.js'
import { getRelativeTime, createMCPResponse, deletedMessagesManager } from '../../utils/index.js'
import type { ToolDefinition } from '../../server/tool-registry.js'

export async function searchMessages(
  client: DiscordClient,
  args: SearchMessagesArgs,
) {
  const { channelId, query, authorId, limit = 100, before, after } = args
  const maxLimit = Math.min(limit, 500)

  try {
    const channel = (await client.channels.fetch(channelId)) as Channel

    if (!channel || !channel.isText()) {
      throw new Error('Channel not found or not a text channel')
    }

    const textChannel = channel as TextChannel
    const fetchOptions: FetchMessagesOptions = { limit: maxLimit }
    if (before) fetchOptions.before = before
    if (after) fetchOptions.after = after

    let messages = await textChannel.messages.fetch(fetchOptions)

    // Filter out soft-deleted messages
    const filteredMessages = await Promise.all(
      Array.from(messages.values()).map(async (msg: Message) => {
        const isDeleted = await deletedMessagesManager.isMessageDeleted(msg.id)
        return isDeleted ? null : msg
      })
    )

    let validMessages = filteredMessages.filter((msg): msg is Message => msg !== null)

    if (authorId) {
      validMessages = validMessages.filter((msg) => msg.author.id === authorId)
    }

    if (query) {
      validMessages = validMessages.filter((msg) =>
        msg.content.toLowerCase().includes(query.toLowerCase()),
      )
    }

    const messageData: MessageData[] = validMessages
      .map((msg: Message) => ({
        id: msg.id,
        author: {
          id: msg.author.id,
          username: msg.author.username,
          discriminator: msg.author.discriminator,
        },
        content: msg.content,
        timestamp: msg.createdTimestamp,
        relativeTime: getRelativeTime(msg.createdTimestamp),
        attachments: Array.from(msg.attachments.values()).map((att) => ({
          name: att.name || 'unknown',
          url: att.url,
          size: att.size,
        })),
        embeds: msg.embeds.map((embed) => ({
          title: embed.title || undefined,
          description: embed.description || undefined,
          url: embed.url || undefined,
          fields: embed.fields || [],
        })),
      }))
      .reverse()

    return createMCPResponse({
      channel: {
        id: channel.id,
        name: textChannel.name || 'DM',
        type: channel.type,
      },
      searchQuery: query,
      authorFilter: authorId,
      totalResults: messageData.length,
      messages: messageData,
    })
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to search messages: ${error}`,
    )
  }
}

export const searchMessagesTool: ToolDefinition = {
  name: 'discord_search_messages',
  description:
    'Search for messages in a Discord channel by content, author, or date range',
  inputSchema: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'The Discord channel ID to search messages in',
      },
      query: {
        type: 'string',
        description: 'Text to search for in message content',
      },
      authorId: {
        type: 'string',
        description: 'Optional: Filter by author ID',
      },
      limit: {
        type: 'number',
        description:
          'Number of messages to search through (default: 100, max: 500)',
        default: 100,
      },
      before: {
        type: 'string',
        description: 'Optional: Search messages before this message ID',
      },
      after: {
        type: 'string',
        description: 'Optional: Search messages after this message ID',
      },
    },
    required: ['channelId'],
  },
  handler: searchMessages,
}
