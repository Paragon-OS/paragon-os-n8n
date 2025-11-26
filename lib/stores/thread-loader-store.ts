/**
 * Thread Loader Store
 * Manages thread state and message loading logic
 */

import { create } from "zustand";
import { validateMessages } from "@/lib/chat/message-validation";
import type { UIMessage } from "ai";

// Use a flexible type that matches the actual runtime
type ThreadRuntime = any;

interface ThreadLoaderState {
  // Current state
  lastLoadedSessionId: string | null;
  isImporting: boolean;
  lastError: Error | null;

  // Actions
  loadMessagesIntoThread: (params: {
    sessionId: string;
    messages: UIMessage[];
    runtime: ThreadRuntime;
  }) => void;
  
  resetThread: (params: {
    sessionId: string;
    runtime: ThreadRuntime;
  }) => void;
  
  clearError: () => void;
}

export const useThreadLoaderStore = create<ThreadLoaderState>((set, get) => ({
  lastLoadedSessionId: null,
  isImporting: false,
  lastError: null,

  resetThread: ({ sessionId, runtime }) => {
    try {
      const thread = runtime?.thread;
      
      if (!thread || typeof thread.reset !== "function") {
        throw new Error("Thread does not support reset()");
      }

      console.log(`[thread-loader] Resetting thread for session: ${sessionId}`);
      thread.reset();
      
      // IMPORTANT: Set lastLoadedSessionId to null so the next load is treated as fresh
      // This ensures messages will be imported after reset
      set({
        lastLoadedSessionId: null,
        lastError: null,
      });
      
      console.log("[thread-loader] Thread reset complete, ready for new messages");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("[thread-loader] Error resetting thread:", err);
      set({ lastError: err });
    }
  },

  loadMessagesIntoThread: ({ sessionId, messages, runtime }) => {
    const state = get();
    
    console.log(`[thread-loader] loadMessagesIntoThread called for session: ${sessionId}, messages: ${messages.length}`);
    console.log(`[thread-loader] Current lastLoadedSessionId: ${state.lastLoadedSessionId}`);
    
    // Skip if already importing
    if (state.isImporting) {
      console.log("[thread-loader] Already importing, skipping");
      return;
    }

    // Skip if this exact session is already loaded with the same messages
    if (state.lastLoadedSessionId === sessionId && messages.length > 0) {
      console.log("[thread-loader] Session already loaded, skipping duplicate import");
      return;
    }

    set({ isImporting: true, lastError: null });

    try {
      const thread = runtime?.thread;

      if (!thread || typeof thread.import !== "function") {
        throw new Error("Thread does not support import()");
      }

      if (messages.length === 0) {
        console.log("[thread-loader] No messages to import");
        set({ 
          isImporting: false,
          lastLoadedSessionId: sessionId 
        });
        return;
      }

      console.log("[thread-loader] First message before validation:", JSON.stringify(messages[0]));

      // Validate messages
      const validatedMessages = validateMessages(messages);
      
      console.log(`[thread-loader] Validated ${validatedMessages.length} out of ${messages.length} messages`);
      
      if (validatedMessages.length === 0) {
        console.log("[thread-loader] No valid messages after validation");
        set({ 
          isImporting: false,
          lastLoadedSessionId: sessionId 
        });
        return;
      }

      // Build export format for assistant-ui
      const exportedMessages = validatedMessages.map((msg, idx) => ({
        message: msg,
        parentId: idx > 0 ? validatedMessages[idx - 1].id : null,
      }));
      
      console.log("[thread-loader] Importing messages into thread:", exportedMessages.length);
      console.log("[thread-loader] First exported message:", JSON.stringify(exportedMessages[0]));
      
      thread.import({ messages: exportedMessages });

      console.log("[thread-loader] Successfully imported messages");

      set({
        lastLoadedSessionId: sessionId,
        isImporting: false,
        lastError: null,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("[thread-loader] Error importing messages:", err);
      console.error("[thread-loader] Error stack:", err.stack);
      
      set({
        isImporting: false,
        lastError: err,
      });
    }
  },

  clearError: () => {
    set({ lastError: null });
  },
}));

