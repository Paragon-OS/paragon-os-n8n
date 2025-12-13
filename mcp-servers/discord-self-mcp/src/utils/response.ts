import type { MCPResponse } from '../types/mcp.js'

export function getChannelTypeDescription(type: number | string): string {
  const types: { [key: string]: string } = {
    '0': 'Text Channel',
    '1': 'DM',
    '2': 'Voice Channel',
    '3': 'Group DM',
    '4': 'Category',
    '5': 'News Channel',
    '10': 'News Thread',
    '11': 'Public Thread',
    '12': 'Private Thread',
    '13': 'Stage Voice',
    '15': 'Forum Channel',
    GUILD_TEXT: 'Text Channel',
    DM: 'DM',
    GUILD_VOICE: 'Voice Channel',
    GROUP_DM: 'Group DM',
    GUILD_CATEGORY: 'Category',
    GUILD_NEWS: 'News Channel',
    GUILD_NEWS_THREAD: 'News Thread',
    GUILD_PUBLIC_THREAD: 'Public Thread',
    GUILD_PRIVATE_THREAD: 'Private Thread',
    GUILD_STAGE_VOICE: 'Stage Voice',
    GUILD_FORUM: 'Forum Channel',
  }
  return types[String(type)] || `Unknown (${type})`
}

export function createMCPResponse(data: Record<string, any>): MCPResponse {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  }
}

export interface SafeResponseOptions {
  maxSizeBytes?: number
  truncateArrayKey?: string
  defaultArrayKey?: string
}

/**
 * Creates an MCP response with automatic size checking and truncation.
 * If the response exceeds maxSizeBytes, it will truncate arrays and add warning metadata.
 */
export function createSafeMCPResponse(
  data: Record<string, any>,
  options: SafeResponseOptions = {}
): MCPResponse {
  const {
    maxSizeBytes = 100 * 1024, // Default: 100KB
    truncateArrayKey = 'contacts',
    defaultArrayKey = 'contacts',
  } = options

  let jsonString = JSON.stringify(data, null, 2)
  const sizeBytes = Buffer.byteLength(jsonString, 'utf8')

  // If within limits, return as-is
  if (sizeBytes <= maxSizeBytes) {
    return createMCPResponse(data)
  }

  console.error(
    `[SAFE_RESPONSE] Response size (${(sizeBytes / 1024).toFixed(2)}KB) exceeds limit (${(maxSizeBytes / 1024).toFixed(2)}KB), truncating...`
  )

  // If size is too large, try to truncate the main array field
  const truncatableArray = data[truncateArrayKey] || data[defaultArrayKey]

  if (Array.isArray(truncatableArray) && truncatableArray.length > 0) {
    const originalCount = truncatableArray.length
    let truncatedData = { ...data }
    let truncatedArray = [...truncatableArray]
    let iterations = 0
    const maxIterations = 100

    // Binary search for the right size
    while (iterations < maxIterations) {
      truncatedData[truncateArrayKey] = truncatedArray
      jsonString = JSON.stringify(truncatedData, null, 2)
      const currentSize = Buffer.byteLength(jsonString, 'utf8')

      if (currentSize <= maxSizeBytes) {
        // Try adding one more item
        const nextIndex = truncatedArray.length
        if (nextIndex >= originalCount) {
          break
        }
        const testArray = [...truncatedArray, truncatableArray[nextIndex]]
        const testData = { ...truncatedData, [truncateArrayKey]: testArray }
        const testSize = Buffer.byteLength(JSON.stringify(testData, null, 2), 'utf8')

        if (testSize > maxSizeBytes) {
          break
        }
        truncatedArray = testArray
        truncatedData = testData
      } else {
        // Remove items until it fits
        const removeCount = Math.max(1, Math.floor(truncatedArray.length / 2))
        truncatedArray = truncatedArray.slice(0, -removeCount)
        truncatedData[truncateArrayKey] = truncatedArray
      }

      iterations++
    }

    // Add warning metadata
    truncatedData = {
      ...truncatedData,
      warning: 'Response truncated due to size limits',
      originalCount,
      returnedCount: truncatedArray.length,
      suggestion:
        'Use smaller limit parameter or pagination (offset) to retrieve remaining items',
      estimatedOriginalSizeKB: (sizeBytes / 1024).toFixed(2),
      finalSizeKB: (Buffer.byteLength(jsonString, 'utf8') / 1024).toFixed(2),
    }

    console.error(
      `[SAFE_RESPONSE] Truncated from ${originalCount} to ${truncatedArray.length} items`
    )

    return createMCPResponse(truncatedData)
  }

  // If we can't truncate, return a minimal error response
  console.error('[SAFE_RESPONSE] Unable to truncate response, returning error')
  return createMCPResponse({
    error: 'Response too large',
    message: 'The response exceeds size limits and cannot be automatically truncated',
    suggestion:
      'This tool may not be suitable for this request. Consider using more specific filters or pagination.',
    originalSizeKB: (sizeBytes / 1024).toFixed(2),
    maxSizeKB: (maxSizeBytes / 1024).toFixed(2),
  })
}
