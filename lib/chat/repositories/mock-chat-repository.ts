/**
 * Mock Chat Repository Implementation
 * In-memory implementation for testing
 */

import type {
  ChatRepository,
  GetMessagesOptions,
  SessionMetadata,
  SessionUpdates,
} from "./chat-repository.interface";
import type { UIMessage } from "ai";
import type { ChatSessionRow } from "@/lib/supabase/supabase-chat";

/**
 * Mock implementation of ChatRepository for testing
 */
export class MockChatRepository implements ChatRepository {
  private sessions: Map<string, ChatSessionRow> = new Map();
  private messages: Map<string, UIMessage[]> = new Map();

  async getMessages(
    sessionId: string,
    options?: GetMessagesOptions
  ): Promise<UIMessage[]> {
    const allMessages = this.messages.get(sessionId) || [];
    
    let result = allMessages;
    
    if (options?.offset !== undefined) {
      result = result.slice(options.offset);
    }
    
    if (options?.limit !== undefined) {
      result = result.slice(0, options.limit);
    }
    
    return result;
  }

  async getSessions(
    userId?: string,
    limit?: number
  ): Promise<ChatSessionRow[]> {
    let sessions = Array.from(this.sessions.values());
    
    if (userId) {
      sessions = sessions.filter((s) => s.user_id === userId);
    }
    
    // Sort by updated_at descending
    sessions.sort((a, b) => {
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return bTime - aTime;
    });
    
    if (limit !== undefined) {
      sessions = sessions.slice(0, limit);
    }
    
    return sessions;
  }

  async getSessionById(sessionId: string): Promise<ChatSessionRow | null> {
    return this.sessions.get(sessionId) || null;
  }

  async createSession(
    sessionId: string,
    metadata?: SessionMetadata
  ): Promise<void> {
    if (this.sessions.has(sessionId)) {
      return; // Already exists
    }
    
    const now = new Date().toISOString();
    const session: ChatSessionRow = {
      session_id: sessionId,
      user_id: metadata?.userId,
      title: metadata?.title,
      metadata: metadata?.metadata || {},
      created_at: now,
      updated_at: now,
    };
    
    this.sessions.set(sessionId, session);
    this.messages.set(sessionId, []);
  }

  async updateSession(
    sessionId: string,
    updates: SessionUpdates
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    
    const updated: ChatSessionRow = {
      ...session,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    
    this.sessions.set(sessionId, updated);
    return true;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const deleted = this.sessions.delete(sessionId);
    this.messages.delete(sessionId);
    return deleted;
  }

  async getMessageCount(sessionId: string): Promise<number> {
    return this.messages.get(sessionId)?.length || 0;
  }

  // Test helper methods
  
  /**
   * Add a message to a session (for testing)
   */
  addMessage(sessionId: string, message: UIMessage): void {
    const messages = this.messages.get(sessionId) || [];
    messages.push(message);
    this.messages.set(sessionId, messages);
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.sessions.clear();
    this.messages.clear();
  }
}

