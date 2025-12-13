import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import type { Channel, TextChannel, Message } from 'discord.js-selfbot-v13'
import type { DiscordClient } from '../../types/discord.js'
import type { DownloadAttachmentsArgs } from '../../types/tool-args.js'
import { createMCPResponse } from '../../utils/response.js'
import { downloadFiles, mbToBytes, type DownloadResult } from '../../utils/file-download.js'
import type { ToolDefinition } from '../../server/tool-registry.js'
import * as path from 'path'

export async function downloadAttachments(
  client: DiscordClient,
  args: DownloadAttachmentsArgs,
) {
  const { channelId, messageId, downloadPath, maxFileSizeMB = 50 } = args

  try {
    // Validate inputs
    if (!channelId) {
      throw new Error('channelId is required')
    }
    if (!messageId) {
      throw new Error('messageId is required')
    }

    // Fetch the channel
    const channel = (await client.channels.fetch(channelId)) as Channel

    if (!channel || !channel.isText()) {
      throw new Error('Channel not found or not a text channel')
    }

    const textChannel = channel as TextChannel

    // Fetch the specific message
    const message = await textChannel.messages.fetch(messageId)

    if (!message) {
      throw new Error(`Message ${messageId} not found in channel ${channelId}`)
    }

    // Get all attachments from the message
    const attachments = Array.from(message.attachments.values())

    if (attachments.length === 0) {
      return createMCPResponse({
        success: false,
        message: 'No attachments found in this message',
        channelId,
        messageId,
        totalAttachments: 0,
        downloads: [],
      })
    }

    // Prepare download paths and URLs
    const defaultDownloadPath = downloadPath || '~/.discord-mcp-server/downloads'
    const maxFileSizeBytes = mbToBytes(maxFileSizeMB)

    // Create array of files to download
    const filesToDownload = attachments.map((attachment) => ({
      url: attachment.url,
      filename: attachment.name || undefined,
    }))

    // Download all attachments
    const downloadResults: DownloadResult[] = await downloadFiles(
      filesToDownload,
      defaultDownloadPath,
      maxFileSizeBytes,
    )

    // Format results
    const successfulDownloads = downloadResults.filter((r) => r.success)
    const failedDownloads = downloadResults.filter((r) => !r.success)

    return createMCPResponse({
      success: true,
      message: `Downloaded ${successfulDownloads.length} of ${attachments.length} attachments`,
      channelId,
      messageId,
      totalAttachments: attachments.length,
      successfulDownloads: successfulDownloads.length,
      failedDownloads: failedDownloads.length,
      maxFileSizeMB,
      downloadPath: path.resolve(
        downloadPath || '~/.discord-mcp-server/downloads',
      ),
      downloads: downloadResults.map((result) => ({
        success: result.success,
        filename: result.filename,
        originalUrl: result.originalUrl,
        downloadPath: result.downloadPath,
        size: result.size,
        error: result.error,
      })),
    })
  } catch (error: any) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to download attachments: ${error.message || error}`,
    )
  }
}

export const downloadAttachmentsTool: ToolDefinition = {
  name: 'discord_download_attachments',
  description:
    'Download all attachments (images, videos, files, etc.) from a specific Discord message to a local directory. Supports all attachment types.',
  inputSchema: {
    type: 'object',
    properties: {
      channelId: {
        type: 'string',
        description: 'The Discord channel ID containing the message',
      },
      messageId: {
        type: 'string',
        description: 'The Discord message ID with attachments to download',
      },
      downloadPath: {
        type: 'string',
        description:
          'Optional: Custom download directory path (default: ~/.discord-mcp-server/downloads/)',
      },
      maxFileSizeMB: {
        type: 'number',
        description:
          'Optional: Maximum file size in MB (default: 50MB). Files larger than this will be skipped.',
      },
    },
    required: ['channelId', 'messageId'],
  },
  handler: downloadAttachments,
}

