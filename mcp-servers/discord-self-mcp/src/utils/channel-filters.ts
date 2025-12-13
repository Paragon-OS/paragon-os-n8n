import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Ensure database directory exists
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const DATABASE_DIR = path.join(PROJECT_ROOT, 'database')
const DATABASE_PATH = path.join(DATABASE_DIR, 'entity-filters.json')

// Ensure database directory exists
async function ensureDatabaseDir() {
  try {
    await fs.mkdir(DATABASE_DIR, { recursive: true })
  } catch (error) {
    // Directory might already exist, ignore error
  }
}

export interface GuildChannelFilters {
  whitelist: string[]
  blacklist: string[]
}

export interface ChannelFiltersDatabase {
  guildChannelFilters: Record<string, GuildChannelFilters>
  dmFilters: {
    whitelist: string[]
    blacklist: string[]
  }
  groupFilters: {
    whitelist: string[]
    blacklist: string[]
  }
  guildFilters: {
    whitelist: string[]
    blacklist: string[]
  }
  metadata: {
    version: string
    createdAt: string
    lastUpdated: string
  }
}

export class ChannelFiltersManager {
  private static instance: ChannelFiltersManager
  private cache: ChannelFiltersDatabase | null = null

  static getInstance(): ChannelFiltersManager {
    if (!ChannelFiltersManager.instance) {
      ChannelFiltersManager.instance = new ChannelFiltersManager()
    }
    return ChannelFiltersManager.instance
  }

  private async loadDatabase(): Promise<ChannelFiltersDatabase> {
    if (this.cache) {
      return this.cache
    }

    await ensureDatabaseDir()

    try {
      const data = await fs.readFile(DATABASE_PATH, 'utf-8')
      this.cache = JSON.parse(data)
      
      // Migration: ensure new fields exist
      if (!this.cache!.dmFilters) {
        this.cache!.dmFilters = { whitelist: [], blacklist: [] }
      }
      if (!this.cache!.groupFilters) {
        this.cache!.groupFilters = { whitelist: [], blacklist: [] }
      }
      if (!this.cache!.guildFilters) {
        this.cache!.guildFilters = { whitelist: [], blacklist: [] }
      }
      
      return this.cache!
    } catch (error) {
      // If file doesn't exist or is corrupted, create a new one
      const newDatabase: ChannelFiltersDatabase = {
        guildChannelFilters: {},
        dmFilters: {
          whitelist: [],
          blacklist: [],
        },
        groupFilters: {
          whitelist: [],
          blacklist: [],
        },
        guildFilters: {
          whitelist: [],
          blacklist: [],
        },
        metadata: {
          version: '1.0.0',
          createdAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        },
      }
      await this.saveDatabase(newDatabase)
      this.cache = newDatabase
      return newDatabase
    }
  }

  private async saveDatabase(database: ChannelFiltersDatabase): Promise<void> {
    database.metadata.lastUpdated = new Date().toISOString()
    await fs.writeFile(DATABASE_PATH, JSON.stringify(database, null, 2), 'utf-8')
    this.cache = database
  }

  async getGuildFilters(guildId: string): Promise<GuildChannelFilters> {
    const database = await this.loadDatabase()
    return database.guildChannelFilters[guildId] || { whitelist: [], blacklist: [] }
  }

  async updateGuildFilters(
    guildId: string,
    whitelist?: string[],
    blacklist?: string[]
  ): Promise<void> {
    const database = await this.loadDatabase()
    
    if (!database.guildChannelFilters[guildId]) {
      database.guildChannelFilters[guildId] = { whitelist: [], blacklist: [] }
    }

    if (whitelist !== undefined) {
      database.guildChannelFilters[guildId].whitelist = whitelist
    }
    if (blacklist !== undefined) {
      database.guildChannelFilters[guildId].blacklist = blacklist
    }

    await this.saveDatabase(database)
  }

