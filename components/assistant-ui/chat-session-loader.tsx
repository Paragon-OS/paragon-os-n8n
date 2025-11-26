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
    // Early returns for invalid states
    if (isNil(activeSessionId) || isLoading || isNil(runtime)) {
      return;
    }

    // Detect session switch
    const isSessionSwitch = lastLoadedSessionId !== activeSessionId;
    
    if (isSessionSwitch) {
      // Reset thread for new session
      resetThread({ sessionId: activeSessionId, runtime });
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

