/**
 * Supabase Chat Persistence
 * Handles persistence of AI chat messages and sessions to Supabase
 * Follows the AI SDK UIMessage format for compatibility
 */

import type { UIMessage } from "ai";
import { createSupabaseClient } from "./supabase-config";

/**
 * Flexible message type that accepts AI SDK UIMessage
 * This allows us to work with the generic UIMessage type from the AI SDK
 */
type FlexibleUIMessage = UIMessage | {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content?: string | unknown[] | Record<string, unknown>;
  parts?: string | unknown[] | Record<string, unknown>;
  toolInvocations?: unknown[];
  [key: string]: unknown;
};

/**
 * Chat session database row type
 */
export interface ChatSessionRow {
  id?: string; // UUID, auto-generated
  session_id: string;
  user_id?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  created_at?: string; // Auto-generated
  updated_at?: string; // Auto-generated
}

/**
 * Chat message database row type
 * Follows AI SDK UIMessage structure
 */
export interface ChatMessageRow {
  id?: string; // UUID, auto-generated
  session_id: string;
  message_id?: string;
  role: "user" | "assistant" | "system" | "tool";
  content?: string; // For simple text messages
  content_parts?: unknown[]; // For complex messages with multiple parts
  tool_calls?: unknown[]; // For tool invocations
  tool_invocations?: unknown[]; // For tool results
  metadata?: Record<string, unknown>;
  created_at?: string; // Auto-generated
}

/**
 * Re-export UIMessage type from AI SDK for convenience
 */
export type { UIMessage } from "ai";

/**
 * Options for saving chat messages
 */
export interface SaveChatMessagesOptions {
  sessionId: string;
  messages: FlexibleUIMessage[];
  userId?: string;
  sessionTitle?: string;
  sessionMetadata?: Record<string, unknown>;
}

/**
 * Options for retrieving chat messages
 */
export interface GetChatMessagesOptions {
  sessionId: string;
  limit?: number;
  offset?: number;
}

// Cache for table existence check to avoid repeated queries
let chatTablesExistCache: boolean | null = null;
let chatTableCheckPerformed = false;

// Lock map to prevent concurrent session creation for the same session ID
const sessionCreationLocks = new Map<string, Promise<void>>();

/**
 * Check if chat tables exist in the database
 */
async function checkChatTablesExist(): Promise<boolean> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return false;
  }

  try {
    // Try to query the chat_sessions table with a limit of 0 to check if it exists
    const { error } = await supabase
      .from("chat_sessions")
      .select("*")
      .limit(0);

    // If no error, table exists
    if (!error) {
      return true;
    }

    // Check if error is "relation does not exist"
    if (error.code === "42P01" || error.message.includes("does not exist")) {
      return false;
    }

    // Other errors might mean table exists but we don't have permissions
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure chat session exists, create if it doesn't
 * Uses a lock mechanism to prevent concurrent creation of the same session
 */
export async function ensureChatSession(
  sessionId: string,
  userId?: string,
  title?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return;
  }

  // Check if there's already a pending creation for this session
  const existingLock = sessionCreationLocks.get(sessionId);
  if (existingLock) {
    console.log("[supabase-chat] Waiting for existing session creation lock:", sessionId);
    await existingLock;
    return;
  }

  // Create a new lock promise
  const creationPromise = (async () => {
    try {
      console.log("[supabase-chat] ensureChatSession called for:", sessionId, "title:", title);
      // Check if session exists
      const { data: existingSession, error: checkError } = await supabase
        .from("chat_sessions")
        .select("session_id")
        .eq("session_id", sessionId)
        .single();

      if (checkError && checkError.code !== "PGRST116") {
        console.error("[supabase-chat] Error checking session existence:", checkError);
      }

      console.log("[supabase-chat] Session check result:", existingSession ? "EXISTS" : "NOT FOUND", "sessionId:", sessionId);

      if (!existingSession) {
        // Create new session
        console.log("[supabase-chat] Creating new session:", sessionId);
        const sessionRow: ChatSessionRow = {
          session_id: sessionId,
          user_id: userId,
          title: title,
          metadata: metadata || {},
        };

        const { error } = await supabase
          .from("chat_sessions")
          .insert(sessionRow);

        if (error) {
          // If it's a duplicate key error, that's okay - another request created it first
          if (error.code === "23505") {
            console.log("[supabase-chat] Session already exists (created by concurrent request):", sessionId);
          } else {
            console.error(
              "[supabase-chat] Error creating chat session:",
              error,
              { sessionId }
            );
          }
        } else {
          console.log("[supabase-chat] Successfully created session:", sessionId);
        }
      } else {
        console.log("[supabase-chat] Session already exists, skipping creation:", sessionId);
      }
    } catch (error) {
      console.error(
        "[supabase-chat] Unexpected error ensuring chat session:",
        error,
        { sessionId }
      );
    } finally {
      // Remove the lock when done
      sessionCreationLocks.delete(sessionId);
    }
  })();

  // Store the lock promise
  sessionCreationLocks.set(sessionId, creationPromise);
  
  // Wait for the creation to complete
  await creationPromise;
}

