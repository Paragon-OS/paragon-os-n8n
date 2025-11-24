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

          if (payload.eventType === "INSERT") {
            const newMessage = convertRowToUIMessage(
              payload.new as Parameters<typeof convertRowToUIMessage>[0]
            );
            setMessages((prev) => {
              // Avoid duplicates
              if (prev.some((m) => m.id === newMessage.id)) {
                return prev;
              }
              // Add to end and sort by timestamp (assuming created_at order)
              return [...prev, newMessage].sort((a, b) => {
                // Try to maintain order - new messages go to end
                return prev.indexOf(a) - prev.indexOf(b);
              });
            });
          } else if (payload.eventType === "UPDATE") {
            const updatedMessage = convertRowToUIMessage(
              payload.new as Parameters<typeof convertRowToUIMessage>[0]
            );
            setMessages((prev) =>
              prev.map((m) => (m.id === updatedMessage.id ? updatedMessage : m))
            );
          } else if (payload.eventType === "DELETE") {
            const deletedMessage = payload.old as { message_id?: string; id?: string };
            const messageId = deletedMessage.message_id || deletedMessage.id;
            if (messageId) {
              setMessages((prev) => prev.filter((m) => m.id !== messageId));
            }
          }
        }
      )
      .subscribe();

    return () => {
      // Mark as unmounted and clean up subscription
      isMountedRef.current = false;
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

