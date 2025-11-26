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
import { Button } from "@/components/ui/button";
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
import { useSessionStore } from "@/lib/stores/session-store";

// Empty state sidebar without AssistantProvider dependencies
function EmptyStateSidebar() {
  const { sessions, isLoading, activeSessionId, setActiveSessionId, createNewSession } = useChatSessionsContext();

  const handleNewThread = () => {
    createNewSession();
  };

  const handleSessionClick = (sessionId: string) => {
    setActiveSessionId(sessionId);
  };

  return (
    <StreamingProvider>
      <SidebarProvider>
        <div className="flex h-dvh w-full pr-0.5">
          <div className="flex h-full w-[--sidebar-width] flex-col border-r bg-sidebar text-sidebar-foreground">
            <div className="mb-2 border-b p-4">
              <div className="flex items-center gap-2">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <span className="text-sm font-semibold">P</span>
                </div>
                <span className="font-semibold">ParagonOS UI</span>
              </div>
            </div>
            <div className="flex-1 overflow-auto px-2">
              <div className="flex flex-col gap-1.5">
                <Button
                  className="flex items-center justify-start gap-1 rounded-lg px-2.5 py-2 text-start hover:bg-muted"
                  variant="ghost"
                  onClick={handleNewThread}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M5 12h14" />
                    <path d="M12 5v14" />
                  </svg>
                  New Thread
                </Button>
                {!isLoading && sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-all hover:bg-muted cursor-pointer ${
                      activeSessionId === session.id ? "bg-muted" : ""
                    }`}
                    onClick={() => handleSessionClick(session.id)}
                  >
                    <div className="flex-grow min-w-0">
                      <span className="text-sm block truncate">
                        {session.title || "Untitled Chat"}
                      </span>
                      {session.updated_at && (
                        <span className="text-xs text-muted-foreground block truncate">
                          {new Date(session.updated_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <SidebarInset>
            <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbPage>ParagonOS UI</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </header>
            <div className="flex h-full w-full items-center justify-center">
              <div className="text-center space-y-4">
                <div className="text-2xl font-semibold text-muted-foreground">
                  No chat selected
                </div>
                <div className="text-sm text-muted-foreground/70">
                  Click on a chat from the sidebar or create a new one
                </div>
              </div>
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </StreamingProvider>
  );
}

// Empty state view when no session is selected
function EmptyStateView() {
  return <EmptyStateSidebar />;
}

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
  const effectiveSessionId = useSessionStore((state) => state.activeSessionId);
  
  // Log session ID changes
  React.useEffect(() => {
    console.log("[assistant] effectiveSessionId changed:", effectiveSessionId);
  }, [effectiveSessionId]);
  
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

  // Don't render the runtime provider until we have a session ID and transport
  if (!effectiveSessionId || !transport) {
    console.log("[assistant] No session selected, showing empty state");
    return <EmptyStateView />;
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
      <AssistantRuntimeProvider runtime={runtime}>
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
