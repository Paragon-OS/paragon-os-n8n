"use client";

import { useState, useMemo } from "react";
import React from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import { Thread } from "@/components/assistant-ui/thread";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { StreamMonitor } from "@/components/assistant-ui/stream-monitor";
import { StreamingProvider } from "@/components/assistant-ui/streaming-context";
import { WebhookModeToggle } from "@/components/assistant-ui/webhook-mode-toggle";
import { SupabaseTest } from "@/components/assistant-ui/supabase-test";
import { ChatSessionsProvider, useChatSessionsContext } from "@/components/assistant-ui/chat-sessions-context";
import { SessionAwareChatTransport } from "@/lib/chat-transport";
import { useSessionStore, useSessionStoreHydrated } from "@/lib/stores/session-store";

// Wrapper component that only renders when we have a transport
function AssistantRuntimeWrapper({ transport, sessionId }: { transport: SessionAwareChatTransport, sessionId: string }) {
  // This component only renders when transport exists, so runtime is always created with a valid transport
  const runtime = useChatRuntime({
    transport,
  });
  
  // Log when runtime is created
  React.useEffect(() => {
    console.log("[assistant] RuntimeWrapper - Runtime created with transport, sessionId:", sessionId);
    // Runtime transport is internal, we don't need to log it
  }, [runtime, sessionId]);
  
  return <AssistantContentWithRuntime runtime={runtime} />;
}

function AssistantContent() {
  const { createNewSession } = useChatSessionsContext();
  const effectiveSessionId = useSessionStore((state) => state.activeSessionId);
  const hasHydrated = useSessionStoreHydrated();
  const isCreatingSessionRef = React.useRef(false);
  
  // Log session ID changes
  React.useEffect(() => {
    console.log("[assistant] effectiveSessionId changed:", effectiveSessionId);
  }, [effectiveSessionId]);
  
  // Initialize session if none exists - but ONLY after store has hydrated
  React.useEffect(() => {
    // Wait for store to hydrate before checking for session
    if (!hasHydrated) {
      console.log("[assistant] Waiting for store hydration...");
      return;
    }
    
    console.log("[assistant] Store hydrated, checking session, effectiveSessionId:", effectiveSessionId);
    if (!effectiveSessionId && !isCreatingSessionRef.current) {
      console.log("[assistant] No session found after hydration, creating new session");
      isCreatingSessionRef.current = true;
      createNewSession()
        .then((newSessionId) => {
          console.log("[assistant] Created new session:", newSessionId);
          isCreatingSessionRef.current = false;
        })
        .catch((error) => {
          console.error("[assistant] Error creating new session:", error);
          isCreatingSessionRef.current = false;
        });
    }
  }, [effectiveSessionId, createNewSession, hasHydrated]);
  
  // Create transport with current session ID - use useMemo to recreate when sessionId changes
  // Only create transport if we have a session ID to avoid capturing null
  // IMPORTANT: The getSessionId function reads directly from the store to avoid closure issues
  const transport = useMemo(() => {
    if (!effectiveSessionId) {
      console.log("[assistant] No session ID yet, skipping transport creation");
      return null;
    }
    console.log("[assistant] Creating transport, effectiveSessionId:", effectiveSessionId);
    return new SessionAwareChatTransport(
      {
        api: "/api/chat",
      },
      () => {
        // Always read fresh from the store, don't rely on closure
        const currentSessionId = useSessionStore.getState().activeSessionId;
        console.log("[assistant] Transport getSessionId called, returning:", currentSessionId);
        return currentSessionId;
      }
    );
  }, [effectiveSessionId]);
  
  // Log transport details
  React.useEffect(() => {
    if (transport) {
      console.log("[assistant] Transport instance:", transport);
      // Test calling getSessionId via public method
      try {
        const testSessionId = transport.getCurrentSessionId();
        console.log("[assistant] Transport getCurrentSessionId test call result:", testSessionId);
      } catch (e) {
        console.error("[assistant] Error testing getCurrentSessionId:", e);
      }
    }
  }, [transport]);

  // Don't render the runtime provider until store has hydrated and we have a session ID and transport
  if (!hasHydrated || !effectiveSessionId || !transport) {
    console.log("[assistant] Waiting for hydration/session ID before rendering runtime", { hasHydrated, effectiveSessionId, hasTransport: !!transport });
    return (
      <StreamingProvider>
        <div className="flex h-dvh w-full items-center justify-center">
          <div className="text-muted-foreground">
            {!hasHydrated ? "Loading session..." : "Initializing session..."}
          </div>
        </div>
      </StreamingProvider>
    );
  }
  
  // Render wrapper that creates runtime with transport
  return <AssistantRuntimeWrapper transport={transport} sessionId={effectiveSessionId} />;
}

function AssistantContentWithRuntime({ runtime }: { runtime: ReturnType<typeof useChatRuntime> }) {
  const [activeTab, setActiveTab] = useState<"chat" | "monitor" | "supabase">("chat");
  const activeSessionTitle = useSessionStore((state) => state.activeSessionTitle);
  const effectiveSessionId = useSessionStore((state) => state.activeSessionId);

  return (
    <StreamingProvider>
      <AssistantRuntimeProvider key={effectiveSessionId} runtime={runtime}>
        <SidebarProvider>
          <div className="flex h-dvh w-full pr-0.5">
            <ThreadListSidebar />
            <SidebarInset>
              <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
                <SidebarTrigger />
                <Separator orientation="vertical" className="mr-2 h-4" />
                <Breadcrumb>
                  <BreadcrumbList>
                    {activeSessionTitle ? (
                      <>
                        <BreadcrumbItem>
                          <BreadcrumbLink href="/">ParagonOS UI</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                          <BreadcrumbPage>{activeSessionTitle}</BreadcrumbPage>
                    </BreadcrumbItem>
                      </>
                    ) : (
                    <BreadcrumbItem>
                      <BreadcrumbPage>ParagonOS UI</BreadcrumbPage>
                    </BreadcrumbItem>
                    )}
                  </BreadcrumbList>
                </Breadcrumb>
                <div className="ml-auto flex gap-3 items-center">
                  <WebhookModeToggle />
                  <Separator orientation="vertical" className="h-4" />
                  <button
                    onClick={() => setActiveTab("chat")}
                    className={`px-3 py-1.5 text-sm rounded transition-colors ${
                      activeTab === "chat"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    Chat
                  </button>
                  <button
                    onClick={() => setActiveTab("monitor")}
                    className={`px-3 py-1.5 text-sm rounded transition-colors ${
                      activeTab === "monitor"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    Monitor
                  </button>
                  <button
                    onClick={() => setActiveTab("supabase")}
                    className={`px-3 py-1.5 text-sm rounded transition-colors ${
                      activeTab === "supabase"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    Supabase
                  </button>
                </div>
              </header>
              <div className="flex-1 overflow-hidden">
                {activeTab === "chat" ? (
                  <Thread />
                ) : activeTab === "monitor" ? (
                  <StreamMonitor />
                ) : (
                  <SupabaseTest />
                )}
              </div>
            </SidebarInset>
          </div>
        </SidebarProvider>
      </AssistantRuntimeProvider>
    </StreamingProvider>
  );
}

export const Assistant = () => {
  return (
    <ChatSessionsProvider>
      <AssistantContent />
    </ChatSessionsProvider>
  );
};
