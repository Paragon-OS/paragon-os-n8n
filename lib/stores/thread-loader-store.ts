/**
 * Thread Loader Store
 * Manages thread state and message loading logic
 */

import { create } from "zustand";
import { validateMessages } from "@/lib/chat/message-validation";
import type { UIMessage } from "ai";

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
      
      if (!thread || typeof thread.reset !== "function") {
        throw new Error("Thread does not support reset()");
      }

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
    
    if (state.isImporting) {
      return;
    }

    set({ isImporting: true, lastError: null });

    try {
      const thread = runtime?.thread;

      if (!thread || typeof thread.import !== "function") {
        throw new Error("Thread does not support import()");
      }

      if (messages.length === 0) {
        set({ isImporting: false });
        return;
      }

      // Validate messages
      const validatedMessages = validateMessages(messages);
      
      if (validatedMessages.length === 0) {
        set({ isImporting: false });
        return;
      }

      // Build export format for assistant-ui
      const exportedMessages = validatedMessages.map((msg, idx) => ({
        message: msg,
        parentId: idx > 0 ? validatedMessages[idx - 1].id : null,
      }));
      
      thread.import({ messages: exportedMessages });

      set({
        lastLoadedSessionId: sessionId,
        isImporting: false,
        lastError: null,
      });
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

