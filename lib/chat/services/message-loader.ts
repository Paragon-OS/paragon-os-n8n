/**
 * Message Loader Service
 * Handles loading messages into Assistant UI thread
 * Extracted for testability
 */

import type { ValidatedMessage } from "../message-validation";

/**
 * Thread interface (matching Assistant UI thread API)
 * Using a flexible type to match the actual runtime API
 */
export interface Thread {
  reset: () => void;
  import: (repository: unknown) => void;
}

/**
 * Message Loader Service
 * Handles the logic of loading messages into a thread
 */
export class MessageLoaderService {
  /**
   * Check if messages should be loaded
   * Determines if loading is needed based on current state
   */
  shouldLoadMessages(
    current: ValidatedMessage[],
    incoming: ValidatedMessage[],
    lastSessionId: string | null,
    currentSessionId: string
  ): boolean {
    // If switching sessions, always load
    if (lastSessionId !== null && lastSessionId !== currentSessionId) {
      return true;
    }

    // If first load, load if there are messages
    if (lastSessionId === null) {
      return incoming.length > 0;
    }

    // Same session - check if there are new messages
    if (lastSessionId === currentSessionId) {
      if (incoming.length === 0) {
        return false;
      }

      // Check if all messages are already loaded
      const currentIds = new Set(current.map((m) => m.id));
      const incomingIds = new Set(incoming.map((m) => m.id));

      // If sizes differ or there are new IDs, we need to load
      if (incomingIds.size !== currentIds.size) {
        return true;
      }

      // Check if all incoming IDs are in current
      return !Array.from(incomingIds).every((id) => currentIds.has(id));
    }

    return true;
  }

  /**
   * Load messages into thread
   * Handles thread reset and import logic
   */
  async loadMessagesIntoThread(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    thread: any,
    messages: ValidatedMessage[],
    currentMessages: ReadonlyArray<{ id?: string | null }>,
    lastSessionId: string | null,
    currentSessionId: string
  ): Promise<void> {
    // Check if thread supports import()
    if (typeof thread.import !== "function") {
      throw new Error(
        "Thread runtime does not support import(). Cannot load historical messages safely."
      );
    }

    // Clear thread if switching sessions
    if (lastSessionId !== null && lastSessionId !== currentSessionId) {
      console.log(
        `[message-loader] Switching sessions, resetting thread. Old: ${lastSessionId}, New: ${currentSessionId}`
      );
      thread.reset();
    }

    // Check if messages are already loaded
    const currentIds = new Set(currentMessages.map((m) => m.id));
    const incomingIds = new Set(messages.map((m) => m.id));

    if (
      incomingIds.size === currentIds.size &&
      Array.from(incomingIds).every((id) => currentIds.has(id))
    ) {
      console.log(
        `[message-loader] All ${messages.length} messages already loaded, skipping import`
      );
      return;
    }

    // Import messages (marks them as historical, won't trigger responses)
    // Use type assertion to match the actual runtime API
    thread.import({ messages });
    console.log(
      `[message-loader] Successfully imported ${messages.length} historical messages (no responses triggered)`
    );
  }
}

