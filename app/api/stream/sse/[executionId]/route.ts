/**
 * SSE (Server-Sent Events) Endpoint
 * Allows clients to subscribe to real-time workflow execution updates
 */

import { streamingStore } from "@/lib/stores/streaming-store";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  const { executionId: paramExecutionId } = await params;
  const executionId = paramExecutionId || "default";

  console.log(`[sse] New SSE connection request for execution: ${executionId}`);

  // Create a ReadableStream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const connection = { encoder, controller };

      // Add connection to store
      streamingStore.addConnection(executionId, connection);

      // Send initial connection message
      const connectMsg = `data: ${JSON.stringify({
        type: "connected",
        executionId,
        timestamp: new Date().toISOString(),
      })}\n\n`;
      controller.enqueue(encoder.encode(connectMsg));

      // Send history of updates for this execution
      const history = streamingStore.getHistory(executionId);
      console.log(`[sse] Sending ${history.length} historical updates to client`);
      
      history.forEach((update) => {
        const data = `data: ${JSON.stringify(update)}\n\n`;
        controller.enqueue(encoder.encode(data));
      });

      // Also send history for 'default' if this is not already default
      if (executionId !== "default") {
        const defaultHistory = streamingStore.getHistory("default");
        console.log(`[sse] Sending ${defaultHistory.length} default historical updates to client`);
        
        defaultHistory.forEach((update) => {
          const data = `data: ${JSON.stringify(update)}\n\n`;
          controller.enqueue(encoder.encode(data));
        });
      }

      // Handle client disconnect
      request.signal.addEventListener("abort", () => {
        console.log(`[sse] Client disconnected from execution: ${executionId}`);
        streamingStore.removeConnection(executionId, connection);
      });

      // Keep-alive ping every 30 seconds
      const keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          console.log(`[sse] Keep-alive failed, connection likely closed`);
          clearInterval(keepAliveInterval);
          streamingStore.removeConnection(executionId, connection);
        }
      }, 30000);

      // Clean up interval on abort
      request.signal.addEventListener("abort", () => {
        clearInterval(keepAliveInterval);
      });
    },
  });

  // Return SSE response with proper headers
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}

