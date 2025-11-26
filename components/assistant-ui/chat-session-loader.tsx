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
  // IMPORTANT: Use selector function to extract activeSessionId from Zustand store
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
    console.log(`😎 [chat-session-loader] 🔄 Effect triggered!`);
    console.log(`😎 [chat-session-loader] - activeSessionId: ${activeSessionId}`);
    console.log(`😎 [chat-session-loader] - isLoading: ${isLoading}`);
    console.log(`😎 [chat-session-loader] - runtime exists: ${!!runtime}`);
    console.log(`😎 [chat-session-loader] - messages count: ${messages.length}`);
    console.log(`😎 [chat-session-loader] - lastLoadedSessionId: ${lastLoadedSessionId}`);
    
    // Early returns for invalid states
    if (isNil(activeSessionId)) {
      console.log("😎 [chat-session-loader] ⚠️ No active session ID, skipping");
      return;
    }
    
    if (isLoading) {
      console.log("😎 [chat-session-loader] ⏳ Still loading messages, skipping");
      return;
    }
    
    if (isNil(runtime)) {
      console.log("😎 [chat-session-loader] ❌ No runtime available, skipping");
      return;
    }

    // Detect session switch
    const isSessionSwitch = lastLoadedSessionId !== activeSessionId;
    
    if (isSessionSwitch) {
      console.log(`😎 [chat-session-loader] 🔄 Session switch detected: ${lastLoadedSessionId} → ${activeSessionId}`);
      // Reset thread for new session
      resetThread({ sessionId: activeSessionId, runtime });
    } else {
      console.log(`😎 [chat-session-loader] ✅ Same session: ${activeSessionId}`);
    }

    console.log(`😎 [chat-session-loader] 📨 Loading ${messages.length} messages for session: ${activeSessionId}`);
    
    if (messages.length > 0) {
      console.log("😎 [chat-session-loader] First message to load:", JSON.stringify(messages[0]));
    } else {
      console.log("😎 [chat-session-loader] ⚠️ No messages to load!");
    }
    
    // Load messages into thread
    console.log("😎 [chat-session-loader] 🚀 Calling loadMessagesIntoThread...");
    loadMessagesIntoThread({
      sessionId: activeSessionId,
      messages,
      runtime,
    });
  }, [activeSessionId, messages, isLoading, runtime, lastLoadedSessionId, loadMessagesIntoThread, resetThread]);

  return null;
}

