/**
 * Chat Session Loader
 * Loads messages from Supabase when a session is selected
 */

"use client";

import { useEffect, useRef } from "react";
import { useChatMessages } from "@/lib/supabase/hooks/use-chat-messages";
import { useChatSessionsContext } from "@/components/assistant-ui/chat-sessions-context";
import { useAssistantRuntime, useAssistantState } from "@assistant-ui/react";
import type { UIMessage } from "ai";
import { setIsLoadingHistoricalMessages } from "@/lib/chat-transport";

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
  const currentMessages = useAssistantState((state) => state.thread.messages);

  useEffect(() => {
    // Only load if we have a session, messages are loaded, and it's a different session
    if (!activeSessionId || isLoading) {
      return;
    }

    // If this is the same session we already loaded, skip
    if (lastLoadedSessionId.current === activeSessionId) {
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

      // Always reset the thread first when switching sessions to ensure clean state
      if (lastLoadedSessionId.current !== null && lastLoadedSessionId.current !== activeSessionId) {
        console.log("[chat-session-loader] Resetting thread for new session");
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
        
        // Mark session as historical BEFORE loading to prevent any reconnection attempts
        // This ensures reconnectToStream is blocked even if called asynchronously during append
        setIsLoadingHistoricalMessages(true, activeSessionId);
        
        try {
          // Load messages into the thread
          // Note: We reset the thread first to ensure clean state and prevent resubmission
          if (typeof thread.append === 'function') {
            // Convert and append each message - the reset above ensures we start fresh
            messages.forEach((message) => {
              const appendMessage = convertMessageForAppend(message);
              thread.append(appendMessage as Parameters<typeof thread.append>[0]);
            });
            console.log("[chat-session-loader] Used append to load messages (after reset to prevent resubmission)");
          } else {
            console.error("[chat-session-loader] thread.append is not available. Available methods:", Object.keys(thread));
          }
        } catch (err) {
          console.error("[chat-session-loader] Error loading messages into thread:", err);
        } finally {
          // Clear the loading flag but KEEP the session marked as historical
          // This ensures reconnectToStream continues to be blocked for this session
          // The session will only be unmarked when user sends a NEW message
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setTimeout(() => {
                // Pass the sessionId so it gets marked as historical
                setIsLoadingHistoricalMessages(false, activeSessionId);
                console.log("[chat-session-loader] Cleared loading flag, session marked as historical:", activeSessionId);
              }, 1000); // Increased delay to catch all async reconnectToStream calls
            });
          });
        }

        lastLoadedSessionId.current = activeSessionId;
        console.log("[chat-session-loader] Successfully loaded messages for session:", activeSessionId);
      } else {
        // Even if no messages, mark this session as loaded
        lastLoadedSessionId.current = activeSessionId;
        console.log("[chat-session-loader] No messages for session:", activeSessionId);
      }
    } catch (error) {
      console.error("[chat-session-loader] Error loading session:", error);
      // Make sure to clear the flag on error, but still mark as historical if we had messages
      if (messages.length > 0 && activeSessionId) {
        setIsLoadingHistoricalMessages(false, activeSessionId);
      } else {
        setIsLoadingHistoricalMessages(false, null);
      }
    }
  }, [activeSessionId, isLoading, messages, runtime, currentMessages]);

  // Reset when session changes
  useEffect(() => {
    if (lastLoadedSessionId.current !== activeSessionId) {
      lastLoadedSessionId.current = null;
    }
  }, [activeSessionId]);

  return null; // This component doesn't render anything
}

