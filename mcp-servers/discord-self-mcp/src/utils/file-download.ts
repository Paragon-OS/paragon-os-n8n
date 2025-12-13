import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'

export interface DownloadResult {
  success: boolean
  filename: string
  originalUrl: string
  downloadPath: string
  size: number
  error?: string
}

/**
 * Expand ~ to home directory
 */
function expandTilde(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(homedir(), filePath.slice(1))
  }
  return filePath
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
 * Generate a unique filename to avoid collisions
 */
function generateUniqueFilename(originalFilename: string, targetDir: string): string {
  const timestamp = Date.now()
  const ext = path.extname(originalFilename)
  const name = path.basename(originalFilename, ext)
  
  // Remove any invalid characters from filename
  const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  
  let uniqueFilename = `${sanitizedName}_${timestamp}${ext}`
  let fullPath = path.join(targetDir, uniqueFilename)
  
  // If file exists, add a counter
  if (fs.existsSync(fullPath)) {
    let counter = 1
    const baseWithoutExt = `${sanitizedName}_${timestamp}`
    do {
      uniqueFilename = `${baseWithoutExt}_${counter}${ext}`
      fullPath = path.join(targetDir, uniqueFilename)
      counter++
    } while (fs.existsSync(fullPath))
  }
  
  return uniqueFilename
}

/**
 * Ensure directory exists, create if it doesn't
 */
async function ensureDirectoryExists(dirPath: string): Promise<void> {
  const expandedPath = expandTilde(dirPath)
  try {
    await fs.promises.mkdir(expandedPath, { recursive: true })
  } catch (error) {
    throw new Error(`Failed to create download directory: ${error}`)
  }
}

/**
 * Check if URL is accessible and get file size
 */
async function getFileInfo(url: string, maxSizeBytes: number): Promise<{ size: number; contentLength: string | null }> {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const contentLength = response.headers.get('content-length')
    const size = contentLength ? parseInt(contentLength, 10) : 0
    
    if (maxSizeBytes > 0 && size > maxSizeBytes) {
      throw new Error(
        `File size (${formatFileSize(size)}) exceeds maximum allowed size (${formatFileSize(maxSizeBytes)})`
      )
    }
    
    return { size, contentLength }
  } catch (error) {
    throw new Error(`Failed to fetch file info: ${error}`)
  }
}

/**
 * Download a file from URL to local filesystem
 */
export async function downloadFile(
  url: string,
  downloadDir: string,
  maxFileSizeBytes: number = 50 * 1024 * 1024, // Default 50MB
  customFilename?: string
): Promise<DownloadResult> {
  const expandedDir = expandTilde(downloadDir)
  
  try {
    // Ensure download directory exists
    await ensureDirectoryExists(expandedDir)
    
    // Get file info and validate size
    const fileInfo = await getFileInfo(url, maxFileSizeBytes)
    
    // Get filename from URL or use custom filename
    const urlFilename = path.basename(new URL(url).pathname)
    const originalFilename = customFilename || urlFilename || 'downloaded_file'
    
    // Generate unique filename
    const filename = generateUniqueFilename(originalFilename, expandedDir)
    const downloadPath = path.join(expandedDir, filename)
    
    // Download the file
    const response = await fetch(url)
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    // Check content-length header if available
    const contentLength = response.headers.get('content-length')
    if (contentLength) {
      const size = parseInt(contentLength, 10)
      if (maxFileSizeBytes > 0 && size > maxFileSizeBytes) {
        throw new Error(
          `File size (${formatFileSize(size)}) exceeds maximum allowed size (${formatFileSize(maxFileSizeBytes)})`
        )
      }
    }
    
    // Read response as buffer
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    // Validate actual downloaded size
    if (maxFileSizeBytes > 0 && buffer.length > maxFileSizeBytes) {
      throw new Error(
        `Downloaded file size (${formatFileSize(buffer.length)}) exceeds maximum allowed size (${formatFileSize(maxFileSizeBytes)})`
      )
    }
    
    // Write file to disk
    await fs.promises.writeFile(downloadPath, buffer)
    
    return {
      success: true,
      filename,
      originalUrl: url,
      downloadPath,
      size: buffer.length,
    }
  } catch (error: any) {
    return {
      success: false,
      filename: customFilename || 'unknown',
      originalUrl: url,
      downloadPath: '',
      size: 0,
      error: error.message || String(error),
    }
  }
}

/**
 * Download multiple files
 */
export async function downloadFiles(
  urls: Array<{ url: string; filename?: string }>,
  downloadDir: string,
  maxFileSizeBytes: number = 50 * 1024 * 1024,
): Promise<DownloadResult[]> {
  const results = await Promise.all(
    urls.map(({ url, filename }) =>
      downloadFile(url, downloadDir, maxFileSizeBytes, filename)
    )
  )
  
  return results
}

/**
 * Convert MB to bytes
 */
export function mbToBytes(mb: number): number {
  return mb * 1024 * 1024
}

