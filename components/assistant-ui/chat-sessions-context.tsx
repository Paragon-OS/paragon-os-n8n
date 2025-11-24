/**
 * Chat Sessions Context
 * Provides chat session management and realtime sync
 */

"use client";

import React, { createContext, useContext, useCallback } from "react";
import { useChatSessions } from "@/lib/supabase/hooks/use-chat-sessions";
import type { ChatSessionRow } from "@/lib/supabase/supabase-chat";
import { deleteChatSession } from "@/lib/supabase/supabase-chat";
import { useSessionStore } from "@/lib/stores/session-store";

interface ChatSessionsContextValue {
  sessions: ChatSessionRow[];
  isLoading: boolean;
  error: Error | null;
  activeSessionId: string | null;
  setActiveSessionId: (sessionId: string | null) => void;
  createNewSession: () => string;
  deleteSession: (sessionId: string) => Promise<boolean>;
  refetch: () => Promise<void>;
}

const ChatSessionsContext = createContext<ChatSessionsContextValue | null>(
  null
);

export interface ChatSessionsProviderProps {
  children: React.ReactNode;
  userId?: string;
}

export function ChatSessionsProvider({
  children,
  userId,
}: ChatSessionsProviderProps) {
  // Read activeSessionId from Zustand store (single source of truth)
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const { sessions, isLoading, error, refetch } = useChatSessions({
    userId,
    enabled: true,
  });
  const setActiveSession = useSessionStore((state) => state.setActiveSession);
  const clearActiveSession = useSessionStore((state) => state.clearActiveSession);

  // Update Zustand store when session is set, syncing the title from sessions
  const setActiveSessionId = useCallback((sessionId: string | null) => {
    console.log("[chat-sessions-context] setActiveSessionId called with:", sessionId);
    console.log("[chat-sessions-context] Current activeSessionId:", activeSessionId);
    const session = sessionId ? sessions.find((s) => s.session_id === sessionId) : null;
    const sessionTitle = session?.title || null;
    console.log("[chat-sessions-context] Setting session:", sessionId, "title:", sessionTitle);
    setActiveSession(sessionId, sessionTitle);
  }, [sessions, setActiveSession, activeSessionId]);

  const createNewSession = useCallback(() => {
    const newSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log("[chat-sessions-context] createNewSession called, creating:", newSessionId);
    console.log("[chat-sessions-context] Current activeSessionId before creation:", activeSessionId);
    setActiveSessionId(newSessionId);
    console.log("[chat-sessions-context] New session created and set:", newSessionId);
    return newSessionId;
  }, [setActiveSessionId, activeSessionId]);

  const deleteSession = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      // Delete the session (messages and stream_events will be cascade deleted)
      const success = await deleteChatSession(sessionId);
      
      if (!success) {
        return false;
      }

      // Clear active session if it's the one being deleted
      if (activeSessionId === sessionId) {
        clearActiveSession();
      }

      // Refetch sessions to update the list
      await refetch();

      return true;
    } catch (error) {
      console.error("[chat-sessions-context] Error deleting session:", error);
      return false;
    }
  }, [activeSessionId, clearActiveSession, refetch]);

  return (
    <ChatSessionsContext.Provider
      value={{
        sessions,
        isLoading,
        error,
        activeSessionId,
        setActiveSessionId,
        createNewSession,
        deleteSession,
        refetch,
      }}
    >
      {children}
    </ChatSessionsContext.Provider>
  );
}

export function useChatSessionsContext() {
  const context = useContext(ChatSessionsContext);
  if (!context) {
    throw new Error(
      "useChatSessionsContext must be used within ChatSessionsProvider"
    );
  }
  return context;
}

