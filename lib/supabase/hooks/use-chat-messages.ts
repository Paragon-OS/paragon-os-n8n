/**
 * React hook for fetching and syncing chat messages with Supabase Realtime
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { createSupabaseClient } from "../supabase-config";
import {
  getChatMessagesBySessionId,
  convertRowToUIMessage,
  type UIMessage,
} from "../supabase-chat";

export interface UseChatMessagesOptions {
  sessionId: string | null;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}

export interface UseChatMessagesReturn {
  messages: UIMessage[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and sync chat messages for a session with Supabase Realtime
 */
export function useChatMessages(
  options: UseChatMessagesOptions
): UseChatMessagesReturn {
  const {
    sessionId,
    limit = 100,
    offset = 0,
    enabled = true,
  } = options;

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);
  
  // Use ref to store latest fetch function to avoid dependency issues
  const fetchMessagesRef = useRef<(() => Promise<void>) | undefined>(undefined);
  
  // Ref to store debounce timeout for realtime events
  const refetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchMessages = useCallback(async () => {
    if (!sessionId) {
      if (isMountedRef.current) {
        setMessages([]);
        setIsLoading(false);
      }
      return;
    }

    try {
      if (isMountedRef.current) {
        setIsLoading(true);
        setError(null);
      }

      const fetchedMessages = await getChatMessagesBySessionId({
        sessionId,
        limit,
        offset,
      });

      if (isMountedRef.current) {
        setMessages(fetchedMessages);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        console.error("[use-chat-messages] Error fetching messages:", error);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [sessionId, limit, offset]);

  // Update ref whenever fetchMessages changes
  fetchMessagesRef.current = fetchMessages;

  useEffect(() => {
    // Reset mounted flag on mount
    isMountedRef.current = true;

    if (!enabled || !sessionId) {
      if (isMountedRef.current) {
        setIsLoading(false);
        setMessages([]);
      }
      return;
    }

    // Fetch messages using ref to avoid dependency issues
    fetchMessagesRef.current?.();

    const supabase = createSupabaseClient();
    if (!supabase) {
      return;
    }

    // Set up realtime subscription for chat_messages
    // CRITICAL: Instead of updating state directly, refetch from DB to ensure consistency
    // This prevents race conditions and ensures messages are loaded in correct order
    // The ChatSessionLoader will handle importing new messages safely using import()
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
        (payload) => {
          // Guard against state updates after unmount
          if (!isMountedRef.current) return;

          // CRITICAL FIX: Instead of updating state directly, refetch from DB
          // This ensures:
          // 1. Messages are in correct order (sorted by created_at)
          // 2. No duplicate messages
          // 3. ChatSessionLoader will handle import safely (now always uses import())
          // 4. Prevents race conditions between realtime updates and loader
          console.log(`[use-chat-messages] Realtime event: ${payload.eventType}, scheduling refetch from DB`);
          
          // Clear any pending refetch timeout
          if (refetchTimeoutRef.current) {
            clearTimeout(refetchTimeoutRef.current);
          }
          
          // Debounce refetch to avoid too many requests if multiple events come quickly
          // Use a small delay to batch multiple rapid updates
          refetchTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current && fetchMessagesRef.current) {
              console.log(`[use-chat-messages] Executing debounced refetch after realtime event`);
              fetchMessagesRef.current();
            }
            refetchTimeoutRef.current = null;
          }, 100); // 100ms debounce
        }
      )
      .subscribe();

    return () => {
      // Mark as unmounted and clean up subscription
      isMountedRef.current = false;
      
      // Clear any pending refetch timeout
      if (refetchTimeoutRef.current) {
        clearTimeout(refetchTimeoutRef.current);
        refetchTimeoutRef.current = null;
      }
      
      supabase.removeChannel(channel);
    };
  }, [enabled, sessionId]); // Removed fetchMessages from dependencies

  return {
    messages,
    isLoading,
    error,
    refetch: fetchMessages,
  };
}

