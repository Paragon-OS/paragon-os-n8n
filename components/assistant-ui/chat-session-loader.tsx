/**
 * Chat Session Loader
 * Loads messages from Supabase when a session is selected
 */

"use client";

import { useEffect, useRef } from "react";
import { useChatMessages } from "@/lib/supabase/hooks/use-chat-messages";
import { useAssistantRuntime } from "@assistant-ui/react";
import { useSessionStore } from "@/lib/stores/session-store";

interface NormalizedMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: Array<{ type: string; text: string } | unknown>;
}

/**
 * Normalize a message for Assistant UI
 * Simple, single-pass validation
 */
function normalizeMessage(
  msg: { id?: string; role?: string; content?: unknown },
  index: number,
  sessionId: string
): NormalizedMessage | null {
  // Generate ID if missing
  const id = msg.id || `msg-${sessionId}-${index}-${Date.now()}`;
  
  // Validate role
  const role = msg.role;
  if (!role || !["user", "assistant", "system", "tool"].includes(role)) {
    return null;
  }

  // Normalize content - convert strings to array format
  let content: Array<{ type: string; text: string } | unknown> = [];
  if (typeof msg.content === "string") {
    content = [{ type: "text", text: msg.content }];
  } else if (Array.isArray(msg.content)) {
    // Filter out nulls and ensure proper structure
    content = msg.content
      .filter((part: unknown) => part != null)
      .map((part: unknown) => {
        if (typeof part === "string") {
          return { type: "text", text: part };
        }
        return part;
      });
  }

  // Skip messages without content
  if (!content || content.length === 0) {
    return null;
  }

  return { id, role: role as "user" | "assistant" | "system" | "tool", content };
}

export function ChatSessionLoader() {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const { messages, isLoading } = useChatMessages({
    sessionId: activeSessionId,
    enabled: !!activeSessionId,
  });
  const runtime = useAssistantRuntime();
  const lastSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Wait for messages to load
    if (!activeSessionId || isLoading) {
      return;
    }

    const thread = runtime.thread;
    // Check if thread supports import() method
    const threadWithImport = thread as { import?: (data: { messages: unknown[] }) => void; reset: () => void };
    if (!thread || typeof threadWithImport.import !== "function") {
      console.error("[chat-session-loader] Thread does not support import()");
      return;
    }

    // Check if we're switching sessions
    const isSessionSwitch = lastSessionIdRef.current !== activeSessionId;
    
    if (isSessionSwitch) {
      // Reset thread when switching sessions
      console.log(`[chat-session-loader] Switching to session: ${activeSessionId}`);
      thread.reset();
      lastSessionIdRef.current = activeSessionId;
    }

    // Normalize messages
    const normalizedMessages = messages
      .map((msg, idx) => normalizeMessage(msg, idx, activeSessionId))
      .filter((msg): msg is NonNullable<typeof msg> => msg !== null);

    if (normalizedMessages.length === 0) {
      return;
    }

    // Import messages (won't trigger responses)
    try {
      threadWithImport.import({ messages: normalizedMessages });
      console.log(`[chat-session-loader] Imported ${normalizedMessages.length} messages`);
    } catch (error) {
      console.error("[chat-session-loader] Error importing messages:", error);
    }
  }, [activeSessionId, messages, isLoading, runtime]);

  return null;
}

