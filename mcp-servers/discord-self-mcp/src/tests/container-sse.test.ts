import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { exec, execSync, spawn } from 'child_process'
import http from 'http'

const CONTAINER_NAME = 'discord-mcp-test'
const CONTAINER_PORT = 8002
const IMAGE_NAME = 'discord-self-mcp:latest'

// Get Discord token from environment or n8n-agent .env
function getDiscordToken(): string {
  if (process.env.DISCORD_TOKEN) {
    return process.env.DISCORD_TOKEN
  }

  // Try to read from n8n-agent .env
  try {
    const envPath = '/Users/nipuna/Software/paragon-os/paragon-os-app/n8n-agent/.env'
    const envContent = execSync(`cat "${envPath}" 2>/dev/null`).toString()
    const match = envContent.match(/DISCORD_MCP_ENV=\{[^}]*"DISCORD_TOKEN":"([^"]+)"/)
    if (match) {
      return match[1]
    }
  } catch {
    // Ignore errors
  }

  throw new Error('DISCORD_TOKEN not found in environment or n8n-agent .env')
}

async function waitForHealth(port: number, maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/health`)
      const data = await response.json() as { status: string; discord_ready: boolean }
      if (data.status === 'ok' && data.discord_ready) {
        return true
      }
    } catch {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return false
}

async function queryMcpTools(port: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for tools response'))
    }, 15000)

    const req = http.get(`http://localhost:${port}/sse`, (res) => {
      let sessionId: string | null = null
      const tools: string[] = []

      res.on('data', (chunk) => {
        const data = chunk.toString()
        const lines = data.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6)

            // Get session ID from endpoint event
            if (payload.includes('sessionId=') && !sessionId) {
              const url = new URL('http://localhost' + payload)
              sessionId = url.searchParams.get('sessionId')

              // Send tools/list request
              const toolsReq = http.request({
                host: 'localhost',
                port: port,
                path: `/messages?sessionId=${sessionId}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              })
              toolsReq.write(JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 1,
                params: {}
              }))
              toolsReq.end()
            }

            // Parse tools response
            if (payload.includes('"tools"')) {
              try {
                const parsed = JSON.parse(payload)
                if (parsed.result?.tools) {
                  clearTimeout(timeout)
                  req.destroy()
                  resolve(parsed.result.tools.map((t: { name: string }) => t.name))
                  return
                }
              } catch {
                // Not a valid JSON response yet
              }
            }
          }
        }
      })

      res.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    req.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

describe('Discord MCP Container SSE', () => {
  let containerStarted = false

  beforeAll(async () => {
    // Stop any existing test container
    try {
      execSync(`podman stop ${CONTAINER_NAME} 2>/dev/null`)
      execSync(`podman rm ${CONTAINER_NAME} 2>/dev/null`)
    } catch {
      // Container might not exist
    }

    // Get Discord token
    const discordToken = getDiscordToken()

    // Start the container
    console.log('Starting Discord MCP container...')
    execSync(
      `podman run -d --name ${CONTAINER_NAME} -p ${CONTAINER_PORT}:8000 ` +
      `-e DISCORD_TOKEN="${discordToken}" ${IMAGE_NAME}`,
      { stdio: 'pipe' }
    )
    containerStarted = true

    // Wait for health check
    console.log('Waiting for container to be ready...')
    const healthy = await waitForHealth(CONTAINER_PORT)
    if (!healthy) {
      const logs = execSync(`podman logs ${CONTAINER_NAME} 2>&1`).toString()
      throw new Error(`Container failed to become healthy. Logs:\n${logs}`)
    }
    console.log('Container is ready')
  }, 120000) // 2 minute timeout for container startup

  afterAll(async () => {
    if (containerStarted) {
      try {
        execSync(`podman stop ${CONTAINER_NAME} 2>/dev/null`)
        execSync(`podman rm ${CONTAINER_NAME} 2>/dev/null`)
      } catch {
        // Ignore cleanup errors
      }
    }
  })

  test('health endpoint returns ok', async () => {
    const response = await fetch(`http://localhost:${CONTAINER_PORT}/health`)
    const data = await response.json() as { status: string; discord_ready: boolean }

    expect(response.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.discord_ready).toBe(true)
  })

  test('SSE endpoint returns all 15 Discord tools', async () => {
    const tools = await queryMcpTools(CONTAINER_PORT)

    expect(tools.length).toBe(15)
    expect(tools).toContain('discord_read_channel')
    expect(tools).toContain('discord_search_messages')
    expect(tools).toContain('discord_send_message')
    expect(tools).toContain('discord_edit_message')
    expect(tools).toContain('discord_reply_message')
    expect(tools).toContain('discord_delete_message')
    expect(tools).toContain('discord_download_attachments')
    expect(tools).toContain('discord_list_guilds')
    expect(tools).toContain('discord_list_channels')
    expect(tools).toContain('discord_list_guild_members')
    expect(tools).toContain('discord_list_channel_filters')
    expect(tools).toContain('discord_update_channel_filters')
    expect(tools).toContain('discord_get_user_info')
    expect(tools).toContain('discord_list_contacts')
    expect(tools).toContain('discord_search_contacts')
  }, 30000)
})