/**
 * Convert UIMessage to ChatMessageRow for database storage
 */
function convertUIMessageToRow(
  message: FlexibleUIMessage,
  sessionId: string
): ChatMessageRow {
  const row: ChatMessageRow = {
    session_id: sessionId,
    message_id: message.id,
    role: message.role,
    metadata: {},
  };

  // Handle content field - can be string, array, object, or undefined
  // The AI SDK UIMessage type may have content, parts, or both
  const messageRecord = message as Record<string, unknown>;
  const content = messageRecord.content ?? messageRecord.parts;

  if (content !== undefined) {
    if (typeof content === "string") {
      row.content = content;
    } else if (Array.isArray(content)) {
      row.content_parts = content;
    } else if (content && typeof content === "object") {
      row.content_parts = [content];
    }
  }

  // Handle tool invocations
  const toolInvocations = messageRecord.toolInvocations;
  if (toolInvocations) {
    row.tool_invocations = Array.isArray(toolInvocations) 
      ? toolInvocations 
      : [toolInvocations];
  }

  // Handle tool calls
  const toolCalls = messageRecord.toolCalls;
  if (toolCalls) {
    row.tool_calls = Array.isArray(toolCalls) 
      ? toolCalls 
      : [toolCalls];
  }

  // Store any additional properties in metadata
  const knownKeys = ["id", "role", "content", "parts", "toolInvocations", "toolCalls"];
  Object.keys(messageRecord).forEach((key) => {
    if (!knownKeys.includes(key)) {
      row.metadata![key] = messageRecord[key];
    }
  });

  return row;
}

/**
 * Convert ChatMessageRow from database to UIMessage format
 */
export function convertRowToUIMessage(row: ChatMessageRow): UIMessage {
  console.log("[supabase-chat] convertRowToUIMessage - message_id:", row.message_id, "role:", row.role);
  
  // Validate required fields
  if (!row) {
    throw new Error("convertRowToUIMessage: row is null or undefined");
  }
  
  if (!row.role || !["user", "assistant", "system", "tool"].includes(row.role)) {
    throw new Error(`convertRowToUIMessage: invalid role: ${row.role}`);
  }

  // Ensure message ID is valid - generate one if missing
  let messageId = row.message_id || row.id;
  if (!messageId || typeof messageId !== "string" || messageId.trim() === "") {
    // Generate a fallback ID if missing
    messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.warn("[supabase-chat] Message missing valid ID, generated fallback:", messageId);
  }

  // Reconstruct content from either content or content_parts
  let content: string | unknown[] | Record<string, unknown> = "";
  if (row.content) {
    content = row.content;
  } else if (row.content_parts) {
    content = row.content_parts;
  }

  const messageData: Record<string, unknown> = {
    id: messageId,
    role: row.role,
    content,
    parts: content, // AI SDK may expect parts property
  };

  // Add tool invocations if present - validate and filter out invalid entries
  if (row.tool_invocations) {
    if (Array.isArray(row.tool_invocations)) {
      // Filter out null/undefined entries and ensure each has an id
      const validInvocations = row.tool_invocations.filter((inv: unknown) => {
        if (!inv || typeof inv !== "object" || Array.isArray(inv)) {
          return false;
        }
        const invObj = inv as Record<string, unknown>;
        return invObj.id !== undefined && invObj.id !== null && typeof invObj.id === "string";
      });
      if (validInvocations.length > 0) {
        messageData.toolInvocations = validInvocations;
      }
    }
  }

  // Add tool calls if present - validate and filter out invalid entries
  if (row.tool_calls) {
    if (Array.isArray(row.tool_calls)) {
      // Filter out null/undefined entries and ensure each has an id
      const validCalls = row.tool_calls.filter((call: unknown) => {
        if (!call || typeof call !== "object" || Array.isArray(call)) {
          return false;
        }
        const callObj = call as Record<string, unknown>;
        return callObj.id !== undefined && callObj.id !== null && typeof callObj.id === "string";
      });
      if (validCalls.length > 0) {
        messageData.toolCalls = validCalls;
      }
    }
  }

  // Restore metadata properties, but don't overwrite critical fields
  // Also ensure all values are properly defined (not undefined)
  if (row.metadata) {
    const metadataKeys = Object.keys(row.metadata);
    console.log("[supabase-chat] Processing metadata keys:", metadataKeys.join(", "));
    const criticalFields = ["id", "role", "content", "parts", "toolInvocations", "toolCalls"];
    Object.keys(row.metadata).forEach((key) => {
      if (!criticalFields.includes(key)) {
        const value = row.metadata![key];
        // Only add metadata if it's not undefined/null
        if (value !== undefined && value !== null) {
          messageData[key] = value;
        } else {
          console.warn(`[supabase-chat] Skipped undefined/null metadata key: ${key}`);
        }
      }
    });
  }

  console.log("[supabase-chat] Output message id:", messageData.id, "keys:", Object.keys(messageData).join(", "));
  return messageData as unknown as UIMessage;
}

