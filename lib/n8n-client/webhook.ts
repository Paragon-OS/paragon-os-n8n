/**
 * n8n Webhook Client
 * Handles calling n8n workflows via webhooks
 */

import type { N8nWorkflowResponse, StreamingCallbacks } from "./types";
import { DEFAULT_TIMEOUT, shouldWaitForCompletion } from "./config";
import {
  extractExecutionId,
  isAsyncResponse,
  extractWorkflowIdFromUrl,
} from "./webhook-utils";
import {
  findExecutionViaApi,
  pollExecutionStatus,
} from "./execution";
import { getStreamingClient } from "./streaming";
import { SYNC_RESPONSE_THRESHOLD_MS } from "./constants";

// Simple logger utility
const logger = {
  info: (message: string, ...args: unknown[]) => {
    console.log(`[n8n-webhook] ${message}`, ...args);
  },
  error: (message: string, error?: unknown) => {
    console.error(`[n8n-webhook] ${message}`, error);
  },
};

/**
 * Handle async response when execution ID could not be found
 */
function handleAsyncResponseWithoutExecution(
  data: unknown,
  workflowId: string | null,
  webhookResponseTime: number,
): N8nWorkflowResponse {
  logger.info("Could not find execution ID");
  logger.info(`Webhook response time was: ${webhookResponseTime}ms`);

  const hasApiKey = !!process.env.N8N_API_KEY;

  // If the webhook took a long time to respond, it might have completed synchronously
  const dataObj = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const looksLikeResult =
    dataObj &&
    !dataObj.message?.toString().includes("Workflow was started") &&
    Object.keys(dataObj).length > 1;

  if (looksLikeResult || webhookResponseTime > SYNC_RESPONSE_THRESHOLD_MS) {
    logger.info("Response appears to be synchronous completion, returning data");
    return {
      success: true,
      data,
      ...(workflowId && { workflowId }),
    };
  }

  // Could not find execution ID, return the async response with helpful info
  const note = hasApiKey
    ? "Workflow started asynchronously. Execution ID could not be determined."
    : "Workflow started asynchronously. Execution ID not available (set N8N_API_KEY to track executions).";

  return {
    success: true,
    data: {
      ...dataObj,
      note,
    },
    ...(workflowId && { workflowId }),
  };
}

/**
 * Call an n8n workflow via webhook URL
 */
