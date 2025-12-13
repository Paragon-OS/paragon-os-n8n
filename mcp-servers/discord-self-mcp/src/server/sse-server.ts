import express, { Request, Response } from 'express'
import cors from 'cors'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'

import { DiscordMCPBase } from './discord-mcp-base.js'

const PORT = parseInt(process.env.MCP_PORT || '8000', 10)
const HOST = process.env.MCP_HOST || '0.0.0.0'

export class DiscordMCPSSEServer extends DiscordMCPBase {
  private transports: Record<string, SSEServerTransport> = {}
  private app: express.Application

  constructor() {
    DiscordMCPBase.validateToken()
    super()
    this.app = express()
    this.setupMiddleware()
    this.setupRoutes()
  }

  private setupMiddleware() {
    this.app.use(cors())
    this.app.use(express.json())
  }

  private setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        discord_ready: this.isReady,
        sessions: Object.keys(this.transports).length,
      })
    })

    // SSE endpoint for establishing the stream
    this.app.get('/sse', async (req: Request, res: Response) => {
      console.error('Received GET request to /sse (establishing SSE stream)')

      try {
        // Create a new SSE transport for the client
        const transport = new SSEServerTransport('/messages', res)
        const sessionId = transport.sessionId

        // Store the transport by session ID
        this.transports[sessionId] = transport

        // Set up onclose handler to clean up transport when closed
        transport.onclose = () => {
          console.error(`SSE transport closed for session ${sessionId}`)
          delete this.transports[sessionId]
        }

        // Connect the transport to the MCP server
        await this.server.connect(transport)

        console.error(`Established SSE stream with session ID: ${sessionId}`)
      } catch (error) {
        console.error('Error establishing SSE stream:', error)
        if (!res.headersSent) {
          res.status(500).send('Error establishing SSE stream')
        }
      }
    })

    // Messages endpoint for receiving client JSON-RPC requests
    this.app.post('/messages', async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string

      if (!sessionId) {
        console.error('No session ID provided in request URL')
        res.status(400).send('Missing sessionId parameter')
        return
      }

      const transport = this.transports[sessionId]
      if (!transport) {
        console.error(`No active transport found for session ID: ${sessionId}`)
        res.status(404).send('Session not found')
        return
      }

      try {
        await transport.handlePostMessage(req, res, req.body)
      } catch (error) {
        console.error('Error handling request:', error)
        if (!res.headersSent) {
          res.status(500).send('Error handling request')
        }
      }
    })
  }

  async run() {
    // Wait for Discord to be ready before accepting connections
    console.error('Waiting for Discord client to be ready...')
    await this.waitForReady()
    console.error('Discord client ready, starting SSE server...')

    return new Promise<void>((resolve, reject) => {
      const httpServer = this.app.listen(PORT, HOST, () => {
        console.error(`Discord MCP SSE Server listening on http://${HOST}:${PORT}`)
        console.error(`SSE endpoint: http://${HOST}:${PORT}/sse`)
        console.error(`Messages endpoint: http://${HOST}:${PORT}/messages`)
        console.error(`Health check: http://${HOST}:${PORT}/health`)
        resolve()
      })

      httpServer.on('error', (error) => {
        console.error('Failed to start server:', error)
        reject(error)
      })

      // Handle server shutdown
      const gracefulShutdown = async (signal: string) => {
        console.error(`Received ${signal}, shutting down...`)

        // Close all active transports
        for (const sessionId in this.transports) {
          try {
            console.error(`Closing transport for session ${sessionId}`)
            await this.transports[sessionId].close()
            delete this.transports[sessionId]
          } catch (error) {
            console.error(`Error closing transport for session ${sessionId}:`, error)
          }
        }

        httpServer.close(() => {
          console.error('Server shutdown complete')
          process.exit(0)
        })
      }

      process.on('SIGINT', () => gracefulShutdown('SIGINT'))
      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
    })
  }
}
