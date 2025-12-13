import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { Channel, TextChannel, Message, DMChannel } from 'discord.js-selfbot-v13'
import type { DiscordClient, MessageData } from '../../types/discord.js'
import type { ReadChannelArgs, FetchMessagesOptions } from '../../types/tool-args.js'
import { getRelativeTime, createMCPResponse, deletedMessagesManager, channelFiltersManager } from '../../utils/index.js'
import type { ToolDefinition } from '../../server/tool-registry.js'

// Discord epoch: January 1, 2015 UTC
const DISCORD_EPOCH = 1420070400000

/**
 * Convert a date to Discord snowflake format
 * Discord snowflakes contain timestamp information
 */
function dateToSnowflake(date: Date): string {
  const timestamp = date.getTime()
  const snowflake = (timestamp - DISCORD_EPOCH) << 22
  return snowflake.toString()
}

/**
 * Parse ISO date string and convert to snowflake
 */
function parseDateToSnowflake(dateString: string): string {
  const date = new Date(dateString)
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateString}. Use ISO format (e.g., "2023-12-01T10:00:00Z")`)
  }
  return dateToSnowflake(date)
}

export async function readChannel(
  client: DiscordClient,
  args: ReadChannelArgs,
) {
  const { 
    channelId, 
    userId, 
    limit = 50, 
    before, 
    after, 
    beforeDate, 
    afterDate,
    applyFilters = false
  } = args
  const maxLimit = Math.min(limit, 100)

  try {
    // Input validation
    const providedIdentifiers = [channelId, userId].filter(Boolean)
    if (providedIdentifiers.length === 0) {
      throw new Error('Exactly one of channelId or userId must be provided')
    }
    if (providedIdentifiers.length > 1) {
      throw new Error('Only one of channelId or userId can be provided at a time')
    }

    // Validate pagination parameters
    const paginationParams = [before, after].filter(Boolean)
    if (paginationParams.length > 1) {
      throw new Error('Only one of before or after can be specified at a time')
    }

    let targetChannelId: string
    let resolvedFrom: any = undefined

    // Channel resolution logic (priority order)
    if (channelId) {
      targetChannelId = channelId
      resolvedFrom = { method: 'channelId', channelId }
    } else if (userId) {
      // Apply DM filters if enabled
      if (applyFilters) {
        const shouldInclude = await channelFiltersManager.shouldIncludeDMAsync(userId)
        if (!shouldInclude) {
          throw new Error('DM is filtered out by whitelist/blacklist settings')
        }
      }

      // Find DM channel for the user (existing functionality)
      const allChannels = Array.from(client.channels.cache.values())
      const dmChannel = allChannels.find((channel) => 
        channel.type === 'DM' && 
        (channel as DMChannel).recipient.id === userId
      ) as DMChannel

      if (!dmChannel) {
        throw new Error(`No DM channel found for user ${userId}`)
      }
      targetChannelId = dmChannel.id
      resolvedFrom = { method: 'userId', userId, channelId: targetChannelId }
    }

    const channel = (await client.channels.fetch(targetChannelId)) as Channel

    if (!channel || !channel.isText()) {
      throw new Error('Channel not found or not a text channel')
    }

    // Apply channel filters if enabled (only for guild channels)
    if (applyFilters && 'guild' in channel && channel.guild) {
      const shouldInclude = await channelFiltersManager.shouldIncludeChannelAsync(channel.guild.id, channel.id)
      if (!shouldInclude) {
        throw new Error('Channel is filtered out by whitelist/blacklist settings')
      }
    } else if (applyFilters && !('guild' in channel)) {
      // For DM channels, check DM filters
      if (channel.type === 'DM') {
        const dmChannel = channel as any
        if (dmChannel.recipient?.id) {
          const shouldInclude = await channelFiltersManager.shouldIncludeDMAsync(dmChannel.recipient.id)
          if (!shouldInclude) {
            throw new Error('DM is filtered out by whitelist/blacklist settings')
          }
        }
      }
      // For group DM channels, check group filters
      if (channel.type === 'GROUP_DM') {
        const shouldInclude = await channelFiltersManager.shouldIncludeGroupAsync(channel.id)
        if (!shouldInclude) {
          throw new Error('Group DM is filtered out by whitelist/blacklist settings')
        }
      }
    }

    const textChannel = channel as TextChannel

    // Build fetch options
    const fetchOptions: FetchMessagesOptions = { limit: maxLimit }

    // Handle message ID-based pagination
    if (before) {
      fetchOptions.before = before
    } else if (after) {
      fetchOptions.after = after
    }

    // Handle date-based pagination
    if (beforeDate) {
      try {
        fetchOptions.before = parseDateToSnowflake(beforeDate)
      } catch (error) {
        throw new Error(`Invalid beforeDate: ${error}`)
      }
    }
    if (afterDate) {
      try {
        fetchOptions.after = parseDateToSnowflake(afterDate)
      } catch (error) {
        throw new Error(`Invalid afterDate: ${error}`)
      }
    }

    const messages = await textChannel.messages.fetch(fetchOptions)

    // Filter out soft-deleted messages
    const filteredMessages = await Promise.all(
      Array.from(messages.values()).map(async (msg: Message) => {
        const isDeleted = await deletedMessagesManager.isMessageDeleted(msg.id)
        return isDeleted ? null : msg
      })
    )

    const validMessages = filteredMessages.filter((msg): msg is Message => msg !== null)

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

    // Determine pagination metadata
    const oldestMessage = validMessages[validMessages.length - 1]
    const newestMessage = validMessages[0]
    
    // Determine filtering type applied
    let filterType = 'none'
    if (before || beforeDate) filterType = 'before'
    else if (after || afterDate) filterType = 'after'

    return createMCPResponse({
      channel: {
        id: channel.id,
        name: textChannel.name || 'DM',
        type: channel.type,
      },
      messages: messageData,
      pagination: {
        filterType,
        limit: maxLimit,
        count: messageData.length,
        oldestMessageId: oldestMessage?.id,
        newestMessageId: newestMessage?.id,
        hasMore: messageData.length === maxLimit,
      },
      resolvedFrom: resolvedFrom,
    })
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to read channel: ${error}`,
    )
  }
}

export const readChannelTool: ToolDefinition = {
  name: 'discord_read_channel',
  description: 'Read messages from a Discord channel or direct message (DM) chat using IDs only. Provide either a channelId to read any channel, or a userId to read the DM channel with that user. Supports comprehensive pagination options.',
  inputSchema: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'The Discord channel ID to read messages from (alternative to userId).',
      },
      userId: {
        type: 'string',
        description: 'The Discord user ID to read DM chat history with (alternative to channelId). Use this to list direct messages with a specific user.',
      },
      limit: {
        type: 'number',
        description: 'Number of messages to fetch (default: 50, max: 100)',
        default: 50,
      },
      before: {
        type: 'string',
        description: 'Message ID to fetch messages before (for pagination)',
      },
      after: {
        type: 'string',
        description: 'Message ID to fetch messages after (for pagination)',
      },
      beforeDate: {
        type: 'string',
        description: 'ISO date string to fetch messages before (e.g., "2023-12-01T10:00:00Z")',
      },
      afterDate: {
        type: 'string',
        description: 'ISO date string to fetch messages after (e.g., "2023-12-01T10:00:00Z")',
      },
      applyFilters: {
        type: 'boolean',
        description: 'Whether to apply channel whitelist/blacklist filters (default: false)',
        default: false,
      },
    },
    required: [],
  },
  handler: readChannel,
}
