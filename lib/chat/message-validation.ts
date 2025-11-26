/**
 * Message Validation and Normalization
 * Single source of truth for message validation
 */

import type { UIMessage } from "ai";

/**
 * Validate and normalize a single message
 * Returns the message if valid, null otherwise
 */
export function validateMessage(msg: unknown): UIMessage | null {
  if (!msg || typeof msg !== "object") {
    return null;
  }

  const record = msg as Record<string, unknown>;

  // Validate required fields
  if (!record.id || typeof record.id !== "string") {
    return null;
  }

  const role = record.role;
  if (!role || !["user", "assistant", "system", "tool"].includes(role as string)) {
    return null;
  }

  // Normalize content to array format
  let content: unknown[] = [];
  if (typeof record.content === "string") {
    content = [{ type: "text", text: record.content }];
  } else if (Array.isArray(record.content)) {
    content = record.content;
  }

  // Check if message has any data
  const hasContent = content.length > 0;
  const hasTools = record.toolInvocations || record.toolCalls;

  if (!hasContent && !hasTools) {
    return null;
  }

  // Build validated message
  const validated: Record<string, unknown> = {
    id: record.id,
    role: record.role,
    content,
    parts: content, // UIMessage requires parts property
  };

  if (record.toolInvocations) {
    validated.toolInvocations = record.toolInvocations;
  }

  if (record.toolCalls) {
    validated.toolCalls = record.toolCalls;
  }

  return validated as unknown as UIMessage;
}

/**
 * Validate multiple messages
 */
export function validateMessages(messages: unknown[]): UIMessage[] {
  return messages
    .map(validateMessage)
    .filter((msg): msg is UIMessage => msg !== null);
}