/**
 * Save chat messages to Supabase
 * This function is non-blocking and will not throw errors to avoid affecting chat performance
 * Errors are logged but do not propagate
 */
export async function saveChatMessagesToSupabase(
  options: SaveChatMessagesOptions
): Promise<void> {
  const supabase = createSupabaseClient();

  // If Supabase is not configured, silently skip
  if (!supabase) {
    console.warn(
      "[supabase-chat] Supabase not configured, skipping save",
      { sessionId: options.sessionId }
    );
    return;
  }

  // Check if migrations have been applied (once per session)
  if (!chatTableCheckPerformed) {
    const tablesExist = await checkChatTablesExist();
    chatTablesExistCache = tablesExist;
    chatTableCheckPerformed = true;

    if (!tablesExist) {
      console.warn(
        "[supabase-chat] Chat tables not found. Run migrations to enable chat persistence."
      );
      return;
    }
  }

  // Use cached result
  if (chatTablesExistCache === false) {
    return;
  }

  try {
    // Ensure session exists
    await ensureChatSession(
      options.sessionId,
      options.userId,
      options.sessionTitle,
      options.sessionMetadata
    );

    // Convert messages to database rows
    const messageRows = options.messages.map((msg) =>
      convertUIMessageToRow(msg, options.sessionId)
    );

    // Insert messages
    const { error } = await supabase
      .from("chat_messages")
      .insert(messageRows);

    if (error) {
      console.error(
        "[supabase-chat] Error saving chat messages:",
        error,
        { sessionId: options.sessionId, messageCount: options.messages.length }
      );
      return;
    }
  } catch (error) {
    // Catch any unexpected errors to prevent them from propagating
    console.error(
      "[supabase-chat] Unexpected error saving chat messages:",
      error,
      { sessionId: options.sessionId }
    );
  }
}

/**
 * Save a single chat message to Supabase
 */
export async function saveChatMessageToSupabase(
  sessionId: string,
  message: FlexibleUIMessage,
  userId?: string
): Promise<void> {
  return saveChatMessagesToSupabase({
    sessionId,
    messages: [message],
    userId,
  });
}

/**
 * Options for updating a chat message
 */
export interface UpdateChatMessageOptions {
  messageId: string;
  sessionId?: string;
  content?: string;
  contentParts?: unknown[];
  toolInvocations?: unknown[];
  metadata?: Record<string, unknown>;
  appendContent?: string; // Append to existing content instead of replacing
}

/**
 * Get a chat message by message_id
 * Returns null if message not found or on error
 */
export async function getChatMessageByMessageId(
  messageId: string,
  sessionId?: string
): Promise<ChatMessageRow | null> {
  const supabase = createSupabaseClient();

  if (!supabase) {
    console.warn(
      "[supabase-chat] Supabase not configured, cannot retrieve message"
    );
    return null;
  }

  try {
    let query = supabase
      .from("chat_messages")
      .select("*")
      .eq("message_id", messageId);

    if (sessionId) {
      query = query.eq("session_id", sessionId);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === "PGRST116") {
        // No rows returned
        return null;
      }
      console.error(
        "[supabase-chat] Error retrieving chat message:",
        error,
        { messageId, sessionId }
      );
      return null;
    }

    return data as ChatMessageRow;
  } catch (error) {
    console.error(
      "[supabase-chat] Unexpected error retrieving chat message:",
      error,
      { messageId }
    );
    return null;
  }
}

