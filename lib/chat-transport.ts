/**
 * Custom Chat Transport with Session ID Support
 * Extends AssistantChatTransport to include session ID in headers
 */

import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import type { HttpChatTransportInitOptions, UIMessage, ChatRequestOptions, UIMessageChunk } from "ai";

/**
 * Track sessions that have been loaded from history (complete conversations).
 * These sessions should not trigger automatic reconnection via reconnectToStream.
 * Sessions are marked as historical when messages are loaded, and removed when
 * the user sends a new message to allow the conversation to continue.
 */
const historicalSessions = new Set<string>();

/**
 * Mark a session as historical (loaded from history).
 * This prevents reconnectToStream from automatically continuing the conversation.
 */
export function markSessionAsHistorical(sessionId: string) {
  historicalSessions.add(sessionId);
}

/**
 * Mark a session as active (not just historical).
 * This allows reconnectToStream to work normally for the session.
 * Called when user sends a new message to continue a historical conversation.
 */
export function markSessionAsActive(sessionId: string) {
  historicalSessions.delete(sessionId);
}

/**
 * @deprecated Use markSessionAsHistorical instead
 */
export function setIsLoadingHistoricalMessages(value: boolean, sessionId?: string | null) {
  if (value && sessionId) {
    markSessionAsHistorical(sessionId);
  }
}

/**
 * @deprecated Use markSessionAsActive instead
 */
export function markSessionAsNew(sessionId: string | null) {
  if (sessionId) {
    markSessionAsActive(sessionId);
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
    // This allows the conversation to continue and reconnectToStream to work
    const sessionId = this.getSessionId();
    if (sessionId && options.trigger === "submit-message") {
      // Check if last message is from user
      const lastMessage = options.messages[options.messages.length - 1];
      if (lastMessage && lastMessage.role === "user") {
        markSessionAsActive(sessionId);
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
    
    // Prevent reconnection for sessions that were loaded from history.
    // These are complete conversations that shouldn't be automatically continued.
    // The session will be removed from historicalSessions when user sends a new message.
    if (currentSessionId && historicalSessions.has(currentSessionId)) {
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

