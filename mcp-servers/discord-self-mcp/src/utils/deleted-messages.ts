import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Ensure database directory exists
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const DATABASE_DIR = path.join(PROJECT_ROOT, 'database')
const DATABASE_PATH = path.join(DATABASE_DIR, 'deleted-messages.json')

// Ensure database directory exists
async function ensureDatabaseDir() {
  try {
    await fs.mkdir(DATABASE_DIR, { recursive: true })
  } catch (error) {
    // Directory might already exist, ignore error
  }
}

export interface DeletedMessage {
  messageId: string
  channelId: string
  originalAuthor: {
    id: string
    username: string
    discriminator: string
    tag: string
  }
  deletedBy: string
  deletedAt: number
  reason: 'soft_delete' | 'hard_delete'
  originalContent?: string
  originalTimestamp?: number
}

export interface DeletedMessagesDatabase {
  deletedMessages: Record<string, DeletedMessage>
  metadata: {
    version: string
    createdAt: string
    lastUpdated: string
  }
}

export class DeletedMessagesManager {
  private static instance: DeletedMessagesManager
  private cache: DeletedMessagesDatabase | null = null

  static getInstance(): DeletedMessagesManager {
    if (!DeletedMessagesManager.instance) {
      DeletedMessagesManager.instance = new DeletedMessagesManager()
    }
    return DeletedMessagesManager.instance
  }

  private async loadDatabase(): Promise<DeletedMessagesDatabase> {
    if (this.cache) {
      return this.cache
    }

    await ensureDatabaseDir()

    try {
      const data = await fs.readFile(DATABASE_PATH, 'utf-8')
      this.cache = JSON.parse(data)
      return this.cache!
    } catch (error) {
      // If file doesn't exist or is corrupted, create a new one
      const newDatabase: DeletedMessagesDatabase = {
        deletedMessages: {},
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

  private async saveDatabase(database: DeletedMessagesDatabase): Promise<void> {
    database.metadata.lastUpdated = new Date().toISOString()
    await fs.writeFile(DATABASE_PATH, JSON.stringify(database, null, 2), 'utf-8')
    this.cache = database
  }

  async addDeletedMessage(message: DeletedMessage): Promise<void> {
    const database = await this.loadDatabase()
    database.deletedMessages[message.messageId] = message
    await this.saveDatabase(database)
  }

  async isMessageDeleted(messageId: string): Promise<boolean> {
    const database = await this.loadDatabase()
    return messageId in database.deletedMessages
  }

  async getDeletedMessage(messageId: string): Promise<DeletedMessage | null> {
    const database = await this.loadDatabase()
    return database.deletedMessages[messageId] || null
  }

  async removeDeletedMessage(messageId: string): Promise<void> {
    const database = await this.loadDatabase()
    delete database.deletedMessages[messageId]
    await this.saveDatabase(database)
  }

  async getAllDeletedMessages(): Promise<DeletedMessage[]> {
    const database = await this.loadDatabase()
    return Object.values(database.deletedMessages)
  }

  async getDeletedMessagesForChannel(channelId: string): Promise<DeletedMessage[]> {
    const database = await this.loadDatabase()
    return Object.values(database.deletedMessages).filter(
      msg => msg.channelId === channelId
    )
  }

  async clearDatabase(): Promise<void> {
    const database = await this.loadDatabase()
    database.deletedMessages = {}
    await this.saveDatabase(database)
  }
}

export const deletedMessagesManager = DeletedMessagesManager.getInstance()
