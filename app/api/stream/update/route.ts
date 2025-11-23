/**
 * Stream Update Endpoint
 * Receives updates from n8n workflows and broadcasts them to SSE clients
 */

import { streamingStore } from "@/lib/stores/streaming-store";
import { NextRequest, NextResponse } from "next/server";
import type { StreamUpdate } from "@/lib/n8n-client/types";
import { getN8nBaseUrl, getWebhookBaseUrl } from "@/lib/n8n-client/config";
import { saveStreamEventToSupabase } from "@/lib/supabase/supabase-stream-events";
import { updateChatMessage } from "@/lib/supabase/supabase-chat";

export const runtime = "nodejs";

/**
 * Get allowed CORS origins based on environment configuration
 * In production, restricts to specific origins. In development, allows localhost.
 */
function getAllowedOrigins(_request: NextRequest): string[] {
  const origins: string[] = [];
  
  // 1. Check for explicitly allowed origins from environment variable
  const allowedOriginsEnv = process.env.ALLOWED_CORS_ORIGINS;
  if (allowedOriginsEnv) {
    origins.push(...allowedOriginsEnv.split(",").map(origin => origin.trim()));
  }
  
  // 2. Add the app's own origin
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      const url = new URL(appUrl);
      origins.push(url.origin);
    } catch {
      // Invalid URL, skip
    }
  }
  
  // 3. Add n8n instance origin (where webhook requests come from)
  const n8nBaseUrl = getN8nBaseUrl();
  if (n8nBaseUrl) {
    try {
      const url = new URL(n8nBaseUrl);
      origins.push(url.origin);
    } catch {
      // Invalid URL, skip
    }
  }
  
  const webhookBaseUrl = getWebhookBaseUrl();
  if (webhookBaseUrl) {
    try {
      const url = new URL(webhookBaseUrl);
      origins.push(url.origin);
    } catch {
      // Invalid URL, skip
    }
  }
  
  // 4. In development, allow localhost origins
  if (process.env.NODE_ENV !== "production") {
    origins.push("http://localhost:3000", "http://localhost:5678", "http://127.0.0.1:3000", "http://127.0.0.1:5678");
  }
  
  // Remove duplicates
  return Array.from(new Set(origins));
}

/**
 * Check if the request origin is allowed
 */
function isOriginAllowed(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Same-origin requests don't have an Origin header
    return true;
  }
  
  const allowedOrigins = getAllowedOrigins(request);
  return allowedOrigins.includes(origin);
}

/**
 * Get CORS headers for the response
 */
function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  const allowedOrigins = getAllowedOrigins(request);
  
  // If origin is provided and allowed, use it. Otherwise, use first allowed origin or deny
  const allowOrigin = origin && allowedOrigins.includes(origin) 
    ? origin 
    : allowedOrigins.length > 0 
      ? allowedOrigins[0] 
      : "null";
  
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Execution-Id, X-N8N-Execution-Id",
    "Access-Control-Max-Age": "86400", // 24 hours
  };
}

