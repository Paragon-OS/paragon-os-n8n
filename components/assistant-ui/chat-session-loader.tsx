/**
 * Chat Session Loader
 * Loads messages from Supabase when a session is selected
 * Refactored to use Zustand store for cleaner state management
 */

"use client";

import { useEffect } from "react";
import { useChatMessages } from "@/lib/supabase/hooks/use-chat-messages";
import { useAssistantRuntime } from "@assistant-ui/react";
import { useSessionStore } from "@/lib/stores/session-store";
import { useThreadLoaderStore } from "@/lib/stores/thread-loader-store";
import { isNil } from "lodash";

export function ChatSessionLoader() {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const { messages, isLoading } = useChatMessages({
    sessionId: activeSessionId,
    enabled: !!activeSessionId,
  });
  const runtime = useAssistantRuntime();
  
  // Zustand store actions
  const { loadMessagesIntoThread, resetThread, lastLoadedSessionId } = useThreadLoaderStore();

  // Handle session switching and message loading
  useEffect(() => {
    console.log(`[chat-session-loader] Effect triggered - activeSessionId: ${activeSessionId}, isLoading: ${isLoading}, runtime: ${!!runtime}, messages: ${messages.length}`);
    
    // Early returns for invalid states
    if (isNil(activeSessionId)) {
      console.log("[chat-session-loader] No active session ID, skipping");
      return;
    }
    
    if (isLoading) {
      console.log("[chat-session-loader] Still loading messages, skipping");
      return;
    }
    
    if (isNil(runtime)) {
      console.log("[chat-session-loader] No runtime available, skipping");
      return;
    }

    // Detect session switch
    const isSessionSwitch = lastLoadedSessionId !== activeSessionId;
    
    if (isSessionSwitch) {
      console.log(`[chat-session-loader] Session switch: ${lastLoadedSessionId} → ${activeSessionId}`);
      // Reset thread for new session
      resetThread({ sessionId: activeSessionId, runtime });
    }

    console.log(`[chat-session-loader] Loading ${messages.length} messages for session: ${activeSessionId}`);
    
    if (messages.length > 0) {
      console.log("[chat-session-loader] First message to load:", JSON.stringify(messages[0]));
    }
    
    // Load messages into thread
    loadMessagesIntoThread({
      sessionId: activeSessionId,
      messages,
      runtime,
    });
  }, [activeSessionId, messages, isLoading, runtime, lastLoadedSessionId, loadMessagesIntoThread, resetThread]);

  return null;
}

