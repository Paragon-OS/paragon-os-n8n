/**
 * Supabase Chat Persistence
 * Handles persistence of AI chat messages and sessions to Supabase
 * Follows the AI SDK UIMessage format for compatibility
 */

import type { UIMessage } from "ai";
import { randomUUID } from "crypto";
import { createSupabaseClient } from "./supabase-config";

/**
 * Chat session database row type (refactored schema)
 */
export interface ChatSessionRow {
  id: string; // UUID primary key
  user_id?: string;
  title?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Chat message database row type (refactored schema)
 */
export interface ChatMessageRow {
  id: string; // UUID primary key
  session_id: string; // UUID foreign key to chat_sessions
  role: "user" | "assistant" | "system" | "tool";
  content: unknown[]; // JSONB array of content parts
  tools?: {
    calls?: unknown[];
    invocations?: unknown[];
  };
  execution_id?: string; // n8n execution tracking
  created_at: string;
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
  messages: UIMessage[];
  userId?: string;
  sessionTitle?: string;
}

/**
 * Options for retrieving chat messages
 */
export interface GetChatMessagesOptions {
  sessionId: string;
  limit?: number;
  offset?: number;
}

/**
 * Ensure chat session exists using UPSERT (no locks needed)
 * Database handles race conditions via unique constraint
 */
export async function ensureChatSession(
  sessionId: string,
  userId?: string,
  title?: string
): Promise<void> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return;
  }

  try {
    const sessionRow: Partial<ChatSessionRow> = {
      id: sessionId,
      user_id: userId,
      title: title,
    };

    // UPSERT: Insert if not exists, do nothing if exists
    const { error } = await supabase
      .from("chat_sessions")
      .upsert(sessionRow, { onConflict: "id", ignoreDuplicates: true });

    if (error) {
      console.error("[supabase-chat] Error upserting session:", error);
    }
  } catch (error) {
    console.error("[supabase-chat] Unexpected error ensuring session:", error);
  }
}

/**
 * Convert UIMessage to ChatMessageRow for database storage
 * UIMessage uses 'parts' array - we store it directly as content
 */
function convertUIMessageToRow(
  message: UIMessage,
  sessionId: string,
  executionId?: string
): ChatMessageRow {
  // Generate UUID for database (AI SDK message IDs are not UUIDs)
  const messageId = randomUUID();
  
  // UIMessage.parts is the canonical field (not 'content')
  // Store parts directly as content in the database
  const content = message.parts || [];
  
  // Extract tool data from parts if present
  // Tool invocations are stored as parts with type 'tool-invocation'
  const toolParts = content.filter((part: any) => 
    part.type === 'tool-invocation' || part.type === 'tool-result'
  );
  
  const tools = toolParts.length > 0 ? { invocations: toolParts } : undefined;

  return {
    id: messageId,
    session_id: sessionId,
    role: message.role,
    content,
    tools,
    execution_id: executionId,
    created_at: new Date().toISOString(),
  };
}

/**
 * Convert ChatMessageRow from database to UIMessage format
 * Maps database content back to UIMessage.parts
 */
export function convertRowToUIMessage(row: ChatMessageRow): UIMessage {
  console.log(`[supabase-chat] Converting row to UIMessage, id: ${row.id}, role: ${row.role}`);
  console.log(`[supabase-chat] Row content type: ${typeof row.content}, isArray: ${Array.isArray(row.content)}`);
  console.log(`[supabase-chat] Row content:`, JSON.stringify(row.content));
  
  // UIMessage requires 'parts', not 'content'
  // Our database stores parts as content, so map it back
  
  // UIMessage only supports 'user' | 'assistant' | 'system'
  // Map 'tool' to 'assistant' for compatibility
  const role = row.role === 'tool' ? 'assistant' : row.role;
  
  const uiMessage = {
    id: row.id,
    role: role as 'user' | 'assistant' | 'system',
    parts: row.content as any[], // Content is stored as parts array
  };
  
  console.log(`[supabase-chat] Converted UIMessage:`, JSON.stringify(uiMessage));
  
  return uiMessage;
}

/**
 * Save chat messages to Supabase
 * Simplified: No table checks, no locks, just save
 */
export async function saveChatMessagesToSupabase(
  options: SaveChatMessagesOptions
): Promise<void> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return;
  }

  try {
    // Ensure session exists (UPSERT handles race conditions)
    await ensureChatSession(
      options.sessionId,
      options.userId,
      options.sessionTitle
    );

    // Convert and insert messages
    const messageRows = options.messages.map((msg) =>
      convertUIMessageToRow(msg, options.sessionId)
    );

    const { error } = await supabase
      .from("chat_messages")
      .insert(messageRows);

    if (error) {
      console.error("[supabase-chat] Error saving messages:", error);
    }
  } catch (error) {
    console.error("[supabase-chat] Error saving messages:", error);
  }
}

