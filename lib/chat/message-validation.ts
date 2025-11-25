/**
 * Message Validation and Normalization
 * Pure functions for validating and normalizing chat messages
 * Extracted from chat-session-loader for testability
 */

import type { UIMessage } from "ai";

/**
 * Validated message type - ensures all required fields are present
 */
export interface ValidatedMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content?: unknown[] | string | Record<string, unknown>;
  parts?: unknown[];
  toolInvocations?: Array<{ id: string; [key: string]: unknown }>;
  toolCalls?: Array<{ id: string; [key: string]: unknown }>;
}

/**
 * Normalized content type
 */
export type NormalizedContent = unknown[] | string | Record<string, unknown>;

/**
 * Options for validating messages
 */
export interface ValidateMessageOptions {
  sessionId?: string;
  index?: number;
  generateIdIfMissing?: boolean;
}

/**
 * Check if messages are already loaded in the thread
 * Compares message IDs to detect duplicates
 */
export function checkMessagesAlreadyLoaded(
  current: UIMessage[],
  incoming: UIMessage[]
): boolean {
  if (current.length !== incoming.length) {
    return false;
  }

  const currentIds = new Set(
    current.map((m) => m?.id).filter((id): id is string => Boolean(id))
  );
  const incomingIds = new Set(
    incoming.map((m) => m?.id).filter((id): id is string => Boolean(id))
  );

  return (
    incomingIds.size === currentIds.size &&
    Array.from(incomingIds).every((id) => currentIds.has(id))
  );
}

/**
 * Generate a fallback message ID
 */
function generateMessageId(
  sessionId: string,
  index: number,
  timestamp: number = Date.now()
): string {
  return `msg-${sessionId}-${index}-${timestamp}-${Math.random()
    .toString(36)
    .substr(2, 9)}`;
}

/**
 * Validate and normalize message content
 * Handles string, array, and object content types
 */
export function normalizeMessageContent(
  content: unknown,
  parts?: unknown
): NormalizedContent {
  // Prefer content over parts
  if (content !== undefined && content !== null && content !== "") {
    if (
      typeof content === "string" ||
      Array.isArray(content) ||
      (typeof content === "object" && content !== null)
    ) {
      return content as NormalizedContent;
    }
    return "";
  }

  // If no content, try to use parts
  if (parts !== undefined && parts !== null && parts !== "") {
    if (typeof parts === "string") {
      return parts;
    }
    if (Array.isArray(parts) && parts.length > 0) {
      const firstPart = parts[0];
      return typeof firstPart === "string" ? firstPart : JSON.stringify(parts);
    }
  }

  return "";
}

/**
 * Convert content to array format for AI SDK compatibility
 * Strings are converted to [{ type: "text", text: content }]
 */
export function convertContentToArray(
  content: unknown
): unknown[] | undefined {
  if (content === undefined || content === null || content === "") {
    return undefined;
  }

  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  if (Array.isArray(content)) {
    return content;
  }

  if (typeof content === "object" && content !== null) {
    return [content];
  }

  return undefined;
}

/**
 * Normalize parts array
 * Filters out null/undefined and ensures proper structure
 */
export function normalizeParts(
  parts: unknown,
  content?: unknown
): unknown[] | undefined {
  if (parts === undefined || parts === null || parts === "") {
    return undefined;
  }

  if (Array.isArray(parts)) {
    const validParts = parts.filter(
      (part) => part !== null && part !== undefined
    );
    // Only include if different from content
    if (
      validParts.length > 0 &&
      JSON.stringify(validParts) !== JSON.stringify(content)
    ) {
      return validParts;
    }
    return undefined;
  }

  if (typeof parts === "object" && parts !== null) {
    return [parts];
  }

  return undefined;
}

/**
 * Validate and normalize tool invocations
 * Ensures each invocation has a valid ID
 */
export function validateToolInvocations(
  toolInvocations: unknown
): Array<{ id: string; [key: string]: unknown }> | undefined {
  if (!toolInvocations || !Array.isArray(toolInvocations)) {
    return undefined;
  }

  const validInvocations = toolInvocations.filter((inv: unknown) => {
    if (!inv || typeof inv !== "object" || Array.isArray(inv)) {
      return false;
    }
    const invObj = inv as Record<string, unknown>;
    return (
      invObj.id !== undefined &&
      invObj.id !== null &&
      typeof invObj.id === "string"
    );
  }) as Array<{ id: string; [key: string]: unknown }>;

  return validInvocations.length > 0 ? validInvocations : undefined;
}

