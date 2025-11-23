/**
 * Chat Sessions Context
 * Provides chat session management and realtime sync
 */

"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { useChatSessions } from "@/lib/supabase/hooks/use-chat-sessions";
import type { ChatSessionRow } from "@/lib/supabase/supabase-chat";
import { useSessionStore } from "@/lib/stores/session-store";

interface ChatSessionsContextValue {
  sessions: ChatSessionRow[];
  isLoading: boolean;
  error: Error | null;
  activeSessionId: string | null;
  setActiveSessionId: (sessionId: string | null) => void;
  createNewSession: () => string;
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
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const { sessions, isLoading, error, refetch } = useChatSessions({
    userId,
    enabled: true,
  });
  const setActiveSession = useSessionStore((state) => state.setActiveSession);

  const setActiveSessionId = useCallback((sessionId: string | null) => {
    setActiveSessionIdState(sessionId);
    // Sync with Zustand store, finding the session title from sessions array
    const session = sessionId ? sessions.find((s) => s.session_id === sessionId) : null;
    const sessionTitle = session?.title || null;
    setActiveSession(sessionId, sessionTitle);
  }, [sessions, setActiveSession]);

  // Sync store when sessions are loaded/refetched and we have an active session
  React.useEffect(() => {
    if (activeSessionId && sessions.length > 0) {
      const session = sessions.find((s) => s.session_id === activeSessionId);
      const sessionTitle = session?.title || null;
      setActiveSession(activeSessionId, sessionTitle);
    }
  }, [activeSessionId, sessions, setActiveSession]);

  const createNewSession = useCallback(() => {
    const newSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setActiveSessionId(newSessionId);
    return newSessionId;
  }, [setActiveSessionId]);

  return (
    <ChatSessionsContext.Provider
      value={{
        sessions,
        isLoading,
        error,
        activeSessionId,
        setActiveSessionId,
        createNewSession,
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

