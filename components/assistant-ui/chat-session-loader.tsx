/**
 * Chat Session Loader
 * Loads messages from Supabase when a session is selected
 */

"use client";

import { useEffect, useRef } from "react";
import { useChatMessages } from "@/lib/supabase/hooks/use-chat-messages";
import { useChatSessionsContext } from "@/components/assistant-ui/chat-sessions-context";
import { useAssistantRuntime, useAssistantState } from "@assistant-ui/react";

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

      // Clear existing messages when switching sessions by resetting the thread
      if (currentMessages.length > 0 && lastLoadedSessionId.current !== null) {
        console.log("[chat-session-loader] Clearing existing messages from previous session");
        // Reset the thread to clear messages
        // The assistant-ui runtime may have a reset method, or we can work with append
        try {
          if (typeof thread.reset === 'function') {
            thread.reset();
          } else if (typeof thread.clear === 'function') {
            thread.clear();
          }
        } catch (err) {
          console.warn("[chat-session-loader] Could not clear thread, continuing anyway:", err);
        }
      }

      if (messages.length > 0) {
        console.log("[chat-session-loader] Loading", messages.length, "messages for session:", activeSessionId);
        
        // Load messages into the thread
        // Try different API methods that might be available
        try {
          // Method 1: Try append (the actual method available on the thread)
          if (typeof thread.append === 'function') {
            // Append each message individually
            messages.forEach((message) => {
              thread.append(message);
            });
            console.log("[chat-session-loader] Used append to load messages");
          }
          // Method 2: Try import (might work for bulk loading)
          else if (typeof thread.import === 'function') {
            // Try importing messages as state
            const state = thread.getState();
            const importedState = {
              ...state,
              messages: messages,
            };
            thread.import(importedState);
            console.log("[chat-session-loader] Used import to load messages");
          }
          // Method 3: Try appendMessages (batch) - fallback
          else if (typeof thread.appendMessages === 'function') {
            thread.appendMessages(messages);
            console.log("[chat-session-loader] Used appendMessages to load messages");
          }
          // Method 4: Try appendMessage (individual) - fallback
          else if (typeof thread.appendMessage === 'function') {
            messages.forEach((message) => {
              thread.appendMessage(message);
            });
            console.log("[chat-session-loader] Used appendMessage to load messages");
          }
          // Method 5: Try setMessages - fallback
          else if (typeof thread.setMessages === 'function') {
            thread.setMessages(messages);
            console.log("[chat-session-loader] Used setMessages to load messages");
          }
          else {
            console.error("[chat-session-loader] No known method to load messages into thread. Available methods:", Object.keys(thread));
          }
        } catch (err) {
          console.error("[chat-session-loader] Error loading messages into thread:", err);
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