/**
 * Validate and normalize tool calls
 * Ensures each call has a valid ID
 */
export function validateToolCalls(
  toolCalls: unknown
): Array<{ id: string; [key: string]: unknown }> | undefined {
  if (!toolCalls || !Array.isArray(toolCalls)) {
    return undefined;
  }

  const validCalls = toolCalls.filter((call: unknown) => {
    if (!call || typeof call !== "object" || Array.isArray(call)) {
      return false;
    }
    const callObj = call as Record<string, unknown>;
    return (
      callObj.id !== undefined &&
      callObj.id !== null &&
      typeof callObj.id === "string"
    );
  }) as Array<{ id: string; [key: string]: unknown }>;

  return validCalls.length > 0 ? validCalls : undefined;
}

/**
 * Validate a single message structure
 * Returns null if invalid, otherwise returns a validated message
 */
export function validateMessage(
  msg: unknown,
  options: ValidateMessageOptions = {}
): ValidatedMessage | null {
  const { sessionId, index = 0, generateIdIfMissing = true } = options;

  // Skip null, undefined, or non-object messages
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return null;
  }

  const msgAny = msg as Record<string, unknown>;

  // Validate and generate ID
  let messageId = msgAny.id;
  if (
    !messageId ||
    typeof messageId !== "string" ||
    messageId.trim() === ""
  ) {
    if (generateIdIfMissing && sessionId) {
      messageId = generateMessageId(sessionId, index);
    } else {
      return null;
    }
  }

  // Validate role
  const role = msgAny.role;
  if (
    !role ||
    !["user", "assistant", "system", "tool"].includes(role as string)
  ) {
    return null;
  }

  // Normalize content
  const rawContent = normalizeMessageContent(msgAny.content, msgAny.parts);
  const content = convertContentToArray(rawContent);

  // Normalize parts
  const parts = normalizeParts(msgAny.parts, content);

  // Validate tool invocations
  const toolInvocations = validateToolInvocations(msgAny.toolInvocations);

  // Validate tool calls
  const toolCalls = validateToolCalls(msgAny.toolCalls);

  // Build validated message
  const validatedMsg: ValidatedMessage = {
    id: messageId as string,
    role: role as "user" | "assistant" | "system" | "tool",
  };

  if (content !== undefined) {
    validatedMsg.content = content;
  }

  if (parts !== undefined) {
    validatedMsg.parts = parts;
  }

  if (toolInvocations !== undefined) {
    validatedMsg.toolInvocations = toolInvocations;
  }

  if (toolCalls !== undefined) {
    validatedMsg.toolCalls = toolCalls;
  }

  return validatedMsg;
}

/**
 * Check if a message has valid content or tool invocations/calls
 */
export function hasValidContent(msg: ValidatedMessage): boolean {
  // Check content
  const hasContent = Boolean(
    msg.content &&
    (Array.isArray(msg.content)
      ? msg.content.length > 0
      : typeof msg.content === "string"
        ? msg.content.trim() !== ""
        : true)
  );

  // Check tool invocations
  const hasToolInvocations = Boolean(
    msg.toolInvocations &&
    Array.isArray(msg.toolInvocations) &&
    msg.toolInvocations.length > 0
  );

  // Check tool calls
  const hasToolCalls = Boolean(
    msg.toolCalls && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0
  );

  // Keep message if it has content OR has tool invocations/calls
  return hasContent || hasToolInvocations || hasToolCalls;
}

/**
 * Clean and filter messages
 * Removes invalid messages and those without content
 */
export function cleanMessages(
  messages: unknown[],
  options: ValidateMessageOptions = {}
): ValidatedMessage[] {
  const validated = messages
    .map((msg, index) =>
      validateMessage(msg, { ...options, index })
    )
    .filter((msg): msg is ValidatedMessage => msg !== null);

  // Filter out messages without valid content
  return validated.filter(hasValidContent);
}

/**
 * Deep validation of message structure before import
 * More strict validation for final import step
 */
