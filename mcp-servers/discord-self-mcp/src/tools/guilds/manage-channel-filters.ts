import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { DiscordClient } from '../../types/discord.js'
import type { ListChannelFiltersArgs, UpdateChannelFiltersArgs } from '../../types/tool-args.js'
import { createMCPResponse } from '../../utils/index.js'
import { channelFiltersManager } from '../../utils/channel-filters.js'
import type { ToolDefinition } from '../../server/tool-registry.js'

export async function listChannelFilters(
  client: DiscordClient,
  args: ListChannelFiltersArgs,
) {
  try {
    const { type, guildId } = args
    
    if (type === 'guild') {
      if (!guildId) {
        throw new Error('guildId is required for type="guild"')
      }
      
      const filters = await channelFiltersManager.getGuildFilters(guildId)
      
      // Get guild name for better context
      const guild = client.guilds.cache.get(guildId)
      const guildName = guild?.name || 'Unknown Guild'

      return createMCPResponse({
        type: 'guild',
        guild: {
          id: guildId,
          name: guildName,
        },
        filters: {
          whitelist: filters.whitelist,
          blacklist: filters.blacklist,
          whitelistCount: filters.whitelist.length,
          blacklistCount: filters.blacklist.length,
        },
        filteringLogic: {
          description: filters.whitelist.length > 0 
            ? 'Only whitelisted channels are shown (except blacklisted ones)'
            : 'All channels are shown (except blacklisted ones)',
          hasWhitelist: filters.whitelist.length > 0,
          hasBlacklist: filters.blacklist.length > 0,
        },
      })
    } else if (type === 'dm') {
      const filters = await channelFiltersManager.getDMFilters()

      return createMCPResponse({
        type: 'dm',
        filters: {
          whitelist: filters.whitelist,
          blacklist: filters.blacklist,
          whitelistCount: filters.whitelist.length,
          blacklistCount: filters.blacklist.length,
        },
        filteringLogic: {
          description: filters.whitelist.length > 0 
            ? 'Only whitelisted users\' DMs are shown (except blacklisted ones)'
            : 'All DMs are shown (except blacklisted ones)',
          hasWhitelist: filters.whitelist.length > 0,
          hasBlacklist: filters.blacklist.length > 0,
        },
      })
    } else if (type === 'group') {
      const filters = await channelFiltersManager.getGroupFilters()

      return createMCPResponse({
        type: 'group',
        filters: {
          whitelist: filters.whitelist,
          blacklist: filters.blacklist,
          whitelistCount: filters.whitelist.length,
          blacklistCount: filters.blacklist.length,
        },
        filteringLogic: {
          description: filters.whitelist.length > 0 
            ? 'Only whitelisted group DMs are shown (except blacklisted ones)'
            : 'All group DMs are shown (except blacklisted ones)',
          hasWhitelist: filters.whitelist.length > 0,
          hasBlacklist: filters.blacklist.length > 0,
        },
      })
    } else if (type === 'guilds') {
      const filters = await channelFiltersManager.getGuildsFilters()

      return createMCPResponse({
        type: 'guilds',
        filters: {
          whitelist: filters.whitelist,
          blacklist: filters.blacklist,
          whitelistCount: filters.whitelist.length,
          blacklistCount: filters.blacklist.length,
        },
        filteringLogic: {
          description: filters.whitelist.length > 0 
            ? 'Only whitelisted guilds are shown (except blacklisted ones)'
            : 'All guilds are shown (except blacklisted ones)',
          hasWhitelist: filters.whitelist.length > 0,
          hasBlacklist: filters.blacklist.length > 0,
        },
      })
    } else {
      throw new Error(`Invalid type: ${type}`)
    }
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to list channel filters: ${error}`,
    )
  }
}

export async function updateChannelFilters(
  client: DiscordClient,
  args: UpdateChannelFiltersArgs,
) {
  try {
    const { type, guildId, operation, channelIds = [], userIds = [], guildIds = [] } = args

    let result: any = {}

    if (type === 'guild') {
      if (!guildId) {
        throw new Error('guildId is required for type="guild"')
      }

      // Validate guild exists
      const guild = client.guilds.cache.get(guildId)
      if (!guild) {
        throw new Error('Guild not found')
      }

      // Validate channelIds exist in the guild for add/set operations
      if (['add_whitelist', 'remove_whitelist', 'add_blacklist', 'remove_blacklist', 'set_whitelist', 'set_blacklist'].includes(operation)) {
        if (!channelIds || channelIds.length === 0) {
          throw new Error('channelIds is required for this operation')
        }

        // For add/set operations, validate channels exist
        if (operation.includes('add') || operation.includes('set')) {
          const guildChannels = Array.from(guild.channels.cache.keys())
          const invalidChannels = channelIds.filter(id => !guildChannels.includes(id))
          if (invalidChannels.length > 0) {
            throw new Error(`Invalid channel IDs: ${invalidChannels.join(', ')}`)
          }
        }
      }

      switch (operation) {
        case 'add_whitelist':
          await channelFiltersManager.addToWhitelist(guildId, channelIds)
          result.message = `Added ${channelIds.length} channel(s) to whitelist`
          break

        case 'remove_whitelist':
          await channelFiltersManager.removeFromWhitelist(guildId, channelIds)
          result.message = `Removed ${channelIds.length} channel(s) from whitelist`
          break

        case 'add_blacklist':
          await channelFiltersManager.addToBlacklist(guildId, channelIds)
          result.message = `Added ${channelIds.length} channel(s) to blacklist`
          break

        case 'remove_blacklist':
          await channelFiltersManager.removeFromBlacklist(guildId, channelIds)
          result.message = `Removed ${channelIds.length} channel(s) from blacklist`
          break

        case 'set_whitelist':
          await channelFiltersManager.updateGuildFilters(guildId, channelIds, undefined)
          result.message = `Set whitelist to ${channelIds.length} channel(s)`
          break

        case 'set_blacklist':
          await channelFiltersManager.updateGuildFilters(guildId, undefined, channelIds)
          result.message = `Set blacklist to ${channelIds.length} channel(s)`
          break

        case 'clear':
          await channelFiltersManager.clearGuildFilters(guildId)
          result.message = 'Cleared all channel filters'
          break

        default:
          throw new Error(`Invalid operation: ${operation}`)
      }

      // Get updated filters
      const updatedFilters = await channelFiltersManager.getGuildFilters(guildId)

      return createMCPResponse({
        type: 'guild',
        guild: {
          id: guildId,
          name: guild.name,
        },
        operation: {
          type: operation,
          channelIds: channelIds,
          message: result.message,
        },
        updatedFilters: {
          whitelist: updatedFilters.whitelist,
          blacklist: updatedFilters.blacklist,
          whitelistCount: updatedFilters.whitelist.length,
          blacklistCount: updatedFilters.blacklist.length,
        },
      })
    } else if (type === 'dm') {
      // Validate userIds for add/set operations
      if (['add_whitelist', 'remove_whitelist', 'add_blacklist', 'remove_blacklist', 'set_whitelist', 'set_blacklist'].includes(operation)) {
        if (!userIds || userIds.length === 0) {
          throw new Error('userIds is required for DM operations')
        }
      }

      switch (operation) {
        case 'add_whitelist':
          await channelFiltersManager.addToDMWhitelist(userIds)
          result.message = `Added ${userIds.length} user(s) to DM whitelist`
          break

        case 'remove_whitelist':
          await channelFiltersManager.removeFromDMWhitelist(userIds)
          result.message = `Removed ${userIds.length} user(s) from DM whitelist`
          break

        case 'add_blacklist':
          await channelFiltersManager.addToDMBlacklist(userIds)
          result.message = `Added ${userIds.length} user(s) to DM blacklist`
          break

        case 'remove_blacklist':
          await channelFiltersManager.removeFromDMBlacklist(userIds)
          result.message = `Removed ${userIds.length} user(s) from DM blacklist`
          break

        case 'set_whitelist':
          await channelFiltersManager.updateDMFilters(userIds, undefined)
          result.message = `Set DM whitelist to ${userIds.length} user(s)`
          break

        case 'set_blacklist':
          await channelFiltersManager.updateDMFilters(undefined, userIds)
          result.message = `Set DM blacklist to ${userIds.length} user(s)`
          break

        case 'clear':
          await channelFiltersManager.clearDMFilters()
          result.message = 'Cleared all DM filters'
          break

        default:
          throw new Error(`Invalid operation: ${operation}`)
      }

      // Get updated filters
      const updatedFilters = await channelFiltersManager.getDMFilters()

      return createMCPResponse({
        type: 'dm',
        operation: {
          type: operation,
          userIds: userIds,
          message: result.message,
        },
        updatedFilters: {
          whitelist: updatedFilters.whitelist,
          blacklist: updatedFilters.blacklist,
          whitelistCount: updatedFilters.whitelist.length,
          blacklistCount: updatedFilters.blacklist.length,
        },
      })
    } else if (type === 'group') {
      // Validate channelIds for add/set operations
      if (['add_whitelist', 'remove_whitelist', 'add_blacklist', 'remove_blacklist', 'set_whitelist', 'set_blacklist'].includes(operation)) {
        if (!channelIds || channelIds.length === 0) {
          throw new Error('channelIds is required for group operations')
        }
      }

      switch (operation) {
        case 'add_whitelist':
          await channelFiltersManager.addToGroupWhitelist(channelIds)
          result.message = `Added ${channelIds.length} group(s) to whitelist`
          break

        case 'remove_whitelist':
          await channelFiltersManager.removeFromGroupWhitelist(channelIds)
          result.message = `Removed ${channelIds.length} group(s) from whitelist`
          break

        case 'add_blacklist':
          await channelFiltersManager.addToGroupBlacklist(channelIds)
          result.message = `Added ${channelIds.length} group(s) to blacklist`
          break

        case 'remove_blacklist':
          await channelFiltersManager.removeFromGroupBlacklist(channelIds)
          result.message = `Removed ${channelIds.length} group(s) from blacklist`
          break

        case 'set_whitelist':
          await channelFiltersManager.updateGroupFilters(channelIds, undefined)
          result.message = `Set group whitelist to ${channelIds.length} group(s)`
          break

        case 'set_blacklist':
          await channelFiltersManager.updateGroupFilters(undefined, channelIds)
          result.message = `Set group blacklist to ${channelIds.length} group(s)`
          break

        case 'clear':
          await channelFiltersManager.clearGroupFilters()
          result.message = 'Cleared all group filters'
          break

        default:
          throw new Error(`Invalid operation: ${operation}`)
      }

      // Get updated filters
      const updatedFilters = await channelFiltersManager.getGroupFilters()

      return createMCPResponse({
        type: 'group',
        operation: {
          type: operation,
          channelIds: channelIds,
          message: result.message,
        },
        updatedFilters: {
          whitelist: updatedFilters.whitelist,
          blacklist: updatedFilters.blacklist,
          whitelistCount: updatedFilters.whitelist.length,
          blacklistCount: updatedFilters.blacklist.length,
        },
      })
    } else if (type === 'guilds') {
      // Validate guildIds for add/set operations
      if (['add_whitelist', 'remove_whitelist', 'add_blacklist', 'remove_blacklist', 'set_whitelist', 'set_blacklist'].includes(operation)) {
        if (!guildIds || guildIds.length === 0) {
          throw new Error('guildIds is required for guilds operations')
        }
      }

      // Validate guilds exist for add/set operations
      if (operation.includes('add') || operation.includes('set')) {
        const availableGuilds = Array.from(client.guilds.cache.keys())
        const invalidGuilds = guildIds.filter(id => !availableGuilds.includes(id))
        if (invalidGuilds.length > 0) {
          throw new Error(`Invalid guild IDs: ${invalidGuilds.join(', ')}`)
        }
      }

      switch (operation) {
        case 'add_whitelist':
          await channelFiltersManager.addToGuildsWhitelist(guildIds)
          result.message = `Added ${guildIds.length} guild(s) to whitelist`
          break

        case 'remove_whitelist':
          await channelFiltersManager.removeFromGuildsWhitelist(guildIds)
          result.message = `Removed ${guildIds.length} guild(s) from whitelist`
          break

        case 'add_blacklist':
          await channelFiltersManager.addToGuildsBlacklist(guildIds)
          result.message = `Added ${guildIds.length} guild(s) to blacklist`
          break

        case 'remove_blacklist':
          await channelFiltersManager.removeFromGuildsBlacklist(guildIds)
          result.message = `Removed ${guildIds.length} guild(s) from blacklist`
          break

        case 'set_whitelist':
          await channelFiltersManager.updateGuildsFilters(guildIds, undefined)
          result.message = `Set guilds whitelist to ${guildIds.length} guild(s)`
          break

        case 'set_blacklist':
          await channelFiltersManager.updateGuildsFilters(undefined, guildIds)
          result.message = `Set guilds blacklist to ${guildIds.length} guild(s)`
          break

        case 'clear':
          await channelFiltersManager.clearGuildsFilters()
          result.message = 'Cleared all guild filters'
          break

        default:
          throw new Error(`Invalid operation: ${operation}`)
      }

      // Get updated filters
      const updatedFilters = await channelFiltersManager.getGuildsFilters()

      return createMCPResponse({
        type: 'guilds',
        operation: {
          type: operation,
          guildIds: guildIds,
          message: result.message,
        },
        updatedFilters: {
          whitelist: updatedFilters.whitelist,
          blacklist: updatedFilters.blacklist,
          whitelistCount: updatedFilters.whitelist.length,
          blacklistCount: updatedFilters.blacklist.length,
        },
      })
    } else {
      throw new Error(`Invalid type: ${type}`)
    }
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to update channel filters: ${error}`,
    )
  }
}

