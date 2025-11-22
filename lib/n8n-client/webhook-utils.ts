/**
 * n8n Webhook Utilities
 * Helper functions for parsing webhook responses and URLs
 */

import { MAX_RECURSION_DEPTH } from "./constants";

// Constants
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXECUTION_ID_FIELDS = ["executionId", "execution_id", "id", "execution"];

// Simple logger utility
const logger = {
  info: (message: string, ...args: unknown[]) => {
    console.log(`[n8n-webhook-utils] ${message}`, ...args);
  },
};

/**
 * Check if a string looks like a UUID (execution IDs are usually UUIDs)
 */
function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Deep search for execution ID in nested objects/arrays
 */
function deepSearchExecutionId(obj: unknown, depth = 0): string | null {
  if (depth > MAX_RECURSION_DEPTH) return null; // Prevent infinite recursion
  if (!obj || typeof obj !== "object") return null;

  const objRecord = obj as Record<string, unknown>;

  // Check common execution ID field names
  for (const field of EXECUTION_ID_FIELDS) {
    if (typeof objRecord[field] === "string") {
      const value = objRecord[field] as string;
      if (isUuid(value)) {
        logger.info(`Found execution ID via deep search: ${field} = ${value}`);
        return value;
      }
    }
  }

  // Recursively search nested objects and arrays
  for (const key in objRecord) {
    const value = objRecord[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = deepSearchExecutionId(item, depth + 1);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = deepSearchExecutionId(value, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Extract execution ID from webhook response
 * n8n may return execution ID in different formats
 */
export function extractExecutionId(responseData: unknown): string | null {
  if (!responseData || typeof responseData !== "object") {
    return null;
  }

  const data = responseData as Record<string, unknown>;

  // Check for direct executionId field
  if (typeof data.executionId === "string") {
    logger.info(`Found executionId in root: ${data.executionId}`);
    return data.executionId;
  }

  // Check for id field
  if (typeof data.id === "string") {
    logger.info(`Found id in root: ${data.id}`);
    return data.id;
  }

  // Check nested in data object
  if (data.data && typeof data.data === "object") {
    const nestedData = data.data as Record<string, unknown>;
    if (typeof nestedData.executionId === "string") {
      logger.info(`Found executionId in nested data: ${nestedData.executionId}`);
      return nestedData.executionId;
    }
    if (typeof nestedData.id === "string") {
      logger.info(`Found id in nested data: ${nestedData.id}`);
      return nestedData.id;
    }
  }

  // Deep search for execution ID in nested objects/arrays
  const deepFound = deepSearchExecutionId(data);
  if (deepFound) {
    return deepFound;
  }

  logger.info("No execution ID found");
  return null;
}

/**
 * Check if webhook response indicates async execution
 */
export function isAsyncResponse(responseData: unknown): boolean {
  if (!responseData || typeof responseData !== "object") {
    return false;
  }

  const data = responseData as Record<string, unknown>;

  // Check for "Workflow was started" message
  if (
    typeof data.message === "string" &&
    data.message.toLowerCase().includes("workflow was started")
  ) {
    return true;
  }

  // Check if execution ID is present (indicates async)
  if (extractExecutionId(responseData)) {
    return true;
  }

  // Check for async indicators
  if (data.async === true || data.mode === "async") {
    return true;
  }

  return false;
}

/**
 * Extract workflow ID from webhook URL if possible
 * n8n webhook URLs often contain the workflow ID
 */
export function extractWorkflowIdFromUrl(webhookUrl: string): string | null {
  // Try to match UUID pattern in URL
  // n8n webhook URLs are typically: /webhook/{workflowId} or /webhook/{path}
  const uuidPattern =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = webhookUrl.match(uuidPattern);
  return match ? match[0] : null;
}

