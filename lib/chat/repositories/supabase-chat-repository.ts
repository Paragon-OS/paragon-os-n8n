/**
 * Supabase Chat Repository Implementation
 * Implements ChatRepository interface using Supabase
 */

import type { ChatRepository, GetMessagesOptions, SessionMetadata, SessionUpdates } from "./chat-repository.interface";
import type { UIMessage } from "ai";
import type { ChatSessionRow } from "@/lib/supabase/supabase-chat";
import {
  getChatMessagesBySessionId,
  getAllChatSessions,
  getChatSessionById,
  ensureChatSession,
  updateChatSession,
  deleteChatSession,
  getChatMessageCount,
} from "@/lib/supabase/supabase-chat";

/**
 * Supabase implementation of ChatRepository
 */
export class SupabaseChatRepository implements ChatRepository {
  async getMessages(
    sessionId: string,
    options?: GetMessagesOptions
  ): Promise<UIMessage[]> {
    return getChatMessagesBySessionId({
      sessionId,
      limit: options?.limit,
      offset: options?.offset,
    });
  }

  async getSessions(
    userId?: string,
    limit?: number
  ): Promise<ChatSessionRow[]> {
    return getAllChatSessions(limit, userId);
  }

  async getSessionById(sessionId: string): Promise<ChatSessionRow | null> {
    return getChatSessionById(sessionId);
  }

  async createSession(
    sessionId: string,
    metadata?: SessionMetadata
  ): Promise<void> {
    return ensureChatSession(
      sessionId,
      metadata?.userId,
      metadata?.title,
      metadata?.metadata
    );
  }

  async updateSession(
    sessionId: string,
    updates: SessionUpdates
  ): Promise<boolean> {
    return updateChatSession(sessionId, updates);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return deleteChatSession(sessionId);
  }

  async getMessageCount(sessionId: string): Promise<number> {
    return getChatMessageCount(sessionId);
  }
}

