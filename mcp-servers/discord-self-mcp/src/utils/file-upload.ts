import * as fs from 'fs'
import * as path from 'path'
import { MessageAttachment } from 'discord.js-selfbot-v13'

export interface FileValidationResult {
  valid: boolean
  error?: string
  size: number
  filename: string
}

export interface FileUploadWarning {
  filename: string
  filePath: string
  error: string
  reason: 'size_exceeded' | 'not_found' | 'not_a_file' | 'validation_error'
}

export interface PrepareAttachmentsResult {
  attachments: Array<{ attachment: MessageAttachment; filename: string; size: number }>
  warnings: FileUploadWarning[]
  successCount: number
  failureCount: number
}

/**
 * Format file size in bytes to human-readable string
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

/**
 * Get validation error reason from error message
 */
function getValidationReason(error: string): 'size_exceeded' | 'not_found' | 'not_a_file' | 'validation_error' {
  if (error.includes('exceeds maximum') || error.includes('exceeds maximum allowed size')) {
    return 'size_exceeded'
  }
  if (error.includes('not found') || error.includes('File not found')) {
    return 'not_found'
  }
  if (error.includes('not a file') || error.includes('Path is not a file')) {
    return 'not_a_file'
  }
  return 'validation_error'
}

/**
 * Validate a file exists and check its size
 */
export async function validateFile(filePath: string, maxSizeBytes: number): Promise<FileValidationResult> {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        error: `File not found: ${filePath}`,
        size: 0,
        filename: path.basename(filePath),
      }
    }

    // Get file stats
    const stats = await fs.promises.stat(filePath)

    // Check if it's a file (not a directory)
    if (!stats.isFile()) {
      return {
        valid: false,
        error: `Path is not a file: ${filePath}`,
        size: stats.size,
        filename: path.basename(filePath),
      }
    }

    // Check file size
    if (maxSizeBytes > 0 && stats.size > maxSizeBytes) {
      return {
        valid: false,
        error: `File size (${formatFileSize(stats.size)}) exceeds maximum allowed size (${formatFileSize(maxSizeBytes)})`,
        size: stats.size,
        filename: path.basename(filePath),
      }
    }

    return {
      valid: true,
      size: stats.size,
      filename: path.basename(filePath),
    }
  } catch (error: any) {
    return {
      valid: false,
      error: `Failed to validate file: ${error.message || error}`,
      size: 0,
      filename: path.basename(filePath),
    }
  }
}

/**
 * Convert MB to bytes for upload size limits
 */
export function uploadMbToBytes(mb: number): number {
  return mb * 1024 * 1024
}

/**
 * Create a Discord MessageAttachment from a file path
 */
export function createAttachment(filePath: string, filename?: string): MessageAttachment {
  const finalFilename = filename || path.basename(filePath)
  return new MessageAttachment(filePath, finalFilename)
}

/**
 * Validate and prepare file attachments for Discord
 * Returns attachments with warnings for failed files (non-blocking)
 */
export async function prepareAttachments(
  filePaths: string[],
  maxFileSizeMB: number = 10, // Default 10MB (Discord's limit for non-Nitro users)
): Promise<PrepareAttachmentsResult> {
  const maxFileSizeBytes = uploadMbToBytes(maxFileSizeMB)
  const result: PrepareAttachmentsResult = {
    attachments: [],
    warnings: [],
    successCount: 0,
    failureCount: 0,
  }

  // Limit to 10 files (Discord's max attachments per message)
  const filesToProcess = filePaths.slice(0, 10)
  if (filePaths.length > 10) {
    result.warnings.push({
      filename: 'file_limit_exceeded',
      filePath: '',
      error: `Too many files provided (${filePaths.length}). Only processing first 10 files.`,
      reason: 'validation_error',
    })
  }

  // Validate and create attachments for each file
  for (const filePath of filesToProcess) {
    const validation = await validateFile(filePath, maxFileSizeBytes)
    
    if (!validation.valid) {
      // Create warning instead of throwing error
      result.warnings.push({
        filename: validation.filename,
        filePath: filePath,
        error: validation.error || 'Unknown validation error',
        reason: getValidationReason(validation.error || ''),
      })
      result.failureCount++
    } else {
      // File is valid, add to attachments
      result.attachments.push({
        attachment: createAttachment(filePath),
        filename: validation.filename,
        size: validation.size,
      })
      result.successCount++
    }
  }

  return result
}

