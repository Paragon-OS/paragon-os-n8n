import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { Guild, GuildMember } from 'discord.js-selfbot-v13'
import type { DiscordClient, MemberData } from '../../types/discord.js'
import type { ListGuildMembersArgs } from '../../types/tool-args.js'
import { getRelativeTime, createSafeMCPResponse } from '../../utils/index.js'
import type { ToolDefinition } from '../../server/tool-registry.js'

export async function listGuildMembers(
  client: DiscordClient,
  args: ListGuildMembersArgs,
) {
  const { guildId, limit = 50, includeRoles = false } = args
  const maxLimit = Math.min(limit, 1000)

  try {
    const guild = client.guilds.cache.get(guildId) as Guild
    if (!guild) {
      throw new Error('Guild not found')
    }

    const members = await guild.members.fetch({ limit: maxLimit })

    const memberData: MemberData[] = Array.from(members.values())
      .map((member: GuildMember) => {
        const memberInfo: MemberData = {
          id: member.user.id,
          username: member.user.username,
          discriminator: member.user.discriminator,
          tag: member.user.tag,
          displayName: member.displayName,
          nickname: member.nickname || undefined,
          bot: member.user.bot,
          joinedAt: member.joinedTimestamp || 0,
          joinedAtRelative: getRelativeTime(member.joinedTimestamp || 0),
          status: member.presence?.status || 'offline',
        }

        if (includeRoles) {
          memberInfo.roles = Array.from(member.roles.cache.values())
            .filter((role) => role.id !== guild.id)
            .map((role) => ({
              id: role.id,
              name: role.name,
              color: role.hexColor,
              position: role.position,
            }))
            .sort((a, b) => b.position - a.position)
        }

        return memberInfo
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName))

    return createSafeMCPResponse({
      guild: {
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
      },
      totalMembers: memberData.length,
      includeRoles: includeRoles,
      members: memberData,
    }, {
      truncateArrayKey: 'members',
      defaultArrayKey: 'members',
    })
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to list guild members: ${error}`,
    )
  }
}

export const listGuildMembersTool: ToolDefinition = {
  name: 'discord_list_guild_members',
  description: 'List members of a specific Discord server (guild)',
  inputSchema: {
    type: 'object',
    properties: {
      guildId: {
        type: 'string',
        description: 'The Discord server (guild) ID to list members from',
      },
      limit: {
        type: 'number',
        description: 'Number of members to fetch (default: 50, max: 1000)',
        default: 50,
      },
      includeRoles: {
        type: 'boolean',
        description: 'Whether to include role information for each member',
        default: false,
      },
    },
    required: ['guildId'],
  },
  handler: listGuildMembers,
}
