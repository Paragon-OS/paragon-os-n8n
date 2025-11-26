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
  console.log("[message-validation] Validating message:", JSON.stringify(msg));
  
  if (!msg || typeof msg !== "object") {
    console.log("[message-validation] Message is not an object, rejecting");
    return null;
  }

  const record = msg as Record<string, unknown>;

  // Validate required fields
  if (!record.id || typeof record.id !== "string") {
    console.log("[message-validation] Message missing valid id, rejecting");
    return null;
  }

  const role = record.role;
  if (!role || !["user", "assistant", "system", "tool"].includes(role as string)) {
    console.log(`[message-validation] Message has invalid role: ${role}, rejecting`);
    return null;
  }

  // Normalize content to array format
  // Check for 'parts' first (UIMessage format), then 'content'
  let content: unknown[] = [];
  if (Array.isArray(record.parts)) {
    console.log("[message-validation] Using 'parts' field");
    content = record.parts;
  } else if (typeof record.content === "string") {
    console.log("[message-validation] Converting string content to parts array");
    content = [{ type: "text", text: record.content }];
  } else if (Array.isArray(record.content)) {
    console.log("[message-validation] Using 'content' array");
    content = record.content;
  }

  console.log(`[message-validation] Content array length: ${content.length}`);

  // Check if message has any data
  const hasContent = content.length > 0;
  const hasTools = record.toolInvocations || record.toolCalls;

  if (!hasContent && !hasTools) {
    console.log("[message-validation] Message has no content or tools, rejecting");
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

  console.log("[message-validation] Message validated successfully:", JSON.stringify(validated));

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
