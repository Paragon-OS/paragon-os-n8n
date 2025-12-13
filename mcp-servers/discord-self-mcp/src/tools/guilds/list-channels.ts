import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { Guild } from 'discord.js-selfbot-v13'
import type { DiscordClient, ChannelData, ExtendedChannel } from '../../types/discord.js'
import type { ListChannelsArgs } from '../../types/tool-args.js'
import { getChannelTypeDescription, createSafeMCPResponse, channelFiltersManager } from '../../utils/index.js'
import type { ToolDefinition } from '../../server/tool-registry.js'

export async function listChannels(
  client: DiscordClient,
  args: ListChannelsArgs,
) {
  try {
    const { guildId, applyFilters = true, checkPermissions = true, limit = 50, offset = 0 } = args
    const maxLimit = Math.min(limit, 500) // Max 500 channels at once
    let channels: ChannelData[] = []

    if (guildId) {
      const guild = client.guilds.cache.get(guildId) as Guild
      if (!guild) {
        throw new Error('Guild not found')
      }

      channels = Array.from(guild.channels.cache.values())
        .map((channel) => {
          const extendedChannel = channel as ExtendedChannel
          return {
            id: extendedChannel.id,
            name: extendedChannel.name || 'Unknown',
            type: extendedChannel.type,
            typeDescription: getChannelTypeDescription(extendedChannel.type),
            guildName: guild.name,
            guildId: guild.id,
            position: extendedChannel.position || 0,
          }
        })
        .filter((channel) => channel.type === 'GUILD_TEXT')
        .sort((a, b) => a.position - b.position)

      // Check permissions if enabled
      if (checkPermissions) {
        channels = channels.filter(channel => {
          const discordChannel = guild.channels.cache.get(channel.id)
          if (!discordChannel) return false
          
          // Check if user has VIEW_CHANNEL permission
          const permissions = discordChannel.permissionsFor(client.user)
          return permissions?.has('VIEW_CHANNEL') ?? false
        })
      }

      // Apply channel filters if enabled
      if (applyFilters) {
        channels = channels.filter(channel => 
          channelFiltersManager.shouldIncludeChannel(guildId, channel.id)
        )
      }
    } else {
      channels = Array.from(client.channels.cache.values())
        .map((channel) => {
          const extendedChannel = channel as ExtendedChannel
          const guild = extendedChannel.guild
          return {
            id: extendedChannel.id,
            name: extendedChannel.name || 'DM',
            type: extendedChannel.type,
            typeDescription: getChannelTypeDescription(extendedChannel.type),
            guildName: guild?.name,
            guildId: guild?.id,
            position: extendedChannel.position || 0,
          }
        })
        .filter((channel) => {
          // For guild channels, only include GUILD_TEXT
          // For non-guild channels (DM, GROUP_DM), include all
          if (channel.guildId) {
            return channel.type === 'GUILD_TEXT'
          }
          return true
        })
        .sort((a, b) => a.position - b.position)

      // Check permissions if enabled (only for guild channels)
      if (checkPermissions) {
        channels = channels.filter(channel => {
          if (!channel.guildId) {
            return true // Include DMs
          }
          
          const guild = client.guilds.cache.get(channel.guildId)
          if (!guild) return false
          
          const discordChannel = guild.channels.cache.get(channel.id)
          if (!discordChannel) return false
          
          // Check if user has VIEW_CHANNEL permission
          const permissions = discordChannel.permissionsFor(client.user)
          return permissions?.has('VIEW_CHANNEL') ?? false
        })
      }

      // Apply channel filters if enabled (only for guild channels)
      if (applyFilters) {
        channels = channels.filter(channel => {
          if (!channel.guildId) {
            // For DM channels, check DM filters
            if (channel.type === 'DM') {
              const dmChannel = client.channels.cache.get(channel.id) as any
              if (dmChannel?.recipient?.id) {
                return channelFiltersManager.shouldIncludeDM(dmChannel.recipient.id)
              }
            }
            // For group DM channels, check group filters
            if (channel.type === 'GROUP_DM') {
              return channelFiltersManager.shouldIncludeGroup(channel.id)
            }
            return true // Include other non-guild channels
          }
          return channelFiltersManager.shouldIncludeChannel(channel.guildId, channel.id)
        })
      }
    }

    // Apply pagination
    const totalChannels = channels.length
    const paginatedChannels = channels.slice(offset, offset + maxLimit)
    const hasMore = offset + maxLimit < totalChannels

    return createSafeMCPResponse({
      totalChannels,
      showing: paginatedChannels.length,
      offset,
      limit: maxLimit,
      hasMore,
      guildFilter: guildId,
      applyFilters: applyFilters,
      checkPermissions: checkPermissions,
      channels: paginatedChannels,
    }, {
      truncateArrayKey: 'channels',
      defaultArrayKey: 'channels',
    })
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to list channels: ${error}`,
    )
  }
}

export const listChannelsTool: ToolDefinition = {
  name: 'discord_list_channels',
  description: 'List all accessible channels for the current user with pagination support',
  inputSchema: {
    type: 'object',
    properties: {
      guildId: {
        type: 'string',
        description: 'Optional: Filter channels by Discord server (guild) ID',
      },
      limit: {
        type: 'number',
        description: 'Number of channels to fetch per page (default: 50, max: 500)',
        default: 50,
      },
      offset: {
        type: 'number',
        description: 'Starting position for pagination (default: 0)',
        default: 0,
      },
      applyFilters: {
        type: 'boolean',
        description: 'Whether to apply channel whitelist/blacklist filters (default: true)',
        default: true,
      },
      checkPermissions: {
        type: 'boolean',
        description: 'Whether to filter channels based on user permissions (default: true)',
        default: true,
      },
    },
  },
  handler: listChannels,
}
