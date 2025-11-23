"use client";

import { useState } from "react";
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
import { useSessionStore } from "@/lib/stores/session-store";

function AssistantContent() {
  const [activeTab, setActiveTab] = useState<"chat" | "monitor" | "supabase">("chat");
  const { activeSessionId, createNewSession } = useChatSessionsContext();
  const activeSessionTitle = useSessionStore((state) => state.activeSessionTitle);
  
  // Initialize session if none exists
  React.useEffect(() => {
    if (!activeSessionId) {
      createNewSession();
    }
  }, [activeSessionId, createNewSession]);
  
  const runtime = useChatRuntime({
    transport: new SessionAwareChatTransport(
      {
        api: "/api/chat",
      },
      () => activeSessionId
    ),
  });

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
