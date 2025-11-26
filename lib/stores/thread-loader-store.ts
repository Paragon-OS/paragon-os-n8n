/**
 * Thread Loader Store
 * Manages thread state and message loading logic
 * Separates concerns from the component layer
 */

import { create } from "zustand";
import { normalizeMessages } from "@/lib/chat/message-validation";
import { isEmpty, isNil } from "lodash";
import type { UIMessage } from "@/lib/supabase/supabase-chat";

// Use a flexible type that matches the actual runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      
      if (isNil(thread) || typeof thread.reset !== "function") {
        throw new Error("Thread does not support reset()");
      }

      console.log(`[thread-loader] Resetting thread for session: ${sessionId}`);
      thread.reset();
      
      set({
        lastLoadedSessionId: sessionId,
        lastError: null,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("[thread-loader] Error resetting thread:", err);
      set({ lastError: err });
    }
  },

  loadMessagesIntoThread: ({ sessionId, messages, runtime }) => {
    const state = get();
    
    // Prevent concurrent imports
    if (state.isImporting) {
      console.warn("[thread-loader] Import already in progress, skipping");
      return;
    }

    set({ isImporting: true, lastError: null });

    try {
      // Validate runtime
      const thread = runtime?.thread;

      if (isNil(thread) || typeof thread.import !== "function") {
        throw new Error("Thread does not support import()");
      }

      // Skip if no messages
      if (isEmpty(messages)) {
        console.log("[thread-loader] No messages to import");
        set({ isImporting: false });
        return;
      }

      // Normalize messages with lodash safety checks
      const normalizedMessages = normalizeMessages(messages, sessionId);
      
      // Double-check all messages have IDs (defensive programming)
      const invalidMessages = normalizedMessages.filter(msg => isNil(msg?.id));
      if (!isEmpty(invalidMessages)) {
        console.error(`[thread-loader] Invalid messages without IDs:`, invalidMessages);
        throw new Error(`Found ${invalidMessages.length} messages without IDs`);
      }

      if (isEmpty(normalizedMessages)) {
        console.log("[thread-loader] No valid messages after normalization");
        set({ isImporting: false });
        return;
      }

      // Import messages into thread
      // The assistant-ui thread.import expects ExportedMessageRepository format:
      // { messages: Array<{ message: ThreadMessage, parentId: string | null }> }
      // Each message needs to reference its parent (previous message in the conversation)
      const exportedMessages = normalizedMessages.map((msg, idx) => ({
        message: msg,
        parentId: idx > 0 ? normalizedMessages[idx - 1].id : null,
      }));
      
      console.log(`[thread-loader] Importing ${normalizedMessages.length} messages for session: ${sessionId}`);
      thread.import({ messages: exportedMessages });

      set({
        lastLoadedSessionId: sessionId,
        isImporting: false,
        lastError: null,
      });

      console.log(`[thread-loader] Successfully imported ${normalizedMessages.length} messages`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("[thread-loader] Error importing messages:", err);
      
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

