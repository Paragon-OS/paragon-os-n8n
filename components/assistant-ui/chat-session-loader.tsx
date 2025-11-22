/**
 * Chat Session Loader
 * Loads messages from Supabase when a session is selected
 */

"use client";

import { useEffect } from "react";
import { useChatMessages } from "@/lib/supabase/hooks/use-chat-messages";
import { useChatSessionsContext } from "@/components/assistant-ui/chat-sessions-context";
import { useAssistantRuntime } from "@assistant-ui/react";

export function ChatSessionLoader() {
  const { activeSessionId } = useChatSessionsContext();
  const { messages, isLoading } = useChatMessages({
    sessionId: activeSessionId,
    enabled: !!activeSessionId,
  });
  const runtime = useAssistantRuntime();

  useEffect(() => {
    if (!activeSessionId || isLoading || messages.length === 0) {
      return;
    }

    // Load messages into the assistant runtime
    // Note: This is a simplified approach - you may need to adjust based on
    // how the assistant-ui library handles message loading
    console.log("[chat-session-loader] Loading messages for session:", activeSessionId, messages.length);
    
    // The assistant-ui library manages its own state, so we'll need to
    // integrate with it properly. For now, we'll just log that messages are available.
    // In a full implementation, you'd need to use the runtime's methods to set messages.
  }, [activeSessionId, isLoading, messages, runtime]);

  return null; // This component doesn't render anything
}