/**
 * Save a single chat message to Supabase
 */
export async function saveChatMessageToSupabase(
  sessionId: string,
  message: UIMessage,
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
  content?: unknown[];
  tools?: {
    calls?: unknown[];
    invocations?: unknown[];
  };
}

/**
 * Get a chat message by ID
 */
export async function getChatMessageById(
  messageId: string
): Promise<ChatMessageRow | null> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("id", messageId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      console.error("[supabase-chat] Error retrieving message:", error);
      return null;
    }

    return data as ChatMessageRow;
  } catch (error) {
    console.error("[supabase-chat] Error retrieving message:", error);
    return null;
  }
}

/**
 * Update an existing chat message by ID
 */
export async function updateChatMessage(
  options: UpdateChatMessageOptions
): Promise<void> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return;
  }

  try {
    const updateData: Partial<ChatMessageRow> = {};

    if (options.content !== undefined) {
      updateData.content = options.content;
    }

    if (options.tools !== undefined) {
      updateData.tools = options.tools;
    }

    const { error } = await supabase
      .from("chat_messages")
      .update(updateData)
      .eq("id", options.messageId);

    if (error) {
      console.error("[supabase-chat] Error updating message:", error);
    }
  } catch (error) {
    console.error("[supabase-chat] Error updating message:", error);
  }
}

/**
 * Retrieve chat messages for a specific session
 */
export async function getChatMessagesBySessionId(
  options: GetChatMessagesOptions
): Promise<UIMessage[]> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    console.log("[supabase-chat] No supabase client available");
    return [];
  }

  try {
    console.log(`[supabase-chat] Fetching messages for session: ${options.sessionId}`);
    
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
      console.error("[supabase-chat] Error retrieving messages:", error);
      return [];
    }

    console.log(`[supabase-chat] Retrieved ${data?.length || 0} raw messages from database`);
    
    if (data && data.length > 0) {
      console.log("[supabase-chat] First raw message from DB:", JSON.stringify(data[0]));
    }

    const uiMessages = (data as ChatMessageRow[]).map(convertRowToUIMessage);
    
    console.log(`[supabase-chat] Converted to ${uiMessages.length} UI messages`);
    
    if (uiMessages.length > 0) {
      console.log("[supabase-chat] First converted UI message:", JSON.stringify(uiMessages[0]));
    }

    return uiMessages;
  } catch (error) {
    console.error("[supabase-chat] Error retrieving messages:", error);
    return [];
  }
}

/**
 * Retrieve all chat sessions (with optional limit)
 */
export async function getAllChatSessions(
  limit?: number,
  userId?: string
): Promise<ChatSessionRow[]> {
  const supabase = createSupabaseClient();
  if (!supabase) {
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
      console.error("[supabase-chat] Error retrieving sessions:", error);
      return [];
    }

    return (data as ChatSessionRow[]) || [];
  } catch (error) {
    console.error("[supabase-chat] Error retrieving sessions:", error);
    return [];
  }
}

/**
 * Get a specific chat session by ID
 */
export async function getChatSessionById(
  sessionId: string
): Promise<ChatSessionRow | null> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      console.error("[supabase-chat] Error retrieving session:", error);
      return null;
    }

    return data as ChatSessionRow;
  } catch (error) {
    console.error("[supabase-chat] Error retrieving session:", error);
    return null;
  }
}

/**
 * Update a chat session's title
 */
export async function updateChatSession(
  sessionId: string,
  updates: {
    title?: string;
  }
): Promise<boolean> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return false;
  }

  try {
    const { error } = await supabase
      .from("chat_sessions")
      .update(updates)
      .eq("id", sessionId);

    if (error) {
      console.error("[supabase-chat] Error updating session:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[supabase-chat] Error updating session:", error);
    return false;
  }
}

/**
 * Delete a chat session and all its messages and stream events
 * CASCADE delete handles cleanup automatically
 */
export async function deleteChatSession(sessionId: string): Promise<boolean> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return false;
  }

  try {
    const { error } = await supabase
      .from("chat_sessions")
      .delete()
      .eq("id", sessionId);

    if (error) {
      console.error("[supabase-chat] Error deleting session:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[supabase-chat] Error deleting session:", error);
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
      console.error("[supabase-chat] Error getting message count:", error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error("[supabase-chat] Error getting message count:", error);
    return 0;
  }
}