  async addToWhitelist(guildId: string, channelIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    if (!database.guildChannelFilters[guildId]) {
      database.guildChannelFilters[guildId] = { whitelist: [], blacklist: [] }
    }

    const existingWhitelist = database.guildChannelFilters[guildId].whitelist
    const newWhitelist = [...new Set([...existingWhitelist, ...channelIds])]
    database.guildChannelFilters[guildId].whitelist = newWhitelist

    await this.saveDatabase(database)
  }

  async removeFromWhitelist(guildId: string, channelIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    if (!database.guildChannelFilters[guildId]) {
      return // Nothing to remove
    }

    const existingWhitelist = database.guildChannelFilters[guildId].whitelist
    const newWhitelist = existingWhitelist.filter(id => !channelIds.includes(id))
    database.guildChannelFilters[guildId].whitelist = newWhitelist

    await this.saveDatabase(database)
  }

  async addToBlacklist(guildId: string, channelIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    if (!database.guildChannelFilters[guildId]) {
      database.guildChannelFilters[guildId] = { whitelist: [], blacklist: [] }
    }

    const existingBlacklist = database.guildChannelFilters[guildId].blacklist
    const newBlacklist = [...new Set([...existingBlacklist, ...channelIds])]
    database.guildChannelFilters[guildId].blacklist = newBlacklist

    await this.saveDatabase(database)
  }

  async removeFromBlacklist(guildId: string, channelIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    if (!database.guildChannelFilters[guildId]) {
      return // Nothing to remove
    }

    const existingBlacklist = database.guildChannelFilters[guildId].blacklist
    const newBlacklist = existingBlacklist.filter(id => !channelIds.includes(id))
    database.guildChannelFilters[guildId].blacklist = newBlacklist

    await this.saveDatabase(database)
  }

  async clearGuildFilters(guildId: string): Promise<void> {
    const database = await this.loadDatabase()
    delete database.guildChannelFilters[guildId]
    await this.saveDatabase(database)
  }

  shouldIncludeChannel(guildId: string, channelId: string): boolean {
    const filters = this.cache?.guildChannelFilters[guildId]
    if (!filters) {
      return true // No filters, include all channels
    }

    // Blacklist always wins - if channel is blacklisted, exclude it
    if (filters.blacklist.includes(channelId)) {
      return false
    }

    // If there's a whitelist, only include whitelisted channels
    if (filters.whitelist.length > 0) {
      return filters.whitelist.includes(channelId)
    }

    // No whitelist, include all channels (except blacklisted ones, already handled above)
    return true
  }

  async shouldIncludeChannelAsync(guildId: string, channelId: string): Promise<boolean> {
    const filters = await this.getGuildFilters(guildId)

    // Blacklist always wins - if channel is blacklisted, exclude it
    if (filters.blacklist.includes(channelId)) {
      return false
    }

    // If there's a whitelist, only include whitelisted channels
    if (filters.whitelist.length > 0) {
      return filters.whitelist.includes(channelId)
    }

    // No whitelist, include all channels (except blacklisted ones, already handled above)
    return true
  }

  // DM Filter Methods
  async getDMFilters(): Promise<{ whitelist: string[]; blacklist: string[] }> {
    const database = await this.loadDatabase()
    return database.dmFilters
  }

  async updateDMFilters(whitelist?: string[], blacklist?: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    if (whitelist !== undefined) {
      database.dmFilters.whitelist = whitelist
    }
    if (blacklist !== undefined) {
      database.dmFilters.blacklist = blacklist
    }

    await this.saveDatabase(database)
  }

  async addToDMWhitelist(userIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    const existingWhitelist = database.dmFilters.whitelist
    const newWhitelist = [...new Set([...existingWhitelist, ...userIds])]
    database.dmFilters.whitelist = newWhitelist

    await this.saveDatabase(database)
  }

