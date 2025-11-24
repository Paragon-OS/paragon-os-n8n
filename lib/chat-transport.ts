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
    // Create a custom fetch that includes the session ID header
    const originalFetch = options.fetch || globalThis.fetch;
    const sessionAwareFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const sessionId = getSessionId();
      console.log("[chat-transport] Custom fetch called, sessionId:", sessionId);
      
      const headers = new Headers(init?.headers);
      
      if (sessionId) {
        headers.set("x-session-id", sessionId);
        console.log("[chat-transport] Added x-session-id header:", sessionId);
      } else {
        console.warn("[chat-transport] No sessionId available, request will create new session");
      }
      
      return originalFetch(input, {
        ...init,
        headers,
      });
    };

    super({
      ...options,
      fetch: sessionAwareFetch,
    });
    
    this.getSessionId = getSessionId;
    console.log("[chat-transport] Constructor called, getSessionId function:", typeof getSessionId);
  }
  
  // Expose getSessionId for debugging
  public getCurrentSessionId(): string | null {
    return this.getSessionId();
  }

  override async sendMessages(options: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: UI_MESSAGE[];
    abortSignal: AbortSignal | undefined;
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk>> {
    console.log("[chat-transport] sendMessages OVERRIDE CALLED!", "messages count:", options.messages.length, "trigger:", options.trigger);
    
    // The fetch is already set up in the constructor with session ID support
    // Just call super - the custom fetch will automatically add the header
    return super.sendMessages(options);
  }

  override async reconnectToStream(options: {
    chatId: string;
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk> | null> {
    // The fetch is already set up in the constructor with session ID support
    // Just call super - the custom fetch will automatically add the header
    return super.reconnectToStream(options);
  }
}