export async function POST(request: NextRequest) {
  // Check CORS origin
  if (!isOriginAllowed(request)) {
    const origin = request.headers.get("origin");
    console.warn(`[update] CORS: Rejected request from origin: ${origin}`);
    return NextResponse.json(
      {
        success: false,
        error: "CORS: Origin not allowed",
      },
      {
        status: 403,
        headers: getCorsHeaders(request),
      }
    );
  }

  try {
    const body = await request.json();

    // Log the received body for debugging
    console.log("[update] Received request body:", JSON.stringify(body, null, 2));
    console.log("[update] Query params:", Object.fromEntries(request.nextUrl.searchParams));
    console.log("[update] Headers:", Object.fromEntries(request.headers.entries()));

    // Validate required fields - check for executionId in various possible locations
    // 1. Check request body first
    let executionId = body.executionId;
    
    // 2. If executionId is not at top level, check in data object
    if (executionId === undefined && body.data && body.data.executionId !== undefined) {
      executionId = body.data.executionId;
    }
    
    // 3. Check query parameters as fallback
    if (executionId === undefined) {
      const queryExecutionId = request.nextUrl.searchParams.get("executionId");
      if (queryExecutionId) {
        executionId = queryExecutionId;
      }
    }
    
    // 4. Check headers as fallback
    if (executionId === undefined) {
      const headerExecutionId = request.headers.get("x-execution-id") || 
                                 request.headers.get("execution-id") ||
                                 request.headers.get("x-n8n-execution-id");
      if (headerExecutionId) {
        executionId = headerExecutionId;
      }
    }
    
    // Convert to string if it's a number (n8n might send it as a number)
    // Note: 0 is a valid executionId, so we check for undefined/null specifically
    if (executionId !== undefined && executionId !== null) {
      executionId = String(executionId);
    }

    if (executionId === undefined || executionId === null || executionId === "") {
      console.error("[update] Missing executionId. Received body keys:", Object.keys(body).join(", "));
      console.error("[update] Full body:", JSON.stringify(body, null, 2));
      
      const receivedKeys = Object.keys(body);
      
      return NextResponse.json(
        { 
          success: false, 
          error: "executionId is required but was not found in the request.",
          problem: `Your HTTP Request node sent a body with only these fields: ${receivedKeys.join(", ") || "none"}. The executionId field is missing.`,
          solution: {
            step1: "In your n8n HTTP Request node (the one that POSTs to streamUrl), set 'Specify Body' to 'JSON'",
            step2: "Set 'JSON Body' to include executionId. Example:",
            example: {
              executionId: "{{ $execution.id }}",
              stage: "{{ $json.stage }}",
              status: "{{ $json.status }}",
              message: "{{ $json.message }}",
              timestamp: "{{ $now }}",
              data: "{{ $json.data }}"
            },
            note: "Make sure 'executionId' is included in the JSON body, not just timestamp."
          },
          receivedBody: body,
          queryParams: Object.fromEntries(request.nextUrl.searchParams),
          headers: {
            "x-execution-id": request.headers.get("x-execution-id"),
            "execution-id": request.headers.get("execution-id"),
            "x-n8n-execution-id": request.headers.get("x-n8n-execution-id"),
          }
        },
        { 
          status: 400,
          headers: getCorsHeaders(request),
        }
      );
    }

    // Extract metadata from request body
    // Support both metadata object (new format) and top-level (backward compatibility)
    const metadata = body.metadata || (body.sessionId || body.messageId || body.streamUrl ? {
      sessionId: body.sessionId,
      messageId: body.messageId,
      streamUrl: body.streamUrl,
    } : undefined);

    // Create update object
    const update: StreamUpdate = {
      executionId: executionId,
      metadata: metadata,
      stage: body.stage || "unknown",
      status: body.status || "info",
      message: body.message || "",
      timestamp: body.timestamp || new Date().toISOString(),
      data: body.data || {},
    };

    console.log(
      `[update] Received update for execution: ${update.executionId}, stage: ${update.stage}, status: ${update.status}`
    );
    console.log(`[update] Message: ${update.message}`);

    // Store update in history
    streamingStore.addUpdate(update);

    // Broadcast to all connected clients
    streamingStore.broadcast(update);

    // Save to Supabase (non-blocking, fire-and-forget)
    // Errors are handled within the function and won't affect the webhook response
    saveStreamEventToSupabase(update).catch((error) => {
      // This catch is a safety net, but saveStreamEventToSupabase already handles errors internally
      console.error("[update] Unexpected error in Supabase save:", error);
    });

    // Update assistant message if messageId is provided in metadata
    // This allows n8n workflow events to append event data to the assistant message record
    if (update.metadata?.messageId) {
      const messageId = update.metadata.messageId;
      const sessionId = update.metadata.sessionId;

      // Format event data to append to message content
      let eventText = `\n\n[${update.stage}] ${update.status}: ${update.message}`;
      if (update.data && Object.keys(update.data).length > 0) {
        const dataStr = JSON.stringify(update.data, null, 2);
        eventText += `\nData: ${dataStr}`;
      }

      // Append event data to the message content
      updateChatMessage({
        messageId: messageId,
        sessionId: sessionId,
        appendContent: eventText,
        metadata: {
          lastStreamEvent: {
            executionId: update.executionId,
            stage: update.stage,
            status: update.status,
            message: update.message,
            timestamp: update.timestamp,
            data: update.data,
          },
        },
      }).catch((error) => {
        // Log error but don't fail the webhook response
        console.error("[update] Error updating assistant message from stream event:", error, {
          messageId,
          executionId: update.executionId,
        });
      });
    }

    return NextResponse.json({
      success: true,
      message: "Update broadcasted",
      executionId: update.executionId,
    }, {
      headers: getCorsHeaders(request),
    });
  } catch (error) {
    console.error("[update] Error processing update:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { 
        status: 500,
        headers: getCorsHeaders(request),
      }
    );
  }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(request),
  });
}

