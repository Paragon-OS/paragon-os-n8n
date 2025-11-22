"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import type { StreamUpdate } from "@/lib/n8n-client/types";
import { useExecutionStore } from "@/lib/execution-store";

interface StreamingContextType {
  updates: StreamUpdate[];
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  clearUpdates: () => void;
}

const StreamingContext = createContext<StreamingContextType | null>(null);

export function useStreaming() {
  const context = useContext(StreamingContext);
  if (!context) {
    throw new Error("useStreaming must be used within StreamingProvider");
  }
  return context;
}

interface StreamingProviderProps {
  children: ReactNode;
}

export function StreamingProvider({ children }: StreamingProviderProps) {
  const [updates, setUpdates] = useState<StreamUpdate[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const updateFromStreamUpdate = useExecutionStore((state) => state.updateFromStreamUpdate);

  const connect = () => {
    // Clean up any existing connection
    if (eventSourceRef.current) {
      console.log("[streaming-context] Closing existing connection");
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const sseUrl = `/api/stream/sse/default`;
    console.log(`[streaming-context] Connecting to SSE: ${sseUrl}`);

    try {
      const eventSource = new EventSource(sseUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        console.log("[streaming-context] ✅ SSE connected");
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Skip connection messages
          if (data.type === "connected") {
            console.log("[streaming-context] Connected to SSE stream");
            return;
          }

          const update: StreamUpdate = data;
          console.log(`[streaming-context] 📨 Received update:`, update);
          setUpdates((prev) => [...prev, update]);
          
          // Auto-track execution in execution store
          updateFromStreamUpdate(update);
        } catch (error) {
          console.error("[streaming-context] Failed to parse update:", error);
        }
      };

      eventSource.onerror = () => {
        const state = eventSource.readyState;
        
        if (state === 2) {
          console.log("[streaming-context] Connection closed");
          setIsConnected(false);
          eventSource.close();
          eventSourceRef.current = null;
        }
      };
    } catch (error) {
      console.error("[streaming-context] Failed to create EventSource:", error);
      setIsConnected(false);
    }
  };

  const disconnect = () => {
    if (eventSourceRef.current) {
      console.log("[streaming-context] Manually disconnecting");
      const es = eventSourceRef.current;
      eventSourceRef.current = null;
      es.close();
      setIsConnected(false);
    }
  };

  const clearUpdates = () => {
    setUpdates([]);
  };

  // Auto-connect on mount
  useEffect(() => {
    console.log("[streaming-context] Provider mounted, connecting...");
    connect();

    return () => {
      console.log("[streaming-context] Provider unmounting, disconnecting...");
      disconnect();
    };
  }, []);

  // Prevent Cmd+S / Ctrl+S from triggering browser save (which closes connection)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        console.log("[streaming-context] Prevented Cmd+S from closing connection");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const value: StreamingContextType = {
    updates,
    isConnected,
    connect,
    disconnect,
    clearUpdates,
  };

  return (
    <StreamingContext.Provider value={value}>
      {children}
    </StreamingContext.Provider>
  );
}

