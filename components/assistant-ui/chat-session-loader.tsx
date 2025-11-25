/**
 * Chat Session Loader
 * Loads messages from Supabase when a session is selected
 */

"use client";

import { useEffect, useRef } from "react";
import { useChatMessages } from "@/lib/supabase/hooks/use-chat-messages";
import { useAssistantRuntime, useAssistantState } from "@assistant-ui/react";
import { useSessionStore } from "@/lib/stores/session-store";
import {
  checkMessagesAlreadyLoaded,
  cleanMessages,
  validateMessageStructure,
  cleanMessageContent,
  type ValidatedMessage,
} from "@/lib/chat/message-validation";
import { MessageLoaderService } from "@/lib/chat/services/message-loader";

export function ChatSessionLoader() {
  // Use Zustand store as single source of truth for activeSessionId
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const { messages, isLoading } = useChatMessages({
    sessionId: activeSessionId,
    enabled: !!activeSessionId,
  });
  const runtime = useAssistantRuntime();
  const lastLoadedSessionId = useRef<string | null>(null);
  const isLoadingRef = useRef(false); // Track if we're currently loading to prevent concurrent loads
  const currentMessages = useAssistantState((state) => state.thread.messages);
  const messageLoader = new MessageLoaderService();

  useEffect(() => {
    // Only load if we have a session and messages are loaded
    if (!activeSessionId || isLoading) {
      return;
    }

    // If we're already loading, skip to prevent concurrent loads
    if (isLoadingRef.current) {
      return;
    }

    // Check if this is a session switch (different session) or new messages in same session
    const isSessionSwitch = lastLoadedSessionId.current !== null && lastLoadedSessionId.current !== activeSessionId;
    const isSameSession = lastLoadedSessionId.current === activeSessionId;
    const isFirstLoad = lastLoadedSessionId.current === null;
    
    // If same session (not first load, not switching), check if there are new messages
    if (isSameSession && messages.length > 0) {
      const currentMessageIds = new Set((currentMessages || []).map((m) => m?.id).filter(Boolean));
      const newMessageIds = new Set(messages.map((m) => m?.id).filter(Boolean));
      
      // Check if all messages are already loaded
      const allMessagesLoaded = newMessageIds.size === currentMessageIds.size && 
                                Array.from(newMessageIds).every(id => currentMessageIds.has(id));
      
      if (allMessagesLoaded) {
        // All messages already loaded, skip
        return;
      }
      
      // There are new messages, continue to import them
      console.log(`[chat-session-loader] Same session but ${newMessageIds.size - currentMessageIds.size} new message(s) detected, will import`);
    } else if (isSameSession && messages.length === 0) {
      // Same session, no messages - skip
      return;
    }
    
    // For first load or session switch, continue to load messages
    // (isFirstLoad || isSessionSwitch cases fall through)


    try {
      // Get the current thread from runtime
      const thread = runtime.thread;
      
      if (!thread) {
        console.error("[chat-session-loader] Could not get thread");
        return;
      }

      if (messages.length > 0) {
        
        // Load messages into thread using runtime API
        const currentThreadMessages = currentMessages || [];
        
        // Check if messages are already loaded (avoid duplicate loading)
        const messagesAlreadyLoaded = checkMessagesAlreadyLoaded(
          currentThreadMessages,
          messages
        );

        if (!messagesAlreadyLoaded) {
          // Set loading flag to prevent concurrent loads
          isLoadingRef.current = true;
          
          // Load messages into thread using import() - this is the ONLY safe method for historical messages
          // import() marks messages as historical and does NOT trigger responses
          try {
            // Validate and normalize messages before importing using extracted validation functions
            const validatedMessages = cleanMessages(messages, {
              sessionId: activeSessionId,
              generateIdIfMissing: true,
            });

            if (validatedMessages.length === 0) {
              lastLoadedSessionId.current = activeSessionId;
              return;
            }

            // CRITICAL: Always use import() for ALL messages from Supabase
            // All messages from Supabase are historical and should NOT trigger responses
            // Never use append() as it will trigger responses for historical messages
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const threadAny = thread as any;

            // Check if thread supports import() - this is the only safe way to load historical messages
            if (typeof threadAny.import !== "function") {
              console.error("[chat-session-loader] Thread runtime does not support import(). Cannot load historical messages safely.");
              lastLoadedSessionId.current = activeSessionId;
              return;
            }

            // Final validation: Deep check each message before import
            const validatedImportMessages = validatedMessages.filter((msg, index): msg is ValidatedMessage => {
              return validateMessageStructure(msg, index);
            });
            
            if (validatedImportMessages.length === 0) {
              console.error("[chat-session-loader] All messages failed validation, cannot import");
              isLoadingRef.current = false;
              return;
            }
            
            if (validatedImportMessages.length !== validatedMessages.length) {
              console.warn(`[chat-session-loader] Filtered out ${validatedMessages.length - validatedImportMessages.length} invalid messages before import`);
            }
            
            // Final validation: Clean content/parts arrays to remove null/undefined and ensure proper structure
            const finalCleanedMessages = validatedImportMessages.map((msg) => cleanMessageContent(msg));
            
            try {
              // Use MessageLoaderService to load messages into thread
              await messageLoader.loadMessagesIntoThread(
                thread,
                finalCleanedMessages,
                currentThreadMessages as ValidatedMessage[],
                lastLoadedSessionId.current,
                activeSessionId
              );
              
              // Mark session as loaded immediately after successful import
              lastLoadedSessionId.current = activeSessionId;
            } catch (importErr) {
              // CRITICAL: Do NOT fallback to append() - it will trigger responses for historical messages
              // If import() fails, log error and skip loading rather than risking duplicate responses
              console.error("[chat-session-loader] CRITICAL: Error during import() - NOT falling back to append() to prevent duplicate responses");
              console.error("[chat-session-loader] Error details:", importErr);
              console.error("[chat-session-loader] Error type:", importErr instanceof Error ? importErr.constructor.name : typeof importErr);
              console.error("[chat-session-loader] Error message:", importErr instanceof Error ? importErr.message : String(importErr));
              console.error("[chat-session-loader] Error stack:", importErr instanceof Error ? importErr.stack : "N/A");
              console.error("[chat-session-loader] Messages count:", finalCleanedMessages.length);
              console.error("[chat-session-loader] First message:", finalCleanedMessages[0]);
              console.error("[chat-session-loader] Last message:", finalCleanedMessages[finalCleanedMessages.length - 1]);
              console.error("[chat-session-loader] First message content:", JSON.stringify(finalCleanedMessages[0]?.content, null, 2));
              console.error("[chat-session-loader] First message parts:", JSON.stringify(finalCleanedMessages[0]?.parts, null, 2));
              console.error("[chat-session-loader] Last message content:", JSON.stringify(finalCleanedMessages[finalCleanedMessages.length - 1]?.content, null, 2));
              console.error("[chat-session-loader] Last message parts:", JSON.stringify(finalCleanedMessages[finalCleanedMessages.length - 1]?.parts, null, 2));
              // Log each message individually to identify the problematic one
              finalCleanedMessages.forEach((msg, idx) => {
                try {
                  // Try to serialize each message to catch any serialization issues
                  JSON.stringify(msg);
                } catch (serializeErr) {
                  console.error(`[chat-session-loader] Message at index ${idx} cannot be serialized:`, serializeErr, msg);
                }
              });
              // Don't mark as loaded so we can retry on next effect run
              // But clear loading flag to allow retry
              isLoadingRef.current = false;
            }
          } catch (err) {
            console.error("[chat-session-loader] Error loading messages into thread:", err);
            console.error("[chat-session-loader] Messages that caused error:", messages);
          } finally {
            // Always clear loading flag and mark session as loaded
            isLoadingRef.current = false;
            lastLoadedSessionId.current = activeSessionId;
          }
        } else {
          // Messages already loaded, just mark session as loaded
          lastLoadedSessionId.current = activeSessionId;
        }
      } else {
        // Even if no messages, mark this session as loaded
        isLoadingRef.current = false;
        lastLoadedSessionId.current = activeSessionId;
      }
    } catch (error) {
      console.error("[chat-session-loader] Error loading session:", error);
    }
  }, [activeSessionId, isLoading, messages, runtime, currentMessages]);

  // Reset when session changes
  useEffect(() => {
    if (lastLoadedSessionId.current !== activeSessionId) {
      lastLoadedSessionId.current = null;
      isLoadingRef.current = false;
    }
  }, [activeSessionId]);

  return null; // This component doesn't render anything
}

