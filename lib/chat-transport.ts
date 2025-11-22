/**
 * Custom Chat Transport with Session ID Support
 * Extends AssistantChatTransport to include session ID in headers
 */

import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import type { HttpChatTransportInitOptions, UIMessage, ChatRequestOptions, UIMessageChunk } from "ai";

// Global flag to track when we're loading historical messages
// This prevents reconnectToStream from triggering new executions
let isLoadingHistoricalMessages = false;
let loadingSessionId: string | null = null;

// Track sessions that have been fully loaded from history (complete sessions)
// These sessions should not trigger automatic reconnection
const loadedHistoricalSessions = new Set<string>();

export function setIsLoadingHistoricalMessages(value: boolean, sessionId?: string | null) {
  isLoadingHistoricalMessages = value;
  loadingSessionId = value ? (sessionId || null) : null;
  if (value) {
    console.log("[chat-transport] Set loading flag for session:", sessionId);
    // Mark session as historical IMMEDIATELY when starting to load
    // This ensures reconnectToStream is blocked even during the append process
    if (sessionId) {
      loadedHistoricalSessions.add(sessionId);
      console.log("[chat-transport] Marked session as historical (will block reconnection):", sessionId);
    }
  } else {
    console.log("[chat-transport] Cleared loading flag");
    // Session is already marked as historical above, so we just clear the loading flag
    // The session stays in loadedHistoricalSessions to continue blocking reconnection
  }
}

export function markSessionAsNew(sessionId: string | null) {
  if (sessionId) {
    loadedHistoricalSessions.delete(sessionId);
    console.log("[chat-transport] Marked session as new (not historical):", sessionId);
  }
}

export class SessionAwareChatTransport<
  UI_MESSAGE extends UIMessage = UIMessage
> extends AssistantChatTransport<UI_MESSAGE> {
  private getSessionId: () => string | null;

  constructor(
    options: HttpChatTransportInitOptions<UI_MESSAGE>,
    getSessionId: () => string | null
  ) {
    super(options);
    this.getSessionId = getSessionId;
  }

  override async sendMessages(options: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: UI_MESSAGE[];
    abortSignal: AbortSignal | undefined;
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk>> {
    // When user sends a new message, mark session as active (not just historical)
    // This allows the conversation to continue
    const sessionId = this.getSessionId();
    if (sessionId && options.trigger === "submit-message") {
      // Check if last message is from user
      const lastMessage = options.messages[options.messages.length - 1];
      if (lastMessage && lastMessage.role === "user") {
        loadedHistoricalSessions.delete(sessionId);
        console.log("[chat-transport] User sent new message, allowing continuation for session:", sessionId);
      }
    }

    // Override fetch temporarily to add session ID header
    const originalFetch = this.fetch;
    if (!originalFetch) {
      return super.sendMessages(options);
    }
    
    const getSessionId = this.getSessionId;
    
    this.fetch = (async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const sessionId = getSessionId();
      const headers = new Headers(init?.headers);
      
      if (sessionId) {
        headers.set("x-session-id", sessionId);
      }
      
      return originalFetch(input, {
        ...init,
        headers,
      });
    }) as typeof fetch;

    try {
      return await super.sendMessages(options);
    } finally {
      // Restore original fetch
      this.fetch = originalFetch;
    }
  }

  override async reconnectToStream(options: {
    chatId: string;
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk> | null> {
    const currentSessionId = this.getSessionId();
    
    // Prevent reconnection when loading historical messages
    if (isLoadingHistoricalMessages) {
      console.log("[chat-transport] Preventing reconnectToStream - loading historical messages", {
        loadingSessionId,
        currentSessionId,
        match: loadingSessionId === currentSessionId
      });
      return null;
    }

    // Prevent reconnection for sessions that were loaded from history
    // These are complete conversations that shouldn't be automatically continued
    if (currentSessionId && loadedHistoricalSessions.has(currentSessionId)) {
      console.log("[chat-transport] Preventing reconnectToStream - session was loaded from history (complete conversation)", {
        sessionId: currentSessionId
      });
      return null;
    }

    // Override fetch temporarily to add session ID header
    const originalFetch = this.fetch;
    if (!originalFetch) {
      return super.reconnectToStream(options);
    }
    
    const getSessionId = this.getSessionId;
    
    this.fetch = (async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const sessionId = getSessionId();
      const headers = new Headers(init?.headers);
      
      if (sessionId) {
        headers.set("x-session-id", sessionId);
      }
      
      return originalFetch(input, {
        ...init,
        headers,
      });
    }) as typeof fetch;

    try {
      return await super.reconnectToStream(options);
    } finally {
      // Restore original fetch
      this.fetch = originalFetch;
    }
  }
}

