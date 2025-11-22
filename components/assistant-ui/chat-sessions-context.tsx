/**
 * Chat Sessions Context
 * Provides chat session management and realtime sync
 */

"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useChatSessions } from "@/lib/supabase/hooks/use-chat-sessions";
import type { ChatSessionRow } from "@/lib/supabase/supabase-chat";
import { markSessionAsActive } from "@/lib/chat-transport";

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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { sessions, isLoading, error, refetch } = useChatSessions({
    userId,
    enabled: true,
  });

  const createNewSession = useCallback(() => {
    const newSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setActiveSessionId(newSessionId);
    // Mark as active session (not historical) so it can reconnect normally
    markSessionAsActive(newSessionId);
    return newSessionId;
  }, []);

  // Mark active session as active when it changes (if it's not being loaded from history)
  useEffect(() => {
    if (activeSessionId) {
      // Only mark as active if it's not in the sessions list (truly new)
      // If it's in the list, it will be marked as historical when loaded
      const isExistingSession = sessions.some(s => s.session_id === activeSessionId);
      if (!isExistingSession) {
        markSessionAsActive(activeSessionId);
      }
    }
  }, [activeSessionId, sessions]);

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

