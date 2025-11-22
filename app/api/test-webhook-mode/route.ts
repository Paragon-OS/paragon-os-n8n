/**
 * Test endpoint to verify webhook mode is being read correctly from cookies
 * Access at: http://localhost:3000/api/test-webhook-mode
 */

import { NextResponse } from "next/server";
import { getWebhookModeFromCookieHeader } from "@/lib/webhook-mode";
import { getWorkflowWebhookUrl } from "@/lib/n8n-config";

export async function GET(req: Request) {
  const cookieHeader = req.headers.get("cookie");
  const webhookMode = getWebhookModeFromCookieHeader(cookieHeader);
  const webhookUrl = getWorkflowWebhookUrl("paragonOS", webhookMode);

  return NextResponse.json({
    cookieHeader,
    webhookMode,
    webhookUrl,
    timestamp: new Date().toISOString(),
  });
}

