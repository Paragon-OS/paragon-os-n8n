export interface ListChannelFiltersArgs {
  type: 'guild' | 'dm' | 'group' | 'guilds'
  guildId?: string // Required only for type='guild'
}

export interface UpdateChannelFiltersArgs {
  type: 'guild' | 'dm' | 'group' | 'guilds'
  guildId?: string // Required only for type='guild'
  operation: "add_whitelist" | "remove_whitelist" | "add_blacklist" | "remove_blacklist" | "set_whitelist" | "set_blacklist" | "clear"
  channelIds?: string[] // For guild and group types
  userIds?: string[] // For dm type
  guildIds?: string[] // For guilds type
}

export interface DeleteMessageArgs {
  channelId: string
  messageId: string
  force?: boolean
}

export interface ReadChannelArgs {
  channelId?: string
  userId?: string
  limit?: number
  before?: string
  after?: string
  beforeDate?: string
  afterDate?: string
  applyFilters?: boolean
}

export interface SearchMessagesArgs {
  channelId: string
  query?: string
  authorId?: string
  limit?: number
  before?: string
  after?: string
}

export interface SendMessageArgs {
  channelId: string
  content: string
  replyToMessageId?: string
  filePaths?: string[]
  maxFileSizeMB?: number
}

export interface EditMessageArgs {
  channelId: string
  messageId: string
  content: string
}

export interface ReplyMessageArgs {
  channelId: string
  messageId: string
  content: string
  filePaths?: string[]
  maxFileSizeMB?: number
}

export interface ListChannelsArgs {
  guildId?: string
  limit?: number
  offset?: number
  applyFilters?: boolean
  checkPermissions?: boolean
}

export interface ListGuildMembersArgs {
  guildId: string
  limit?: number
  includeRoles?: boolean
}

export interface FetchMessagesOptions {
  limit?: number
  before?: string
  after?: string
}

export interface FetchMembersOptions {
  limit?: number
}

export interface MessageReference {
  messageId?: string
  channelId?: string
  guildId?: string
  failIfNotExists?: boolean
}

export interface SendMessageOptions {
  content: string
  reply?: {
    messageReference: MessageReference
  }
}

export interface ListContactsArgs {
  limit?: number
  offset?: number
  type?: 'dm' | 'friend' | 'all'
  userIds?: string[]
  fetchFresh?: boolean
  applyFilters?: boolean
}

export interface SearchContactsArgs {
  query: string
  fetchFresh?: boolean
  limit?: number
  includeMatchScore?: boolean
}

export interface DownloadAttachmentsArgs {
  channelId: string
  messageId: string
  downloadPath?: string
  maxFileSizeMB?: number
}
