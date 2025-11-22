/**
 * React hook for fetching and syncing chat messages with Supabase Realtime
 */

import { useEffect, useState, useCallback } from "react";
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

  const fetchMessages = useCallback(async () => {
    if (!sessionId) {
      setMessages([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const fetchedMessages = await getChatMessagesBySessionId({
        sessionId,
        limit,
        offset,
      });

      console.log("[use-chat-messages] Fetched", fetchedMessages.length, "messages for session:", sessionId);
      setMessages(fetchedMessages);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error("[use-chat-messages] Error fetching messages:", error);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, limit, offset]);

  useEffect(() => {
    if (!enabled || !sessionId) {
      setIsLoading(false);
      setMessages([]);
      return;
    }

    console.log("[use-chat-messages] Fetching messages for session:", sessionId);
    fetchMessages();

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
          console.log("[use-chat-messages] Realtime event:", payload.eventType);

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
      .subscribe((status) => {
        console.log("[use-chat-messages] Subscription status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, sessionId, fetchMessages]);

  return {
    messages,
    isLoading,
    error,
    refetch: fetchMessages,
  };
}

