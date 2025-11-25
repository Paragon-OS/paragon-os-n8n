/**
 * Chat Repository Interface
 * Abstraction layer for chat data access
 */

import type { UIMessage } from "ai";
import type { ChatSessionRow } from "@/lib/supabase/supabase-chat";

/**
 * Options for retrieving messages
 */
export interface GetMessagesOptions {
  limit?: number;
  offset?: number;
}

/**
 * Options for creating a session
 */
export interface SessionMetadata {
  userId?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Options for updating a session
 */
export interface SessionUpdates {
  title?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Chat Repository Interface
 * Provides abstraction for chat data access operations
 */
export interface ChatRepository {
  /**
   * Get messages for a session
   */
  getMessages(
    sessionId: string,
    options?: GetMessagesOptions
  ): Promise<UIMessage[]>;

  /**
   * Get all chat sessions
   */
  getSessions(userId?: string, limit?: number): Promise<ChatSessionRow[]>;

  /**
   * Get a specific session by ID
   */
  getSessionById(sessionId: string): Promise<ChatSessionRow | null>;

  /**
   * Create a new session
   */
  createSession(
    sessionId: string,
    metadata?: SessionMetadata
  ): Promise<void>;

  /**
   * Update a session
   */
  updateSession(
    sessionId: string,
    updates: SessionUpdates
  ): Promise<boolean>;

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): Promise<boolean>;

  /**
   * Get message count for a session
   */
  getMessageCount(sessionId: string): Promise<number>;
}