/**
 * Update an existing chat message by message_id
 * This function is non-blocking and will not throw errors to avoid affecting chat performance
 * Errors are logged but do not propagate
 */
export async function updateChatMessage(
  options: UpdateChatMessageOptions
): Promise<void> {
  const supabase = createSupabaseClient();

  // If Supabase is not configured, silently skip
  if (!supabase) {
    console.warn(
      "[supabase-chat] Supabase not configured, skipping update",
      { messageId: options.messageId }
    );
    return;
  }

  // Check if migrations have been applied (once per session)
  if (!chatTableCheckPerformed) {
    const tablesExist = await checkChatTablesExist();
    chatTablesExistCache = tablesExist;
    chatTableCheckPerformed = true;

    if (!tablesExist) {
      console.warn(
        "[supabase-chat] Chat tables not found. Run migrations to enable chat persistence."
      );
      return;
    }
  }

  // Use cached result
  if (chatTablesExistCache === false) {
    return;
  }

  try {
    // If appendContent is provided, fetch current message first
    let currentContent = "";
    if (options.appendContent !== undefined) {
      const currentMessage = await getChatMessageByMessageId(
        options.messageId,
        options.sessionId
      );
      if (currentMessage) {
        currentContent = currentMessage.content || "";
      }
    }

    // Build update object with only provided fields
    const updateData: Partial<ChatMessageRow> = {};

    if (options.appendContent !== undefined) {
      // Append to existing content
      updateData.content = currentContent + options.appendContent;
      updateData.content_parts = undefined;
    } else if (options.content !== undefined) {
      updateData.content = options.content;
      // Clear content_parts if content is being set
      updateData.content_parts = undefined;
    }

    if (options.contentParts !== undefined) {
      updateData.content_parts = options.contentParts;
      // Clear content if content_parts is being set
      updateData.content = undefined;
    }

    if (options.toolInvocations !== undefined) {
      updateData.tool_invocations = options.toolInvocations;
    }

    if (options.metadata !== undefined) {
      updateData.metadata = options.metadata;
    }

    // Build query - update by message_id
    let query = supabase
      .from("chat_messages")
      .update(updateData)
      .eq("message_id", options.messageId);

    // Optionally filter by session_id if provided
    if (options.sessionId) {
      query = query.eq("session_id", options.sessionId);
    }

    const { error, data } = await query.select();

    if (error) {
      console.error(
        "[supabase-chat] Error updating chat message:",
        error,
        { messageId: options.messageId, sessionId: options.sessionId }
      );
      return;
    }

    if (!data || data.length === 0) {
      console.warn(
        `[supabase-chat] No message found to update with message_id: ${options.messageId}`,
        { sessionId: options.sessionId }
      );
      return;
    }

    console.log(
      `[supabase-chat] Updated message: ${options.messageId}`
    );
  } catch (error) {
    // Catch any unexpected errors to prevent them from propagating
    console.error(
      "[supabase-chat] Unexpected error updating chat message:",
      error,
      { messageId: options.messageId }
    );
  }
}

/**
 * Retrieve chat messages for a specific session from Supabase
 * Returns empty array if Supabase is not configured or on error
 */
export async function getChatMessagesBySessionId(
  options: GetChatMessagesOptions
): Promise<UIMessage[]> {
  const supabase = createSupabaseClient();

  if (!supabase) {
    console.warn(
      "[supabase-chat] Supabase not configured, cannot retrieve messages"
    );
    return [];
  }

  try {
    let query = supabase
      .from("chat_messages")
      .select("*")
      .eq("session_id", options.sessionId)
      .order("created_at", { ascending: true });

    if (options.limit !== undefined) {
      query = query.limit(options.limit);
    }

    if (options.offset !== undefined) {
      query = query.range(
        options.offset,
        options.offset + (options.limit || 100) - 1
      );
    }

    const { data, error } = await query;

    if (error) {
      console.error(
        "[supabase-chat] Error retrieving chat messages:",
        error,
        { sessionId: options.sessionId }
      );
      return [];
    }

    return (data as ChatMessageRow[]).map(convertRowToUIMessage);
  } catch (error) {
    console.error(
      "[supabase-chat] Unexpected error retrieving chat messages:",
      error,
      { sessionId: options.sessionId }
    );
    return [];
  }
}

