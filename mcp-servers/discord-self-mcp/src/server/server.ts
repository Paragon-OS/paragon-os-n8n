import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { DiscordMCPBase } from './discord-mcp-base.js'

// Re-export base for SSE server
export { DiscordMCPBase } from './discord-mcp-base.js'

export class DiscordMCPServer extends DiscordMCPBase {
  constructor() {
    DiscordMCPBase.validateToken()
    super()
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
