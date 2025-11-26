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
      
      // Don't clear lastLoadedSessionId here - let loadMessagesIntoThread set it
      set({
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
    
    console.log(`😎 [thread-loader] loadMessagesIntoThread called for session: ${sessionId}, messages: ${messages.length}`);
    console.log(`😎 [thread-loader] Current lastLoadedSessionId: ${state.lastLoadedSessionId}`);
    console.log(`😎 [thread-loader] isImporting: ${state.isImporting}`);
    console.log(`😎 [thread-loader] runtime exists: ${!!runtime}`);
    console.log(`😎 [thread-loader] runtime.thread exists: ${!!runtime?.thread}`);
    
    // Skip if already importing
    if (state.isImporting) {
      console.log("😎 [thread-loader] ⚠️ Already importing, skipping");
      return;
    }

    // REMOVED: The aggressive duplicate check was blocking legitimate imports
    // The thread.import() method itself handles duplicates properly
    // We only need to prevent concurrent imports (checked above with isImporting)
    console.log("😎 [thread-loader] ✅ Proceeding with import (no duplicate check blocking)");

    set({ isImporting: true, lastError: null });
    console.log("😎 [thread-loader] ✅ Starting import process...");

    try {
      const thread = runtime?.thread;

      if (!thread || typeof thread.import !== "function") {
        console.log("😎 [thread-loader] ❌ Thread does not support import()!");
        throw new Error("Thread does not support import()");
      }

      console.log("😎 [thread-loader] ✅ Thread supports import()");

      if (messages.length === 0) {
        console.log("😎 [thread-loader] ⚠️ No messages to import");
        set({ 
          isImporting: false,
          lastLoadedSessionId: sessionId 
        });
        return;
      }

      console.log(`😎 [thread-loader] 📝 Processing ${messages.length} messages...`);
      console.log("😎 [thread-loader] First message before validation:", JSON.stringify(messages[0]));

      // Validate messages
      const validatedMessages = validateMessages(messages);
      
      console.log(`😎 [thread-loader] ✅ Validated ${validatedMessages.length} out of ${messages.length} messages`);
      
      if (validatedMessages.length === 0) {
        console.log("😎 [thread-loader] ❌ No valid messages after validation!");
        set({ 
          isImporting: false,
          lastLoadedSessionId: sessionId 
        });
        return;
      }

      console.log(`😎 [thread-loader] 🚀 Importing ${validatedMessages.length} messages into thread...`);
      console.log("😎 [thread-loader] First validated message:", JSON.stringify(validatedMessages[0]));
      
      // assistant-ui thread.import() expects ExportedMessageRepository format:
      // { messages: Array<{ message: ThreadMessage, parentId: string | null }> }
      // Build parent-child relationships based on message order
      const threadMessages = validatedMessages.map((msg, idx) => ({
        message: msg,
        parentId: idx > 0 ? validatedMessages[idx - 1].id : null,
      }));
      
      console.log(`😎 [thread-loader] 📦 Built ${threadMessages.length} thread messages with parent relationships`);
      console.log("😎 [thread-loader] First thread message:", JSON.stringify(threadMessages[0]));
      
      try {
        console.log("😎 [thread-loader] 🎯 Calling thread.import()...");
        thread.import({ messages: threadMessages });
        console.log("😎 [thread-loader] ✅ Import call completed successfully!");
        console.log("😎 [thread-loader] 🎉 Messages should now be visible in UI!");
      } catch (err) {
        console.error("😎 [thread-loader] ❌ Import failed:", err);
        throw err;
      }

      set({
        lastLoadedSessionId: sessionId,
        isImporting: false,
        lastError: null,
      });
      console.log(`😎 [thread-loader] ✅ State updated - lastLoadedSessionId: ${sessionId}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error("😎 [thread-loader] ❌❌❌ Error importing messages:", err);
      console.error("😎 [thread-loader] Error stack:", err.stack);
      
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