  async removeFromDMWhitelist(userIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    const existingWhitelist = database.dmFilters.whitelist
    const newWhitelist = existingWhitelist.filter(id => !userIds.includes(id))
    database.dmFilters.whitelist = newWhitelist

    await this.saveDatabase(database)
  }

  async addToDMBlacklist(userIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    const existingBlacklist = database.dmFilters.blacklist
    const newBlacklist = [...new Set([...existingBlacklist, ...userIds])]
    database.dmFilters.blacklist = newBlacklist

    await this.saveDatabase(database)
  }

  async removeFromDMBlacklist(userIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    const existingBlacklist = database.dmFilters.blacklist
    const newBlacklist = existingBlacklist.filter(id => !userIds.includes(id))
    database.dmFilters.blacklist = newBlacklist

    await this.saveDatabase(database)
  }

  async clearDMFilters(): Promise<void> {
    const database = await this.loadDatabase()
    database.dmFilters = { whitelist: [], blacklist: [] }
    await this.saveDatabase(database)
  }

  shouldIncludeDM(userId: string): boolean {
    const filters = this.cache?.dmFilters
    if (!filters) {
      return true // No filters, include all DMs
    }

    // Blacklist always wins - if user is blacklisted, exclude DM
    if (filters.blacklist.includes(userId)) {
      return false
    }

    // If there's a whitelist, only include whitelisted users
    if (filters.whitelist.length > 0) {
      return filters.whitelist.includes(userId)
    }

    // No whitelist, include all DMs (except blacklisted ones, already handled above)
    return true
  }

  async shouldIncludeDMAsync(userId: string): Promise<boolean> {
    const filters = await this.getDMFilters()

    // Blacklist always wins - if user is blacklisted, exclude DM
    if (filters.blacklist.includes(userId)) {
      return false
    }

    // If there's a whitelist, only include whitelisted users
    if (filters.whitelist.length > 0) {
      return filters.whitelist.includes(userId)
    }

    // No whitelist, include all DMs (except blacklisted ones, already handled above)
    return true
  }

  // Group Filter Methods
  async getGroupFilters(): Promise<{ whitelist: string[]; blacklist: string[] }> {
    const database = await this.loadDatabase()
    return database.groupFilters
  }

  async updateGroupFilters(whitelist?: string[], blacklist?: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    if (whitelist !== undefined) {
      database.groupFilters.whitelist = whitelist
    }
    if (blacklist !== undefined) {
      database.groupFilters.blacklist = blacklist
    }

    await this.saveDatabase(database)
  }

  async addToGroupWhitelist(channelIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    const existingWhitelist = database.groupFilters.whitelist
    const newWhitelist = [...new Set([...existingWhitelist, ...channelIds])]
    database.groupFilters.whitelist = newWhitelist

    await this.saveDatabase(database)
  }

  async removeFromGroupWhitelist(channelIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    const existingWhitelist = database.groupFilters.whitelist
    const newWhitelist = existingWhitelist.filter(id => !channelIds.includes(id))
    database.groupFilters.whitelist = newWhitelist

    await this.saveDatabase(database)
  }

  async addToGroupBlacklist(channelIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    const existingBlacklist = database.groupFilters.blacklist
    const newBlacklist = [...new Set([...existingBlacklist, ...channelIds])]
    database.groupFilters.blacklist = newBlacklist

    await this.saveDatabase(database)
  }

  async removeFromGroupBlacklist(channelIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    const existingBlacklist = database.groupFilters.blacklist
    const newBlacklist = existingBlacklist.filter(id => !channelIds.includes(id))
    database.groupFilters.blacklist = newBlacklist

    await this.saveDatabase(database)
  }

  async clearGroupFilters(): Promise<void> {
    const database = await this.loadDatabase()
    database.groupFilters = { whitelist: [], blacklist: [] }
    await this.saveDatabase(database)
  }

