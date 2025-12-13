import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { DiscordClient, UserData, ExtendedUser } from '../../types/discord.js'
import { createMCPResponse } from '../../utils/index.js'
import type { ToolDefinition } from '../../server/tool-registry.js'

export async function getUserInfo(client: DiscordClient) {
  try {
    if (!client.user) {
      throw new Error('Client user not available')
    }

    const user = client.user as ExtendedUser
    const userData: UserData = {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      tag: user.tag,
      bot: user.bot,
      verified: user.verified,
      createdAt: user.createdTimestamp,
    }

    return createMCPResponse({
      user: userData,
      status: client.user.presence?.status || 'unknown',
      guildCount: client.guilds.cache.size,
      channelCount: client.channels.cache.size,
    })
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to get user info: ${error}`,
    )
  }
}

export const getUserInfoTool: ToolDefinition = {
  name: 'discord_get_user_info',
  description: 'Get information about the logged-in user',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: getUserInfo,
}
