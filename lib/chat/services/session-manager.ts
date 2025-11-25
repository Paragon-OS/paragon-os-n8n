/**
 * Session Manager Service
 * Handles session management logic (creation, switching, deletion)
 * Extracted for testability
 */

import type { ChatRepository, SessionMetadata } from "../repositories/chat-repository.interface";
import type { ChatSessionRow } from "@/lib/supabase/supabase-chat";

/**
 * Interface for session store operations
 * Allows SessionManager to work with different store implementations
 */
export interface SessionStoreOperations {
  getActiveSessionId: () => string | null;
  setActiveSession: (sessionId: string | null, title?: string | null) => void;
  clearActiveSession: () => void;
}

/**
 * Session Manager
 * Handles session creation, switching, and deletion logic
 */
export class SessionManager {
  constructor(
    private repository: ChatRepository,
    private store: SessionStoreOperations
  ) {}

  /**
   * Switch to a different session
   * Updates the store with the new session ID and title
   */
  async switchSession(sessionId: string): Promise<void> {
    // Get session details from repository
    const session = await this.repository.getSessionById(sessionId);
    const sessionTitle = session?.title || null;
    
    // Update store
    this.store.setActiveSession(sessionId, sessionTitle);
  }

  /**
   * Create a new session
   * Generates a new session ID and ensures it exists in the repository
   */
  async createNewSession(metadata?: SessionMetadata): Promise<string> {
    const newSessionId = `session-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    
    // Ensure session exists in repository (will create if it doesn't)
    await this.repository.createSession(newSessionId, metadata);
    
    // Update store
    const sessionTitle = metadata?.title || null;
    this.store.setActiveSession(newSessionId, sessionTitle);
    
    return newSessionId;
  }

  /**
   * Delete a session
   * Removes it from the repository and clears store if it's the active session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const success = await this.repository.deleteSession(sessionId);
    
    if (!success) {
      return false;
    }

    // Clear active session if it's the one being deleted
    const activeSessionId = this.store.getActiveSessionId();
    if (activeSessionId === sessionId) {
      this.store.clearActiveSession();
    }

    return true;
  }

  /**
   * Ensure a session exists in the repository
   * Creates it if it doesn't exist (with locking mechanism handled by repository)
   */
  async ensureSessionExists(
    sessionId: string,
    metadata?: SessionMetadata
  ): Promise<void> {
    await this.repository.createSession(sessionId, metadata);
  }

  /**
   * Get the current active session ID
   */
  getActiveSessionId(): string | null {
    return this.store.getActiveSessionId();
  }

  /**
   * Update session metadata
   */
  async updateSession(
    sessionId: string,
    updates: { title?: string; metadata?: Record<string, unknown> }
  ): Promise<boolean> {
    return this.repository.updateSession(sessionId, updates);
  }
}

