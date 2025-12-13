import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { DiscordClient, ContactData, ContactSearchResult } from '../../types/discord.js'
import type { SearchContactsArgs } from '../../types/tool-args.js'
import { createMCPResponse, searchContact } from '../../utils/index.js'
import { listContacts } from './list-contacts.js'
import type { ToolDefinition } from '../../server/tool-registry.js'

export async function searchContacts(
  client: DiscordClient,
  args: SearchContactsArgs,
) {
  const { query, limit = 20, includeMatchScore = false } = args

  if (!query || query.trim().length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Query parameter is required and cannot be empty',
    )
  }

  const maxLimit = Math.min(limit, 100)
  const trimmedQuery = query.trim()

  try {
    // Get all contacts using the existing listContacts logic
    const allContactsResult = await listContacts(client, {
      type: 'all',
      limit: 1000, // Get a large number to search through
    })

    // Extract contacts from the MCP response
    const responseData = JSON.parse(allContactsResult.content[0].text)
    const allContacts: ContactData[] = responseData.contacts || []

    // Apply fuzzy matching to filter contacts
    const searchResults: ContactSearchResult[] = []
    
    for (const contact of allContacts) {
      const searchResult = searchContact(contact, trimmedQuery)
      if (searchResult) {
        searchResults.push(searchResult)
      }
    }

    // Sort results by match score (descending)
    searchResults.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))

    // Limit results
    const limitedResults = searchResults.slice(0, maxLimit)

    // Remove match score if not requested
    const finalResults = includeMatchScore 
      ? limitedResults 
      : limitedResults.map(({ matchScore, ...contact }) => contact)

    return createMCPResponse({
      totalResults: searchResults.length,
      showing: finalResults.length,
      query: trimmedQuery,
      limit: maxLimit,
      includeMatchScore,
      contacts: finalResults,
    })
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to search contacts: ${error}`,
    )
  }
}

export const searchContactsTool: ToolDefinition = {
  name: 'discord_search_contacts',
  description: 'Search for specific Discord contacts by name with partial/fuzzy matching. Use this when looking for a particular person (e.g., "find John", "search for brian"). Supports typos and partial matches.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search term to match against usernames, display names, and tags',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 20, max: 100)',
        default: 20,
      },
      includeMatchScore: {
        type: 'boolean',
        description: 'Whether to include detailed match scoring information (default: false)',
        default: false,
      },
    },
    required: ['query'],
  },
  handler: searchContacts,
}
