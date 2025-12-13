import type { DiscordClient } from '../types/discord.js'

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
  handler: (client: DiscordClient, args: Record<string, any>) => Promise<any>
}

export interface ToolRegistry {
  registerTool(tool: ToolDefinition): void
  getTool(name: string): ToolDefinition | undefined
  getAllTools(): ToolDefinition[]
  getToolSchemas(): Array<{ name: string; description: string; inputSchema: any }>
}

class ToolRegistryImpl implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool)
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  getToolSchemas(): Array<{ name: string; description: string; inputSchema: any }> {
    return this.getAllTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }
}

export const toolRegistry = new ToolRegistryImpl()
