/**
 * Chat Session Loader
 * Loads messages from Supabase when a session is selected
 */

"use client";

import { useEffect, useRef } from "react";
import { useChatMessages } from "@/lib/supabase/hooks/use-chat-messages";
import { useChatSessionsContext } from "@/components/assistant-ui/chat-sessions-context";
import { useAssistantRuntime } from "@assistant-ui/react";
import type { UIMessage } from "ai";
import { markSessionAsHistorical } from "@/lib/chat-transport";

/**
 * Convert UIMessage to format expected by thread.append()
 * The append method expects content as an array of message parts
 */
function convertMessageForAppend(message: UIMessage): { role: string; content: unknown[]; id?: string } {
  const messageRecord = message as unknown as Record<string, unknown>;
  
  // Extract content - can be string, array, or object
  const content: unknown = messageRecord.content ?? messageRecord.parts;
  
  // Convert content to array format expected by append
  let contentArray: unknown[];
  if (typeof content === "string") {
    contentArray = [{ type: "text", text: content }];
  } else if (Array.isArray(content)) {
    contentArray = content;
  } else if (content && typeof content === "object") {
    contentArray = [content];
  } else {
    contentArray = [{ type: "text", text: "" }];
  }

  return {
    role: message.role,
    content: contentArray,
    id: message.id,
  };
}

export function ChatSessionLoader() {
  const { activeSessionId } = useChatSessionsContext();
  const { messages, isLoading } = useChatMessages({
    sessionId: activeSessionId,
    enabled: !!activeSessionId,
  });
  const runtime = useAssistantRuntime();
  const lastLoadedSessionId = useRef<string | null>(null);
  const lastLoadedMessageCount = useRef<number>(0);

  useEffect(() => {
    console.log("[chat-session-loader] Effect triggered", {
      activeSessionId,
      isLoading,
      messagesCount: messages.length,
      lastLoaded: lastLoadedSessionId.current,
      lastMessageCount: lastLoadedMessageCount.current,
    });

    // Only load if we have a session and messages are loaded
    if (!activeSessionId || isLoading) {
      console.log("[chat-session-loader] Skipping - no session or still loading", {
        activeSessionId,
        isLoading,
      });
      return;
    }

    // Skip if this is the same session AND we've already loaded these exact messages
    const isSameSession = lastLoadedSessionId.current === activeSessionId;
    const isSameMessageCount = lastLoadedMessageCount.current === messages.length;
    if (isSameSession && isSameMessageCount) {
      console.log("[chat-session-loader] Skipping - already loaded this session with same message count");
      return;
    }

    console.log("[chat-session-loader] Processing session:", activeSessionId, "messages:", messages.length);

    try {
      // Get the current thread from runtime
      const thread = runtime.thread;
      
      if (!thread) {
        console.error("[chat-session-loader] Could not get thread");
        return;
      }

      // Reset the thread when switching to a different session OR when message count changed
      const previousSessionId = lastLoadedSessionId.current;
      const shouldReset = previousSessionId !== null && 
                          (previousSessionId !== activeSessionId || !isSameMessageCount);
      
      if (shouldReset) {
        console.log("[chat-session-loader] Resetting thread", {
          reason: previousSessionId !== activeSessionId ? "session switch" : "message count changed",
          from: previousSessionId,
          to: activeSessionId,
          prevCount: lastLoadedMessageCount.current,
          newCount: messages.length,
        });
        try {
          if (typeof thread.reset === 'function') {
            thread.reset();
          }
        } catch (err) {
          console.warn("[chat-session-loader] Could not reset thread, continuing anyway:", err);
        }
      }

      if (messages.length > 0) {
        console.log("[chat-session-loader] Loading", messages.length, "messages for session:", activeSessionId);
        // Mark session as historical BEFORE loading to prevent reconnectToStream
        // This ensures reconnectToStream is blocked even if called during append
        markSessionAsHistorical(activeSessionId);
        
        try {
          // Load messages into the thread using append
          if (typeof thread.append === 'function') {
            // Convert and append each message
            messages.forEach((message, index) => {
              const appendMessage = convertMessageForAppend(message);
              console.log("[chat-session-loader] Appending message", index + 1, "of", messages.length, message.id);
              thread.append(appendMessage as Parameters<typeof thread.append>[0]);
            });
            console.log("[chat-session-loader] Successfully appended all messages");
          } else {
            console.error("[chat-session-loader] thread.append is not available. Available methods:", Object.keys(thread));
          }
        } catch (err) {
          console.error("[chat-session-loader] Error loading messages into thread:", err);
        }
      } else {
        console.log("[chat-session-loader] No messages for session:", activeSessionId);
      }

      // Mark this session as loaded with the current message count
      lastLoadedSessionId.current = activeSessionId;
      lastLoadedMessageCount.current = messages.length;
      console.log("[chat-session-loader] Marked session as loaded:", activeSessionId, "with", messages.length, "messages");
    } catch (error) {
      console.error("[chat-session-loader] Error loading session:", error);
    }
  }, [activeSessionId, isLoading, messages, runtime]);

  return null; // This component doesn't render anything
}