  shouldIncludeGroup(channelId: string): boolean {
    const filters = this.cache?.groupFilters
    if (!filters) {
      return true // No filters, include all groups
    }

    // Blacklist always wins - if group is blacklisted, exclude it
    if (filters.blacklist.includes(channelId)) {
      return false
    }

    // If there's a whitelist, only include whitelisted groups
    if (filters.whitelist.length > 0) {
      return filters.whitelist.includes(channelId)
    }

    // No whitelist, include all groups (except blacklisted ones, already handled above)
    return true
  }

  async shouldIncludeGroupAsync(channelId: string): Promise<boolean> {
    const filters = await this.getGroupFilters()

    // Blacklist always wins - if group is blacklisted, exclude it
    if (filters.blacklist.includes(channelId)) {
      return false
    }

    // If there's a whitelist, only include whitelisted groups
    if (filters.whitelist.length > 0) {
      return filters.whitelist.includes(channelId)
    }

    // No whitelist, include all groups (except blacklisted ones, already handled above)
    return true
  }

  // Guild Filter Methods
  async getGuildsFilters(): Promise<{ whitelist: string[]; blacklist: string[] }> {
    const database = await this.loadDatabase()
    return database.guildFilters
  }

  async updateGuildsFilters(whitelist?: string[], blacklist?: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    if (whitelist !== undefined) {
      database.guildFilters.whitelist = whitelist
    }
    if (blacklist !== undefined) {
      database.guildFilters.blacklist = blacklist
    }

    await this.saveDatabase(database)
  }

  async addToGuildsWhitelist(guildIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    const existingWhitelist = database.guildFilters.whitelist
    const newWhitelist = [...new Set([...existingWhitelist, ...guildIds])]
    database.guildFilters.whitelist = newWhitelist

    await this.saveDatabase(database)
  }

  async removeFromGuildsWhitelist(guildIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    const existingWhitelist = database.guildFilters.whitelist
    const newWhitelist = existingWhitelist.filter(id => !guildIds.includes(id))
    database.guildFilters.whitelist = newWhitelist

    await this.saveDatabase(database)
  }

  async addToGuildsBlacklist(guildIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    const existingBlacklist = database.guildFilters.blacklist
    const newBlacklist = [...new Set([...existingBlacklist, ...guildIds])]
    database.guildFilters.blacklist = newBlacklist

    await this.saveDatabase(database)
  }

  async removeFromGuildsBlacklist(guildIds: string[]): Promise<void> {
    const database = await this.loadDatabase()
    
    const existingBlacklist = database.guildFilters.blacklist
    const newBlacklist = existingBlacklist.filter(id => !guildIds.includes(id))
    database.guildFilters.blacklist = newBlacklist

    await this.saveDatabase(database)
  }

  async clearGuildsFilters(): Promise<void> {
    const database = await this.loadDatabase()
    database.guildFilters = { whitelist: [], blacklist: [] }
    await this.saveDatabase(database)
  }

  shouldIncludeGuild(guildId: string): boolean {
    const filters = this.cache?.guildFilters
    if (!filters) {
      return true // No filters, include all guilds
    }

    // Blacklist always wins - if guild is blacklisted, exclude it
    if (filters.blacklist.includes(guildId)) {
      return false
    }

    // If there's a whitelist, only include whitelisted guilds
    if (filters.whitelist.length > 0) {
      return filters.whitelist.includes(guildId)
    }

    // No whitelist, include all guilds (except blacklisted ones, already handled above)
    return true
  }

  async shouldIncludeGuildAsync(guildId: string): Promise<boolean> {
    const filters = await this.getGuildsFilters()

    // Blacklist always wins - if guild is blacklisted, exclude it
    if (filters.blacklist.includes(guildId)) {
      return false
    }

    // If there's a whitelist, only include whitelisted guilds
    if (filters.whitelist.length > 0) {
      return filters.whitelist.includes(guildId)
    }

    // No whitelist, include all guilds (except blacklisted ones, already handled above)
    return true
  }
}

export const channelFiltersManager = ChannelFiltersManager.getInstance()
