/**
 * Message Validation and Normalization
 * Simple utilities for validating and normalizing chat messages
 * Enhanced with lodash for safer operations
 */

import { isNil, isEmpty, isString, isArray, compact } from "lodash";

/**
 * Validated message type
 */
export interface ValidatedMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content?: unknown[] | string;
  toolInvocations?: Array<{ id: string; [key: string]: unknown }>;
  toolCalls?: Array<{ id: string; [key: string]: unknown }>;
}

/**
 * Normalize a single message
 * Returns null if message is invalid
 * Enhanced with lodash for safer null/undefined handling
 */
export function normalizeMessage(
  msg: {
    id?: string;
    role?: string;
    content?: unknown;
    toolInvocations?: Array<{ id: string; [key: string]: unknown }>;
    toolCalls?: Array<{ id: string; [key: string]: unknown }>;
  },
  index: number,
  sessionId: string
): ValidatedMessage | null {
  // Skip invalid messages using lodash
  if (isNil(msg) || typeof msg !== "object") {
    return null;
  }

  // Generate ID if missing - ensure it's never undefined
  const id = msg.id || `msg-${sessionId}-${index}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // CRITICAL: Ensure ID is a valid string
  if (!id || typeof id !== "string" || id.trim() === "") {
    console.error(`[message-validation] Generated invalid ID for message at index ${index}`);
    return null;
  }

  // Validate role with lodash
  const role = msg.role;
  if (isNil(role) || !["user", "assistant", "system", "tool"].includes(role)) {
    return null;
  }

  // Normalize content with lodash utilities
  let content: unknown[] | string | undefined = msg.content as unknown[] | string | undefined;
  
  if (isString(content)) {
    // Convert string to array format
    content = [{ type: "text", text: content }];
  } else if (isArray(content)) {
    // Filter out nulls and normalize parts using lodash
    content = compact(
      content.map((part: unknown) => {
        if (isNil(part)) return null;
        if (isString(part)) {
          return { type: "text", text: part };
        }
        return part;
      })
    );
  }

  // Check if message has any valid data using lodash
  const hasContent = !isNil(content) && (!isArray(content) || !isEmpty(content));
  const hasToolInvocations = isArray(msg.toolInvocations) && !isEmpty(msg.toolInvocations);
  const hasToolCalls = isArray(msg.toolCalls) && !isEmpty(msg.toolCalls);

  if (!hasContent && !hasToolInvocations && !hasToolCalls) {
    return null;
  }

  // Build normalized message - ID is guaranteed to be defined
  const normalized: ValidatedMessage = {
    id,
    role: role as "user" | "assistant" | "system" | "tool",
  };

  if (hasContent) {
    normalized.content = content;
  }

  if (hasToolInvocations) {
    normalized.toolInvocations = msg.toolInvocations;
  }

  if (hasToolCalls) {
    normalized.toolCalls = msg.toolCalls;
  }

  return normalized;
}

/**
 * Normalize multiple messages
 * Uses lodash compact to safely filter out null results
 */
export function normalizeMessages(
  messages: Array<{
    id?: string;
    role?: string;
    content?: unknown;
    toolInvocations?: Array<{ id: string; [key: string]: unknown }>;
    toolCalls?: Array<{ id: string; [key: string]: unknown }>;
  }>,
  sessionId: string
): ValidatedMessage[] {
  // Use lodash compact to remove null/undefined values
  return compact(
    messages.map((msg, idx) => normalizeMessage(msg, idx, sessionId))
  );
}
