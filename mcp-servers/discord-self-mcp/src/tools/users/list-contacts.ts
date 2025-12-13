import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { User, DMChannel } from 'discord.js-selfbot-v13'
import type { DiscordClient, ContactData } from '../../types/discord.js'
import type { ListContactsArgs } from '../../types/tool-args.js'
import { getRelativeTime, createSafeMCPResponse, channelFiltersManager } from '../../utils/index.js'
import type { ToolDefinition } from '../../server/tool-registry.js'

/**
 * Check if an error is a message-not-found type error that should be handled silently.
 * Discord.js may throw errors with code 10008 (Unknown Message) or error messages
 * containing "Unknown Message", "message not found", etc.
 */
function isMessageNotFoundError(error: unknown): boolean {
  if (!error) return false
  
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorLower = errorMessage.toLowerCase()
  
  // Check for Discord API error code 10008 (Unknown Message)
  if ((error as any).code === 10008) return true
  
  // Check for common message-not-found error messages
  if (
    errorLower.includes('unknown message') ||
    errorLower.includes('message not found') ||
    errorLower.includes('message_id_not_found') ||
    errorLower.includes('cannot find message')
  ) {
    return true
  }
  
  return false
}

export async function listContacts(
  client: DiscordClient,
  args: ListContactsArgs,
) {
  const { limit = 20, offset = 0, type = 'all', userIds, applyFilters = true } = args
  const maxLimit = Math.min(limit, 200)

  try {
    const contacts: ContactData[] = []
    const errors: string[] = []

    // If userIds is provided, fetch specific contacts by ID
    if (userIds && userIds.length > 0) {
      const contactPromises = userIds.map(async (userId) => {
        try {
          // Try Discord.js cache first, fallback to fetch
          const cachedUser = client.users.cache.get(userId)
          const user = cachedUser || await client.users.fetch(userId)

          if (!user) {
            throw new Error(`User ${userId} not found`)
          }

          // Check if user has a DM channel
          let lastMessageAt = 0
          let lastMessageAtRelative: string | undefined = undefined
          let contactType: 'dm' | 'friend' = 'friend' // Default to friend

          const dmChannel = Array.from(client.channels.cache.values())
            .find((channel) => 
              channel.type === 'DM' && 
              (channel as DMChannel).recipient.id === userId
            ) as DMChannel

          if (dmChannel) {
            contactType = 'dm'
            // Get last message timestamp only if lastMessageId exists
            // Skip fetching for DMs that don't have messages
            if (dmChannel.lastMessageId) {
              try {
                // First try to get from Discord.js cache (no network request)
                const cachedMessage = dmChannel.messages.cache.get(dmChannel.lastMessageId)
                if (cachedMessage) {
                  lastMessageAt = cachedMessage.createdTimestamp
                  lastMessageAtRelative = getRelativeTime(lastMessageAt)
                } else {
                  // Only fetch when explicitly needed (not in cache)
                  // Handle MESSAGE_ID_NOT_FOUND gracefully without logging errors
                  const lastMessage = await dmChannel.messages.fetch(dmChannel.lastMessageId)
                  if (lastMessage) {
                    lastMessageAt = lastMessage.createdTimestamp
                    lastMessageAtRelative = getRelativeTime(lastMessageAt)
                  }
                }
              } catch (error) {
                // Silently handle message-not-found errors (expected case)
                // Only log unexpected errors
                if (!isMessageNotFoundError(error)) {
                  console.error(`Failed to fetch last message for DM ${dmChannel.id}:`, error)
                }
                // For message-not-found errors, just use default value (0)
              }
            }
          }

          // Check if user is a friend
          try {
            const relationships = (client as any).relationships?.cache
            if (relationships) {
              const friendRelation = Array.from(relationships.values())
                .find((rel: any) => rel.user.id === userId && rel.type === 1)
              if (friendRelation) {
                contactType = 'friend'
              }
            }
          } catch (error) {
            // Relationships might not be available
          }

          return {
            id: user.id,
            username: user.username,
            discriminator: user.discriminator,
            tag: user.tag,
            displayName: user.displayName || user.username,
            bot: user.bot,
            avatar: user.displayAvatarURL(),
            status: 'offline', // Presence not available on User type
            lastMessageAt,
            lastMessageAtRelative,
            type: contactType,
          } as ContactData
        } catch (error) {
          errors.push(`Failed to fetch user ${userId}: ${error}`)
          return null
        }
      })

      const results = await Promise.all(contactPromises)
      const validContacts = results.filter((contact): contact is ContactData => contact !== null)
      
      // Apply DM filters if enabled
      let filteredContacts = validContacts
      if (applyFilters) {
        filteredContacts = validContacts.filter(contact => {
          if (contact.type === 'dm') {
            return channelFiltersManager.shouldIncludeDM(contact.id)
          }
          return true // Include friends and other types
        })
      }
      
      contacts.push(...filteredContacts)

      return createSafeMCPResponse({
        totalContacts: filteredContacts.length,
        showing: filteredContacts.length,
        userIds: userIds,
        applyFilters,
        errors: errors.length > 0 ? errors : undefined,
        contacts: filteredContacts,
      })
    }

    // Original pagination logic when userIds is not provided
    // Get DM channels
    if (type === 'all' || type === 'dm') {
      const allChannels = Array.from(client.channels.cache.values())
      const dmChannelsFromCache = allChannels.filter((channel) => channel.type === 'DM')
      
      const dmChannels = await Promise.all(
        dmChannelsFromCache
          .map(async (channel) => {
            const dmChannel = channel as DMChannel
            const recipient = dmChannel.recipient
            
            let lastMessageAt = 0
            let lastMessageAtRelative: string | undefined = undefined
            
            // Skip fetching last messages for DMs that don't have messages
            // Only fetch when explicitly needed (lastMessageId exists and not in cache)
            if (dmChannel.lastMessageId) {
              try {
                // First try to get from Discord.js cache (no network request)
                const cachedMessage = dmChannel.messages.cache.get(dmChannel.lastMessageId)
                if (cachedMessage) {
                  lastMessageAt = cachedMessage.createdTimestamp
                  lastMessageAtRelative = getRelativeTime(lastMessageAt)
                } else {
                  // Only fetch when explicitly needed (not in cache)
                  // Handle MESSAGE_ID_NOT_FOUND gracefully without logging errors
                  const lastMessage = await dmChannel.messages.fetch(dmChannel.lastMessageId)
                  if (lastMessage) {
                    lastMessageAt = lastMessage.createdTimestamp
                    lastMessageAtRelative = getRelativeTime(lastMessageAt)
                  }
                }
              } catch (error) {
                // Silently handle message-not-found errors (expected case)
                // Only log unexpected errors
                if (!isMessageNotFoundError(error)) {
                  console.error(`Failed to fetch last message for DM ${dmChannel.id}:`, error)
                }
                // For message-not-found errors, just use default value (0)
              }
            }
            
            return {
              id: recipient.id,
              username: recipient.username,
              discriminator: recipient.discriminator,
              tag: recipient.tag,
              displayName: recipient.displayName || recipient.username,
              bot: recipient.bot,
              avatar: recipient.displayAvatarURL(),
              status: 'offline', // Presence not available on User type
              lastMessageAt,
              lastMessageAtRelative,
              type: 'dm' as const,
            }
          })
      )
      
      // Sort by last message timestamp (most recent first)
      dmChannels.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
      contacts.push(...dmChannels)
    }

    // Get friends (if relationships are available)
    if (type === 'all' || type === 'friend') {
      try {
        // Try to access relationships if available in the client
        const relationships = (client as any).relationships?.cache
        if (relationships) {
          const friends = Array.from(relationships.values())
            .filter((rel: any) => rel.type === 1) // Friend relationship type
            .map((rel: any) => {
              const user = rel.user
              return {
                id: user.id,
                username: user.username,
                discriminator: user.discriminator,
                tag: user.tag,
                displayName: user.displayName || user.username,
                bot: user.bot,
                avatar: user.displayAvatarURL(),
                status: 'offline', // Presence not available on User type
                type: 'friend' as const,
              }
            })
            .sort((a, b) => a.displayName.localeCompare(b.displayName))

          contacts.push(...friends)
        }
      } catch (error) {
        // Friends/relationships might not be available in this version
      }
    }

    // Apply DM filters if enabled
    let filteredContacts = contacts
    if (applyFilters) {
      filteredContacts = contacts.filter(contact => {
        if (contact.type === 'dm') {
          return channelFiltersManager.shouldIncludeDM(contact.id)
        }
        return true // Include friends and other types
      })
    }

    // Apply pagination
    const totalContacts = filteredContacts.length
    const paginatedContacts = filteredContacts.slice(offset, offset + maxLimit)
    const hasMore = offset + maxLimit < totalContacts

    return createSafeMCPResponse({
      totalContacts,
      showing: paginatedContacts.length,
      offset,
      limit: maxLimit,
      hasMore,
      type,
      applyFilters,
      contacts: paginatedContacts,
    })
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to list contacts: ${error}`,
    )
  }
}

export const listContactsTool: ToolDefinition = {
  name: 'discord_list_contacts',
  description: 'List all Discord contacts (DMs and friends) with pagination. By default, applies DM whitelist/blacklist filters to only show allowed DM contacts. Use this to browse or retrieve complete contact lists. For searching by name, use search_contacts instead.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of contacts to fetch per page (default: 20, max: 200)',
        default: 20,
      },
      offset: {
        type: 'number',
        description: 'Starting position for pagination (default: 0)',
        default: 0,
      },
      type: {
        type: 'string',
        description: 'Filter contacts by type: "dm" for direct messages, "friend" for friends, "all" for both (default: "all")',
        enum: ['dm', 'friend', 'all'],
        default: 'all',
      },
      userIds: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: 'Optional: List of user IDs to fetch contact details for (bypasses pagination)',
      },
      applyFilters: {
        type: 'boolean',
        description: 'Whether to apply DM whitelist/blacklist filters (default: true)',
        default: true,
      },
    },
  },
  handler: listContacts,
}