export const listChannelFiltersTool: ToolDefinition = {
  name: 'discord_list_channel_filters',
  description: 'List whitelist and blacklist filters for Discord servers (guilds), Direct Messages (DMs), or group DMs. Use type="guild" for server channels, type="dm" for individual user DMs, type="group" for group DM channels, type="guilds" for filtering guilds themselves.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['guild', 'dm', 'group', 'guilds'],
        description: 'Type of filters to list: "guild" (Discord server channels), "dm" (Direct Messages with specific users), "group" (Group DM channels), or "guilds" (filtering guilds themselves)',
      },
      guildId: {
        type: 'string',
        description: 'The Discord server (guild) ID - REQUIRED only when type="guild"',
      },
    },
    required: ['type'],
  },
  handler: listChannelFilters,
}

export const updateChannelFiltersTool: ToolDefinition = {
  name: 'discord_update_channel_filters',
  description: 'Update whitelist and blacklist filters for Discord servers (guilds), Direct Messages (DMs), or group DMs. Use type="guild" for server channels, type="dm" for individual user DMs, type="group" for group DM channels, type="guilds" for filtering guilds themselves. Supports multi-item operations.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['guild', 'dm', 'group', 'guilds'],
        description: 'Type of filters to update: "guild" (Discord server channels), "dm" (Direct Messages with specific users), "group" (Group DM channels), or "guilds" (filtering guilds themselves)',
      },
      guildId: {
        type: 'string',
        description: 'The Discord server (guild) ID - REQUIRED only when type="guild"',
      },
      operation: {
        type: 'string',
        enum: ['add_whitelist', 'remove_whitelist', 'add_blacklist', 'remove_blacklist', 'set_whitelist', 'set_blacklist', 'clear'],
        description: 'The operation to perform: add_whitelist, remove_whitelist, add_blacklist, remove_blacklist, set_whitelist, set_blacklist, or clear',
      },
      channelIds: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'Array of channel IDs - USE for type="guild" (server channels) and type="group" (group DM channels). NOT used for type="dm" or type="guilds"',
      },
      userIds: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'Array of user IDs - USE ONLY for type="dm" (Direct Messages with specific users). NOT used for type="guild", type="group", or type="guilds"',
      },
      guildIds: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'Array of guild IDs - USE ONLY for type="guilds" (filtering guilds themselves). NOT used for type="guild", type="dm", or type="group"',
      },
    },
    required: ['type', 'operation'],
  },
  handler: updateChannelFilters,
}
