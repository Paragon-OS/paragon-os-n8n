/**
 * n8n Client Library
 * Main entry point for calling n8n workflows via webhooks or local API
 */

import type { N8nWorkflowCallOptions, N8nWorkflowResponse } from "./types";
import { DEFAULT_TIMEOUT } from "./config";
import { callWebhook } from "./webhook";
import { callLocalApi } from "./api";
import { getWebhookBaseUrl, getN8nBaseUrl } from "./config";
import { getStreamingClient, createStreamingClient } from "./streaming";
import { getWebhookPrefix, type WebhookMode } from "../webhook-mode";

/**
 * Main function to call an n8n workflow
 */
export async function callN8nWorkflow(
  options: N8nWorkflowCallOptions,
): Promise<N8nWorkflowResponse> {
  const {
    webhookUrl,
    workflowId,
    method = "POST",
    payload,
    timeout = DEFAULT_TIMEOUT,
    waitForCompletion,
    streaming,
  } = options;

  // Prefer webhook URL if provided
  if (webhookUrl) {
    return callWebhook(webhookUrl, method, payload, timeout, waitForCompletion, streaming);
  }

  // Fall back to local API if workflow ID is provided
  if (workflowId) {
    // Note: streaming not supported for local API calls
    if (streaming) {
      console.warn("[n8n-client] Streaming mode not supported for local API calls, ignoring streaming callbacks");
    }
    return callLocalApi(workflowId, method, payload, timeout);
  }

  return {
    success: false,
    error: "Either webhookUrl or workflowId must be provided",
  };
}

/**
 * Build a webhook URL from a webhook path
 * @param webhookPath - The path to append (e.g., "/paragon-os")
 * @param mode - The webhook mode: "test" uses /webhook-test, "production" uses /webhook
 */
export function buildWebhookUrl(webhookPath: string, mode: WebhookMode = "test"): string {
  const webhookBaseUrl = getWebhookBaseUrl();
  const prefix = getWebhookPrefix(mode);
  
  console.log(`[buildWebhookUrl] mode=${mode}, prefix=${prefix}, webhookBaseUrl=${webhookBaseUrl}`);
  
  if (webhookBaseUrl) {
    // If N8N_WEBHOOK_BASE_URL is set, check if it already includes a webhook prefix
    // If it ends with /webhook or /webhook-test, replace it with the mode-specific prefix
    let baseUrl = webhookBaseUrl;
    if (baseUrl.endsWith("/webhook") || baseUrl.endsWith("/webhook-test")) {
      // Remove the existing prefix
      baseUrl = baseUrl.replace(/\/webhook(-test)?$/, "");
      console.log(`[buildWebhookUrl] Stripped existing prefix, baseUrl=${baseUrl}`);
    }
    const finalUrl = `${baseUrl}${prefix}${webhookPath.startsWith("/") ? webhookPath : `/${webhookPath}`}`;
    console.log(`[buildWebhookUrl] Final URL (with N8N_WEBHOOK_BASE_URL): ${finalUrl}`);
    return finalUrl;
  }
  
  // Fallback to local n8n webhook URL with mode-specific prefix
  const baseUrl = getN8nBaseUrl();
  const finalUrl = `${baseUrl}${prefix}${webhookPath.startsWith("/") ? webhookPath : `/${webhookPath}`}`;
  console.log(`[buildWebhookUrl] Final URL (with N8N_BASE_URL): ${finalUrl}`);
  return finalUrl;
}

// Re-export types for convenience
export type { 
  N8nWorkflowCallOptions, 
  N8nWorkflowResponse,
  StreamUpdate,
  StreamingCallbacks,
} from "./types";

// Re-export streaming functionality
export { getStreamingClient, createStreamingClient };