/**
 * Retrieve all chat sessions from Supabase (with optional limit)
 * Returns empty array if Supabase is not configured or on error
 */
export async function getAllChatSessions(
  limit?: number,
  userId?: string
): Promise<ChatSessionRow[]> {
  const supabase = createSupabaseClient();

  if (!supabase) {
    console.warn(
      "[supabase-chat] Supabase not configured, cannot retrieve sessions"
    );
    return [];
  }

  try {
    let query = supabase
      .from("chat_sessions")
      .select("*")
      .order("updated_at", { ascending: false });

    if (userId) {
      query = query.eq("user_id", userId);
    }

    if (limit !== undefined) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error(
        "[supabase-chat] Error retrieving chat sessions:",
        error
      );
      return [];
    }

    return (data as ChatSessionRow[]) || [];
  } catch (error) {
    console.error(
      "[supabase-chat] Unexpected error retrieving chat sessions:",
      error
    );
    return [];
  }
}

/**
 * Get a specific chat session by session ID
 */
export async function getChatSessionById(
  sessionId: string
): Promise<ChatSessionRow | null> {
  const supabase = createSupabaseClient();

  if (!supabase) {
    console.warn(
      "[supabase-chat] Supabase not configured, cannot retrieve session"
    );
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("*")
      .eq("session_id", sessionId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // No rows returned
        return null;
      }
      console.error(
        "[supabase-chat] Error retrieving chat session:",
        error,
        { sessionId }
      );
      return null;
    }

    return data as ChatSessionRow;
  } catch (error) {
    console.error(
      "[supabase-chat] Unexpected error retrieving chat session:",
      error,
      { sessionId }
    );
    return null;
  }
}

/**
 * Update a chat session's metadata or title
 */
export async function updateChatSession(
  sessionId: string,
  updates: {
    title?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<boolean> {
  const supabase = createSupabaseClient();

  if (!supabase) {
    console.warn(
      "[supabase-chat] Supabase not configured, cannot update session"
    );
    return false;
  }

  try {
    const { error } = await supabase
      .from("chat_sessions")
      .update(updates)
      .eq("session_id", sessionId);

    if (error) {
      console.error(
        "[supabase-chat] Error updating chat session:",
        error,
        { sessionId }
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      "[supabase-chat] Unexpected error updating chat session:",
      error,
      { sessionId }
    );
    return false;
  }
}

/**
 * Delete a chat session and all its messages and stream events
 * Messages are cascade deleted via foreign key constraint
 * Stream events are cascade deleted via foreign key constraint (if migration applied)
 * This function also manually deletes stream_events as a fallback if migration hasn't run
 */
export async function deleteChatSession(sessionId: string): Promise<boolean> {
  const supabase = createSupabaseClient();

  if (!supabase) {
    console.warn(
      "[supabase-chat] Supabase not configured, cannot delete session"
    );
    return false;
  }

  try {
    // Delete stream_events manually as a fallback (in case migration hasn't run)
    // If foreign key constraint exists, this is redundant but harmless
    // If constraint doesn't exist yet, this ensures events are cleaned up
    const { error: streamEventsError } = await supabase
      .from("stream_events")
      .delete()
      .eq("session_id", sessionId);

    if (streamEventsError) {
      // Log but don't fail - constraint might already handle this
      console.warn(
        "[supabase-chat] Warning deleting stream events (may be handled by cascade):",
        streamEventsError,
        { sessionId }
      );
    }

    // Delete session (messages will be cascade deleted due to foreign key)
    // Stream events will also be cascade deleted if foreign key constraint exists
    const { error } = await supabase
      .from("chat_sessions")
      .delete()
      .eq("session_id", sessionId);

    if (error) {
      console.error(
        "[supabase-chat] Error deleting chat session:",
        error,
        { sessionId }
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      "[supabase-chat] Unexpected error deleting chat session:",
      error,
      { sessionId }
    );
    return false;
  }
}

/**
 * Get message count for a session
 */
export async function getChatMessageCount(sessionId: string): Promise<number> {
  const supabase = createSupabaseClient();

  if (!supabase) {
    return 0;
  }

  try {
    const { count, error } = await supabase
      .from("chat_messages")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);

    if (error) {
      console.error(
        "[supabase-chat] Error getting message count:",
        error,
        { sessionId }
      );
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error(
      "[supabase-chat] Unexpected error getting message count:",
      error,
      { sessionId }
    );
    return 0;
  }
}

