/**
 * n8n Client Configuration
 * Handles environment variable configuration
 */

export const DEFAULT_TIMEOUT = 60000; // 60 seconds (increased for long-running workflows)
export const DEFAULT_POLL_INTERVAL = 500; // 500ms between polls
const DEFAULT_N8N_BASE_URL = "http://localhost:5678";
const DEFAULT_STREAMING_CONNECTION_TYPE = "sse";

/**
 * Get the n8n base URL from environment variables
 */
export function getN8nBaseUrl(): string {
  return process.env.N8N_BASE_URL || DEFAULT_N8N_BASE_URL;
}

/**
 * Get the webhook base URL from environment variables
 */
export function getWebhookBaseUrl(): string | null {
  return process.env.N8N_WEBHOOK_BASE_URL || null;
}

/**
 * Get polling interval from environment variables
 */
export function getPollInterval(): number {
  const interval = process.env.N8N_POLL_INTERVAL;
  return interval ? parseInt(interval, 10) : DEFAULT_POLL_INTERVAL;
}

/**
 * Check if we should wait for workflow completion
 */
export function shouldWaitForCompletion(): boolean {
  const wait = process.env.N8N_WAIT_FOR_COMPLETION;
  return wait === undefined || wait === "true" || wait === "1";
}

/**
 * Get n8n API key from environment variables
 */
export function getApiKey(): string | undefined {
  return process.env.N8N_API_KEY;
}

/**
 * Get streaming server base URL
 * Unified function for consistent URL construction across the application
 * 
 * Priority order:
 * 1. N8N_STREAMING_SERVER_URL env var (if set)
 * 2. NEXT_PUBLIC_APP_URL env var (if set)
 * 3. Request headers (host + protocol) if Request object provided
 * 4. window.location.origin (if in browser)
 * 5. localhost:3000 (fallback for development)
 * 
 * @param request - Optional Request object for server-side URL detection
 * @returns Base URL for streaming server (e.g., "http://localhost:3000/api/stream")
 */
export function getStreamingServerUrl(request?: Request): string {
  // Priority 1: Explicit streaming server URL
  if (process.env.N8N_STREAMING_SERVER_URL) {
    return process.env.N8N_STREAMING_SERVER_URL;
  }
  
  // Priority 2: Next.js public app URL
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return `${process.env.NEXT_PUBLIC_APP_URL}/api/stream`;
  }
  
  // Priority 3: Server-side with Request object - use headers
  if (request) {
    const host = request.headers.get("host");
    const protocol = request.headers.get("x-forwarded-proto") || "http";
    if (host) {
      return `${protocol}://${host}/api/stream`;
    }
  }
  
  // Priority 4: Client-side - use window.location
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/stream`;
  }
  
  // Priority 5: Fallback to localhost for development
  return "http://localhost:3000/api/stream";
}

/**
 * Get streaming update endpoint URL
 * Returns the full URL to the /api/stream/update endpoint
 * 
 * @param request - Optional Request object for server-side URL detection
 * @returns Full URL to update endpoint (e.g., "http://localhost:3000/api/stream/update")
 */
export function getStreamingUpdateUrl(request?: Request): string {
  const baseUrl = getStreamingServerUrl(request);
  // Ensure base URL doesn't already end with /update
  if (baseUrl.endsWith('/update')) {
    return baseUrl;
  }
  return `${baseUrl}/update`;
}

/**
 * Get streaming connection type preference from environment variables
 * Defaults to SSE (Server-Sent Events) which works with Next.js API routes
 */
export function getStreamingConnectionType(): "websocket" | "sse" {
  const type = process.env.N8N_STREAMING_CONNECTION_TYPE;
  return type === "websocket" ? "websocket" : DEFAULT_STREAMING_CONNECTION_TYPE;
}

