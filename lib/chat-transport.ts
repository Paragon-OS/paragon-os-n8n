/**
 * Custom Chat Transport with Session ID Support
 * Wraps AssistantChatTransport to include session ID in headers
 */

import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";

export class SessionAwareChatTransport extends AssistantChatTransport {
  private getSessionId: () => string | null;

  constructor(
    options: { api: string },
    getSessionId: () => string | null
  ) {
    super(options);
    this.getSessionId = getSessionId;
  }

  override async fetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const sessionId = this.getSessionId();
    
    // Add session ID to headers if available
    const headers = new Headers(init?.headers);
    if (sessionId) {
      headers.set("x-session-id", sessionId);
    }

    return super.fetch(input, {
      ...init,
      headers,
    });
  }
}