export function validateMessageStructure(
  msg: unknown,
  index: number
): msg is ValidatedMessage {
  try {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      return false;
    }

    const msgObj = msg as Record<string, unknown>;

    // Validate ID
    if (
      !msgObj.id ||
      typeof msgObj.id !== "string" ||
      msgObj.id.trim() === ""
    ) {
      return false;
    }

    // Validate role
    if (
      !msgObj.role ||
      !["user", "assistant", "system", "tool"].includes(
        msgObj.role as string
      )
    ) {
      return false;
    }

    // Validate toolInvocations array if present
    if (msgObj.toolInvocations !== undefined) {
      if (!Array.isArray(msgObj.toolInvocations)) {
        return false;
      }
      // Check each invocation has valid id
      for (let i = 0; i < msgObj.toolInvocations.length; i++) {
        const inv = msgObj.toolInvocations[i];
        if (!inv || typeof inv !== "object" || Array.isArray(inv)) {
          return false;
        }
        const invObj = inv as Record<string, unknown>;
        if (
          !invObj.id ||
          typeof invObj.id !== "string" ||
          invObj.id.trim() === ""
        ) {
          return false;
        }
      }
    }

    // Validate toolCalls array if present
    if (msgObj.toolCalls !== undefined) {
      if (!Array.isArray(msgObj.toolCalls)) {
        return false;
      }
      // Check each call has valid id
      for (let i = 0; i < msgObj.toolCalls.length; i++) {
        const call = msgObj.toolCalls[i];
        if (!call || typeof call !== "object" || Array.isArray(call)) {
          return false;
        }
        const callObj = call as Record<string, unknown>;
        if (
          !callObj.id ||
          typeof callObj.id !== "string" ||
          callObj.id.trim() === ""
        ) {
          return false;
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Clean content/parts arrays to remove null/undefined and ensure proper structure
 * Final cleaning step before import
 */
export function cleanMessageContent(
  msg: ValidatedMessage
): ValidatedMessage {
  const cleaned: ValidatedMessage = {
    id: msg.id,
    role: msg.role,
  };

  // Clean content array if present
  if (msg.content !== undefined) {
    if (Array.isArray(msg.content)) {
      const cleanedContent = msg.content
        .filter((part) => part !== null && part !== undefined)
        .map((part) => {
          // If part is an object without an id, ensure it's properly structured
          if (typeof part === "object" && part !== null && !Array.isArray(part)) {
            const partObj = part as Record<string, unknown>;
            // If it's a text part object, ensure it has the right structure
            if (partObj.type === "text" && typeof partObj.text === "string") {
              return part; // Already properly structured
            }
            // If it's a string, wrap it in a text part object
            if (typeof part === "string") {
              return { type: "text", text: part };
            }
            // Otherwise, return as-is (might be an attachment or other part type)
            return part;
          }
          // If part is a string, wrap it in a text part object
          if (typeof part === "string") {
            return { type: "text", text: part };
          }
          return part;
        });

      if (cleanedContent.length > 0) {
        cleaned.content = cleanedContent;
      } else {
        cleaned.content = [];
      }
    } else if (typeof msg.content === "string" && msg.content.trim() !== "") {
      cleaned.content = [{ type: "text", text: msg.content }];
    } else {
      cleaned.content = msg.content;
    }
  }

  // Clean parts array if present (similar to content)
  if (msg.parts !== undefined) {
    if (Array.isArray(msg.parts)) {
      const cleanedParts = msg.parts
        .filter((part) => part !== null && part !== undefined)
        .map((part) => {
          if (typeof part === "object" && part !== null && !Array.isArray(part)) {
            const partObj = part as Record<string, unknown>;
            if (partObj.type === "text" && typeof partObj.text === "string") {
              return part;
            }
            if (typeof part === "string") {
              return { type: "text", text: part };
            }
            return part;
          }
          if (typeof part === "string") {
            return { type: "text", text: part };
          }
          return part;
        });

      if (cleanedParts.length > 0) {
        cleaned.parts = cleanedParts;
      } else {
        cleaned.parts = [];
      }
    } else if (typeof msg.parts === "string" && (msg.parts as string).trim() !== "") {
      cleaned.parts = [{ type: "text", text: msg.parts as string }];
    } else {
      cleaned.parts = msg.parts;
    }
  }

  // Copy toolInvocations and toolCalls if present (already validated)
  if (Array.isArray(msg.toolInvocations) && msg.toolInvocations.length > 0) {
    cleaned.toolInvocations = msg.toolInvocations;
  }
  if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
    cleaned.toolCalls = msg.toolCalls;
  }

  return cleaned;
}

