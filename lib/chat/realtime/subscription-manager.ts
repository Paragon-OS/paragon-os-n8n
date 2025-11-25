/**
 * Realtime Subscription Manager
 * Handles Supabase Realtime subscriptions for chat messages and sessions
 * Extracted for testability
 */

import { createSupabaseClient } from "@/lib/supabase/supabase-config";
import type { UIMessage } from "ai";
import type { ChatSessionRow } from "@/lib/supabase/supabase-chat";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Realtime Subscription Manager
 * Manages Supabase Realtime subscriptions with debouncing
 */
export class RealtimeSubscriptionManager {
  private messageChannels: Map<string, RealtimeChannel> = new Map();
  private sessionsChannel: RealtimeChannel | null = null;
  private refetchTimeouts: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Subscribe to messages for a session
   * Returns an unsubscribe function
   */
  subscribeToMessages(
    sessionId: string,
    callback: (messages: UIMessage[]) => void,
    debounceMs: number = 100
  ): () => void {
    const supabase = createSupabaseClient();
    if (!supabase) {
      return () => {}; // No-op unsubscribe
    }

    // Remove existing subscription if any
    this.unsubscribeFromMessages(sessionId);

    const channel = supabase
      .channel(`chat_messages_${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          // Debounce refetch to avoid too many requests if multiple events come quickly
          const existingTimeout = this.refetchTimeouts.get(sessionId);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
          }

          const timeout = setTimeout(() => {
            // Trigger callback to refetch messages
            // The callback should handle fetching from the repository
            callback([]); // Empty array signals to refetch
            this.refetchTimeouts.delete(sessionId);
          }, debounceMs);

          this.refetchTimeouts.set(sessionId, timeout);
        }
      )
      .subscribe();

    this.messageChannels.set(sessionId, channel);

    // Return unsubscribe function
    return () => this.unsubscribeFromMessages(sessionId);
  }

  /**
   * Unsubscribe from messages for a session
   */
  unsubscribeFromMessages(sessionId: string): void {
    const channel = this.messageChannels.get(sessionId);
    if (channel) {
      const supabase = createSupabaseClient();
      if (supabase) {
        supabase.removeChannel(channel);
      }
      this.messageChannels.delete(sessionId);
    }

    // Clear any pending timeout
    const timeout = this.refetchTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.refetchTimeouts.delete(sessionId);
    }
  }

  /**
   * Subscribe to session changes
   * Returns an unsubscribe function
   */
  subscribeToSessions(
    callback: (sessions: ChatSessionRow[]) => void
  ): () => void {
    const supabase = createSupabaseClient();
    if (!supabase) {
      return () => {}; // No-op unsubscribe
    }

    // Remove existing subscription if any
    this.unsubscribeFromSessions();

    const channel = supabase
      .channel("chat_sessions_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_sessions",
        },
        (payload) => {
          // Handle different event types
          if (payload.eventType === "INSERT") {
            const newSession = payload.new as ChatSessionRow;
            callback([newSession]); // Signal that sessions changed
          } else if (payload.eventType === "UPDATE") {
            const updatedSession = payload.new as ChatSessionRow;
            callback([updatedSession]); // Signal that sessions changed
          } else if (payload.eventType === "DELETE") {
            const deletedSession = payload.old as ChatSessionRow;
            callback([deletedSession]); // Signal that sessions changed
          }
        }
      )
      .subscribe();

    this.sessionsChannel = channel;

    // Return unsubscribe function
    return () => this.unsubscribeFromSessions();
  }

  /**
   * Unsubscribe from session changes
   */
  unsubscribeFromSessions(): void {
    if (this.sessionsChannel) {
      const supabase = createSupabaseClient();
      if (supabase) {
        supabase.removeChannel(this.sessionsChannel);
      }
      this.sessionsChannel = null;
    }
  }

  /**
   * Cleanup all subscriptions
   */
  cleanup(): void {
    // Unsubscribe from all message channels
    for (const sessionId of this.messageChannels.keys()) {
      this.unsubscribeFromMessages(sessionId);
    }

    // Unsubscribe from sessions
    this.unsubscribeFromSessions();

    // Clear all timeouts
    for (const timeout of this.refetchTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.refetchTimeouts.clear();
  }
}

