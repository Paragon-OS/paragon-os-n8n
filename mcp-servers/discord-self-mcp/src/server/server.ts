import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { Client } from 'discord.js-selfbot-v13'

import { toolRegistry } from './tool-registry.js'
import type { DiscordClient } from '../types/discord.js'

const DISCORD_TOKEN = process.env.DISCORD_TOKEN

if (!DISCORD_TOKEN) {
  console.error('Error: DISCORD_TOKEN not found in environment variables')
  console.error('Please configure DISCORD_TOKEN in your MCP client settings')
  console.error('Example configuration:')
  console.error(
    JSON.stringify(
      {
        mcpServers: {
          discord: {
            command: 'npx',
            args: ['-y', 'discord-self-mcp'],
            env: {
              DISCORD_TOKEN: 'your_discord_token_here',
            },
          },
        },
      },
      null,
      2,
    ),
  )
  process.exit(1)
}

function validateAndCastArgs<T>(
  args: Record<string, any> | null | undefined,
  expectedKeys: (keyof T)[],
): T {
  if (!args || typeof args !== 'object') {
    throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments provided')
  }

  const hasRequiredKeys = expectedKeys.some((key) => key in args)
  if (!hasRequiredKeys && expectedKeys.length > 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Missing required parameters: ${expectedKeys.join(', ')}`,
    )
  }

  return args as T
}

export class DiscordMCPServer {
  private server: Server
  private client: Client
  private isReady: boolean = false
  private readyPromise: Promise<void>

  constructor() {
    this.server = new Server(
      {
        name: 'discord-self-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    )

    this.client = new Client()
    this.readyPromise = this.connectDiscord()

    this.setupHandlers()
  }

  private async connectDiscord(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.once('ready', async () => {
        console.error(`Discord client ready as ${this.client.user?.tag}`)
        this.isReady = true
        resolve()
      })

      this.client.once('error', (error) => {
        console.error('Discord client error:', error)
        reject(error)
      })

      this.client.login(DISCORD_TOKEN).catch(reject)
    })
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolRegistry.getToolSchemas(),
    }))

    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
      if (!this.isReady) {
        try {
          await this.readyPromise
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Discord connection failed: ${error}`,
          )
        }
      }

      const tool = toolRegistry.getTool(request.params.name)
      if (!tool) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`,
        )
      }

      return await tool.handler(this.client, request.params.arguments || {})
    })
  }

  async run() {
    // Setup graceful shutdown handlers
    const gracefulShutdown = async (signal: string) => {
      console.error(`Received ${signal}, shutting down...`)
      process.exit(0)
    }

    process.on('SIGINT', () => gracefulShutdown('SIGINT'))
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

    const transport = new StdioServerTransport()
    await this.server.connect(transport)
  }
}
