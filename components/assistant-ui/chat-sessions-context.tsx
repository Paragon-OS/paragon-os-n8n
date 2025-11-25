/**
 * Chat Sessions Context
 * Provides chat session management and realtime sync
 */

"use client";

import React, { createContext, useContext, useCallback, useMemo } from "react";
import { useChatSessions } from "@/lib/supabase/hooks/use-chat-sessions";
import type { ChatSessionRow } from "@/lib/supabase/supabase-chat";
import { useSessionStore } from "@/lib/stores/session-store";
import { SessionManager } from "@/lib/chat/services/session-manager";
import { SupabaseChatRepository } from "@/lib/chat/repositories/supabase-chat-repository";

interface ChatSessionsContextValue {
  sessions: ChatSessionRow[];
  isLoading: boolean;
  error: Error | null;
  activeSessionId: string | null;
  setActiveSessionId: (sessionId: string | null) => void;
  createNewSession: () => Promise<string>;
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

  // Create session manager with repository and store adapter
  const sessionManager = useMemo(() => {
    const repository = new SupabaseChatRepository();
    const storeAdapter: SessionManager["store"] = {
      getActiveSessionId: () => useSessionStore.getState().activeSessionId,
      setActiveSession: (sessionId, title) => setActiveSession(sessionId, title),
      clearActiveSession: () => clearActiveSession(),
    };
    return new SessionManager(repository, storeAdapter);
  }, [setActiveSession, clearActiveSession]);

  // Update Zustand store when session is set, syncing the title from sessions
  const setActiveSessionId = useCallback(
    async (sessionId: string | null) => {
      console.log("[chat-sessions-context] setActiveSessionId called with:", sessionId);
      console.log("[chat-sessions-context] Current activeSessionId:", activeSessionId);
      if (sessionId) {
        await sessionManager.switchSession(sessionId);
      } else {
        clearActiveSession();
      }
    },
    [sessionManager, activeSessionId, clearActiveSession]
  );

  const createNewSession = useCallback(async () => {
    console.log("[chat-sessions-context] createNewSession called");
    const newSessionId = await sessionManager.createNewSession({
      userId,
    });
    console.log("[chat-sessions-context] New session created and set:", newSessionId);
    // Refetch to update the sessions list
    await refetch();
    return newSessionId;
  }, [sessionManager, userId, refetch]);

  const deleteSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      try {
        const success = await sessionManager.deleteSession(sessionId);
        if (success) {
          // Refetch sessions to update the list
          await refetch();
        }
        return success;
      } catch (error) {
        console.error("[chat-sessions-context] Error deleting session:", error);
        return false;
      }
    },
    [sessionManager, refetch]
  );

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

