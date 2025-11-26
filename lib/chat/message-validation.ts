/**
 * Message Validation and Normalization
 * Simple utilities for validating and normalizing chat messages
 */

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
  // Skip invalid messages
  if (!msg || typeof msg !== "object") {
    return null;
  }

  // Generate ID if missing
  const id = msg.id || `msg-${sessionId}-${index}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Validate role
  const role = msg.role;
  if (!role || !["user", "assistant", "system", "tool"].includes(role)) {
    return null;
  }

  // Normalize content
  let content: unknown[] | string | undefined = msg.content as unknown[] | string | undefined;
  if (typeof content === "string") {
    // Convert string to array format
    content = [{ type: "text", text: content }];
  } else if (Array.isArray(content)) {
    // Filter out nulls and normalize parts
    content = content
      .filter((part: unknown) => part != null)
      .map((part: unknown) => {
        if (typeof part === "string") {
          return { type: "text", text: part };
        }
        return part;
      });
  }

  // Skip messages without content (unless they have tool invocations/calls)
  const hasContent = content && (Array.isArray(content) ? content.length > 0 : true);
  const hasToolInvocations = Array.isArray(msg.toolInvocations) && msg.toolInvocations.length > 0;
  const hasToolCalls = Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0;

  if (!hasContent && !hasToolInvocations && !hasToolCalls) {
    return null;
  }

  // Build normalized message
  const normalized: ValidatedMessage = {
    id,
    role: role as "user" | "assistant" | "system" | "tool",
  };

  if (content) {
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
  return messages
    .map((msg, idx) => normalizeMessage(msg, idx, sessionId))
    .filter((msg): msg is ValidatedMessage => msg !== null);
}
