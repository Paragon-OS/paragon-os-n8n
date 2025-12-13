import type { Client } from 'discord.js-selfbot-v13'

export interface DiscordClient extends Client {}

export interface MessageData {
  id: string
  author: {
    id: string
    username: string
    discriminator: string
  }
  content: string
  timestamp: number
  relativeTime: string
  attachments: AttachmentData[]
  embeds: EmbedData[]
  channelId?: string
  channelName?: string
}

export interface AttachmentData {
  name: string
  url: string
  size: number
}

export interface EmbedData {
  title?: string
  description?: string
  url?: string
  fields?: EmbedField[]
}

export interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface ChannelData {
  id: string
  name: string
  type: number | string
  typeDescription: string
  guildName?: string
  guildId?: string
  position?: number
}

export interface GuildData {
  id: string
  name: string
  memberCount: number
  owner: boolean
  joinedAt: number
  channels: Record<string, string>
}

export interface MemberData {
  id: string
  username: string
  discriminator: string
  tag: string
  displayName: string
  nickname?: string
  bot: boolean
  joinedAt: number
  joinedAtRelative: string
  roles?: RoleData[]
  status: string
}

export interface RoleData {
  id: string
  name: string
  color: string
  position: number
}

export interface UserData {
  id: string
  username: string
  discriminator: string
  tag: string
  bot: boolean
  verified?: boolean
  createdAt: number
}

export interface ExtendedUser {
  id: string
  username: string
  discriminator: string
  tag: string
  bot: boolean
  verified?: boolean
  createdTimestamp: number
}

export interface ExtendedChannel {
  id: string
  type: number | string
  name?: string
  position?: number
  guild?: {
    id: string
    name: string
  }
}

export interface DiscordAttachment {
  name: string
  url: string
  size: number
}

export interface ContactData {
  id: string
  username: string
  discriminator: string
  tag: string
  displayName: string
  bot: boolean
  avatar?: string
  status?: string
  lastMessageAt?: number
  lastMessageAtRelative?: string
  type: 'dm' | 'friend'
}

export interface FriendData {
  id: string
  username: string
  discriminator: string
  tag: string
  displayName: string
  bot: boolean
  avatar?: string
  status?: string
  relationshipType: 'friend' | 'blocked' | 'pending_incoming' | 'pending_outgoing'
}

export interface ContactSearchResult extends ContactData {
  matchType: 'exact' | 'substring' | 'fuzzy' | 'multi-criteria'
  matchScore?: number
  matchedField?: 'username' | 'displayName' | 'tag'
}

export interface MatchResult {
  matchType: 'exact' | 'substring' | 'fuzzy' | 'multi-criteria'
  score: number
  field: 'username' | 'displayName' | 'tag'
}
