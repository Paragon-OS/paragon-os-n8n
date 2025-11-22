/**
 * React hook for fetching and syncing chat sessions with Supabase Realtime
 */

import { useEffect, useState, useCallback } from "react";
import { createSupabaseClient } from "../supabase-config";
import type { ChatSessionRow } from "../supabase-chat";

export interface UseChatSessionsOptions {
  userId?: string;
  limit?: number;
  enabled?: boolean;
}

export interface UseChatSessionsReturn {
  sessions: ChatSessionRow[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and sync chat sessions with Supabase Realtime
 */
export function useChatSessions(
  options: UseChatSessionsOptions = {}
): UseChatSessionsReturn {
  const { userId, limit = 50, enabled = true } = options;
  const [sessions, setSessions] = useState<ChatSessionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSessions = useCallback(async () => {
    const supabase = createSupabaseClient();
    if (!supabase) {
      setError(new Error("Supabase client not available"));
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      let query = supabase
        .from("chat_sessions")
        .select("*")
        .order("updated_at", { ascending: false });

      if (userId) {
        query = query.eq("user_id", userId);
      }

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        throw fetchError;
      }

      setSessions((data as ChatSessionRow[]) || []);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error("[use-chat-sessions] Error fetching sessions:", error);
    } finally {
      setIsLoading(false);
    }
  }, [userId, limit]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    fetchSessions();

    const supabase = createSupabaseClient();
    if (!supabase) {
      return;
    }

    // Set up realtime subscription for chat_sessions
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
          console.log("[use-chat-sessions] Realtime event:", payload.eventType);

          if (payload.eventType === "INSERT") {
            const newSession = payload.new as ChatSessionRow;
            setSessions((prev) => {
              // Avoid duplicates
              if (prev.some((s) => s.session_id === newSession.session_id)) {
                return prev;
              }
              // Add to beginning and sort by updated_at
              return [newSession, ...prev]
                .sort(
                  (a, b) =>
                    new Date(b.updated_at || 0).getTime() -
                    new Date(a.updated_at || 0).getTime()
                )
                .slice(0, limit);
            });
          } else if (payload.eventType === "UPDATE") {
            const updatedSession = payload.new as ChatSessionRow;
            setSessions((prev) =>
              prev
                .map((s) =>
                  s.session_id === updatedSession.session_id
                    ? updatedSession
                    : s
                )
                .sort(
                  (a, b) =>
                    new Date(b.updated_at || 0).getTime() -
                    new Date(a.updated_at || 0).getTime()
                )
            );
          } else if (payload.eventType === "DELETE") {
            const deletedSession = payload.old as ChatSessionRow;
            setSessions((prev) =>
              prev.filter((s) => s.session_id !== deletedSession.session_id)
            );
          }
        }
      )
      .subscribe((status) => {
        console.log("[use-chat-sessions] Subscription status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, fetchSessions, limit]);

  return {
    sessions,
    isLoading,
    error,
    refetch: fetchSessions,
  };
}

