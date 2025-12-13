import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { Guild } from 'discord.js-selfbot-v13'
import type { DiscordClient, GuildData } from '../../types/discord.js'
import { createMCPResponse, channelFiltersManager } from '../../utils/index.js'
import type { ToolDefinition } from '../../server/tool-registry.js'

export async function listGuilds(client: DiscordClient) {
  try {
    let guilds: GuildData[] = Array.from(client.guilds.cache.values())
      .map((guild: Guild) => {
        // Build channels object for this guild (only text channels)
        const channels: Record<string, string> = {}
        for (const channel of guild.channels.cache.values()) {
          // Only include text channels
          if (channel.type === 'GUILD_TEXT') {
            // Check if user has VIEW_CHANNEL permission
            const permissions = channel.permissionsFor(client.user)
            if (permissions?.has('VIEW_CHANNEL') ?? false) {
              const channelName = channel.name || 'Unknown'
              channels[channel.id] = channelName
            }
          }
        }

        return {
          id: guild.id,
          name: guild.name,
          memberCount: guild.memberCount,
          owner: guild.ownerId === client.user?.id,
          joinedAt: guild.joinedTimestamp || 0,
          channels: channels,
        }
      })

    // Apply guild filters
    const filteredGuilds: GuildData[] = []
    for (const guild of guilds) {
      if (await channelFiltersManager.shouldIncludeGuildAsync(guild.id)) {
        filteredGuilds.push(guild)
      }
    }
    guilds = filteredGuilds

    guilds.sort((a, b) => a.name.localeCompare(b.name))

    return createMCPResponse({
      totalGuilds: guilds.length,
      guilds: guilds,
    })
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to list guilds: ${error}`,
    )
  }
}

export const listGuildsTool: ToolDefinition = {
  name: 'discord_list_guilds',
  description: 'List all Discord servers (guilds) the user is in',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: listGuilds,
}
