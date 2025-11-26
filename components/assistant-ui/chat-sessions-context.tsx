/**
 * Chat Sessions Context
 * Provides chat session management and realtime sync
 */

"use client";

import React, { createContext, useContext, useCallback } from "react";
import { useChatSessions } from "@/lib/supabase/hooks/use-chat-sessions";
import type { ChatSessionRow } from "@/lib/supabase/supabase-chat";
import { useSessionStore } from "@/lib/stores/session-store";
import { createSupabaseClient } from "@/lib/supabase/supabase-config";

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
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const setActiveSession = useSessionStore((state) => state.setActiveSession);
  const clearActiveSession = useSessionStore((state) => state.clearActiveSession);
  
  const { sessions, isLoading, error, refetch } = useChatSessions({
    userId,
    enabled: true,
  });

  const setActiveSessionId = useCallback(
    (sessionId: string | null) => {
      if (sessionId) {
        // Find session title from sessions list
        const session = sessions.find((s) => s.id === sessionId);
        setActiveSession(sessionId, session?.title || null);
      } else {
        clearActiveSession();
      }
    },
    [sessions, setActiveSession, clearActiveSession]
  );

  const createNewSession = useCallback(async () => {
    const supabase = createSupabaseClient();
    if (!supabase) {
      throw new Error("Supabase client not available");
    }

    // Generate new session ID
    const newSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create session in database
    const { error: insertError } = await supabase
      .from("chat_sessions")
      .insert({
        id: newSessionId,
        user_id: userId || null,
        title: "New Chat",
      });

    if (insertError) {
      console.error("[chat-sessions-context] Error creating session:", insertError);
      throw insertError;
    }

    // Set as active session
    setActiveSession(newSessionId, "New Chat");
    
    // Refetch to update the sessions list
    await refetch();
    
    return newSessionId;
  }, [userId, setActiveSession, refetch]);

  const deleteSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const supabase = createSupabaseClient();
      if (!supabase) {
        return false;
      }

      try {
        // Delete from database
        const { error: deleteError } = await supabase
          .from("chat_sessions")
          .delete()
          .eq("id", sessionId);

        if (deleteError) {
          console.error("[chat-sessions-context] Error deleting session:", deleteError);
          return false;
        }

        // Clear active session if it's the one being deleted
        if (activeSessionId === sessionId) {
          clearActiveSession();
        }

        // Refetch sessions
        await refetch();
        
        return true;
      } catch (error) {
        console.error("[chat-sessions-context] Error deleting session:", error);
        return false;
      }
    },
    [activeSessionId, clearActiveSession, refetch]
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

