/**
 * Custom Chat Transport with Session ID Support
 * Extends AssistantChatTransport to include session ID in headers
 */

import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import type { HttpChatTransportInitOptions, UIMessage, ChatRequestOptions, UIMessageChunk } from "ai";

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