export async function callWebhook(
  webhookUrl: string,
  method: "GET" | "POST",
  payload?: Record<string, unknown>,
  timeout: number = DEFAULT_TIMEOUT,
  waitForCompletion?: boolean,
  streamingCallbacks?: StreamingCallbacks,
): Promise<N8nWorkflowResponse> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const options: RequestInit = {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (method === "POST" && payload) {
      options.body = JSON.stringify(payload);
    }

    logger.info(`Calling webhook: ${webhookUrl}, method: ${method}`);
    const webhookStartTime = Date.now();
    const response = await fetch(webhookUrl, options);
    const webhookResponseTime = Date.now() - webhookStartTime;
    logger.info(`Webhook response received after: ${webhookResponseTime}ms`);
    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.info(`Webhook response not OK: ${response.status} ${response.statusText}`);
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    // Check response headers for execution ID (some n8n versions include it here)
    const executionIdHeader =
      response.headers.get("x-n8n-execution-id") ||
      response.headers.get("execution-id");

    const data = await response.json().catch(() => {
      // Some webhooks might return non-JSON responses
      return { message: "Workflow executed successfully" };
    });

    // Extract execution ID and workflow ID early
    const executionIdFromData = extractExecutionId(data);
    const executionIdFromHeader = executionIdHeader;
    let executionId = executionIdFromHeader || executionIdFromData;
    const workflowId = extractWorkflowIdFromUrl(webhookUrl);

    // Handle streaming mode - return immediately with IDs and set up callbacks
    if (streamingCallbacks) {
      logger.info("🔴 Streaming mode enabled");
      logger.info(`Execution ID from header: ${executionIdFromHeader}`);
      logger.info(`Execution ID from data: ${executionIdFromData}`);
      logger.info(`Workflow ID: ${workflowId}`);
      
      // If no execution ID in response, try to find it via API lookup
      if (!executionId) {
        logger.info("⚠️ No execution ID found in response, attempting API lookup...");
        executionId = await findExecutionViaApi(workflowId, startTime);
      }

      if (executionId) {
        logger.info(`✅ Setting up streaming for execution: ${executionId}`);
        
        // Call onStart callback immediately
        if (streamingCallbacks.onStart) {
          try {
            logger.info(`🔔 Calling onStart callback with execution ID: ${executionId}`);
            streamingCallbacks.onStart(executionId, workflowId || undefined);
          } catch (error) {
            logger.error("❌ Error in onStart callback:", error);
          }
        }

        // Subscribe to streaming updates
        logger.info("📡 Subscribing to streaming client...");
        const streamingClient = getStreamingClient();
        streamingClient.subscribe(executionId, streamingCallbacks);

        // Return immediately with execution IDs
        logger.info("✅ Returning immediate response with execution IDs");
        return {
          success: true,
          executionId,
          ...(workflowId && { workflowId }),
          streaming: true,
          data: {
            message: "Workflow started, streaming updates enabled",
            executionId,
            workflowId,
          },
        };
      } else {
        // Could not find execution ID, call onError
        const errorMsg = "Could not determine execution ID for streaming";
        logger.error(`❌ ${errorMsg}`);
        logger.error("This may happen if:");
        logger.error("  1. N8N_API_KEY is not configured");
        logger.error("  2. n8n webhook doesn't return execution ID");
        logger.error("  3. Workflow hasn't started yet");
        
        if (streamingCallbacks.onError) {
          try {
            streamingCallbacks.onError(errorMsg);
          } catch (error) {
            logger.error("❌ Error in onError callback:", error);
          }
        }

        return {
          success: false,
          error: errorMsg,
          ...(workflowId && { workflowId }),
        };
      }
    }

    // Check if we should wait for completion and if response indicates async execution
    const shouldWait =
      waitForCompletion !== undefined
        ? waitForCompletion
        : shouldWaitForCompletion();

    logger.info(`Should wait for completion: ${shouldWait}`);
    logger.info(`Is async response: ${isAsyncResponse(data)}`);

    if (shouldWait && isAsyncResponse(data)) {
      logger.info(`Execution ID from header: ${executionIdFromHeader}`);
      logger.info(`Execution ID from data: ${executionIdFromData}`);
      logger.info(`Initial execution ID: ${executionId}`);

      // If no execution ID in response, try to find it by workflow ID (requires API key)
      if (!executionId) {
        logger.info("No execution ID found in response");
        logger.info(`Extracted workflow ID from URL: ${workflowId}`);

        executionId = await findExecutionViaApi(workflowId, startTime);
      }

      if (executionId) {
        logger.info(`Found execution ID, polling for completion: ${executionId}`);
        const remainingTimeout = timeout - (Date.now() - startTime);
        logger.info(`Remaining timeout: ${remainingTimeout}ms`);

        if (remainingTimeout > 0) {
          return await pollExecutionStatus(executionId, remainingTimeout, startTime);
        }

        logger.info("Insufficient time remaining");
        return {
          success: false,
          error: "Insufficient time remaining to wait for workflow completion",
          executionId,
        };
      }

      // Could not find execution ID
      return handleAsyncResponseWithoutExecution(data, workflowId, webhookResponseTime);
    }

    // Synchronous response or waiting disabled
    // Include execution ID if available from headers or response data
    logger.info(`Synchronous response - final execution ID: ${executionId}`);

    return {
      success: true,
      data,
      ...(executionId && { executionId }),
      ...(workflowId && { workflowId }),
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          success: false,
          error: "Request timeout - workflow took too long to respond",
        };
      }
      return {
        success: false,
        error: error.message,
      };
    }
    return {
      success: false,
      error: "Unknown error occurred",
    };
  }
}

