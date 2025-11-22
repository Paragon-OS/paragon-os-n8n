/**
 * Health Check Endpoint
 * Returns streaming server status and statistics
 */

import { streamingStore } from "@/lib/streaming-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const stats = streamingStore.getStats();

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    activeSSEConnections: stats.activeConnections,
    trackedExecutions: stats.trackedExecutions,
    executionIds: stats.executionIds,
  });
}

