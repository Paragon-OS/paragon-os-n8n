"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import type { StreamUpdate } from "@/lib/n8n-client/types";
import { useExecutionStore } from "@/lib/stores/execution-store";
import {
  getAllStreamEvents,
  getStreamEventsByExecutionIds,
  convertStreamEventRowToUpdate,
} from "@/lib/supabase/supabase-stream-events";

interface StreamingContextType {
  updates: StreamUpdate[];
  isConnected: boolean;
  isLoading: boolean;
  connect: () => void;
  disconnect: () => void;
  clearUpdates: () => void;
  loadEventsFromSupabase: (executionIds?: string[], limit?: number) => Promise<void>;
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
  const [isLoading, setIsLoading] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const loadedEventsRef = useRef<Set<string>>(new Set()); // Track loaded events to avoid duplicates
  const updateFromStreamUpdate = useExecutionStore((state) => state.updateFromStreamUpdate);

  const connect = () => {
    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const sseUrl = `/api/stream/sse/default`;

    try {
      const eventSource = new EventSource(sseUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Skip connection messages
          if (data.type === "connected") {
            return;
          }

          const update: StreamUpdate = data;
          
          // Track this event to avoid duplicate loading
          const key = `${update.executionId}-${update.timestamp}`;
          loadedEventsRef.current.add(key);
          
          setUpdates((prev) => {
            // Check if this update already exists
            const exists = prev.some(
              (u) => `${u.executionId}-${u.timestamp}` === key
            );
            if (exists) {
              return prev;
            }
            
            // Add new update, maintaining chronological order
            const merged = [...prev, update].sort(
              (a, b) =>
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            return merged;
          });
          
          // Auto-track execution in execution store
          updateFromStreamUpdate(update);
        } catch (error) {
          console.error("[streaming-context] Failed to parse update:", error);
        }
      };

      eventSource.onerror = () => {
        const state = eventSource.readyState;
        
        if (state === 2) {
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
      const es = eventSourceRef.current;
      eventSourceRef.current = null;
      es.close();
      setIsConnected(false);
    }
  };

  const clearUpdates = () => {
    setUpdates([]);
    loadedEventsRef.current.clear();
  };

  const loadEventsFromSupabase = async (
    executionIds?: string[],
    limit: number = 100
  ): Promise<void> => {
    setIsLoading(true);
    try {
      let eventRows;
      
      if (executionIds && executionIds.length > 0) {
        // Load events for specific execution IDs
        eventRows = await getStreamEventsByExecutionIds(executionIds);
      } else {
        // Load all recent events
        eventRows = await getAllStreamEvents(limit);
      }

      if (eventRows.length === 0) {
        setIsLoading(false);
        return;
      }

      // Convert to StreamUpdate format
      const loadedUpdates = eventRows.map(convertStreamEventRowToUpdate);

      // Merge with existing updates, avoiding duplicates
      setUpdates((prev) => {
        const existingKeys = new Set(
          prev.map((u) => `${u.executionId}-${u.timestamp}`)
        );
        
        // Filter out duplicates based on both existing state and loaded events ref
        const uniqueNewUpdates = loadedUpdates.filter((update) => {
          const key = `${update.executionId}-${update.timestamp}`;
          // Skip if already in state or already loaded
          if (existingKeys.has(key) || loadedEventsRef.current.has(key)) {
            return false;
          }
          // Mark as loaded
          loadedEventsRef.current.add(key);
          return true;
        });

        // Sort by timestamp (oldest first)
        const merged = [...prev, ...uniqueNewUpdates].sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        // Also track execution updates in the execution store
        uniqueNewUpdates.forEach((update) => {
          updateFromStreamUpdate(update);
        });

        return merged;
      });
    } catch (error) {
      console.error("[streaming-context] Error loading events from Supabase:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-connect on mount and load recent events from Supabase
  useEffect(() => {
    // Load recent events from Supabase first
    loadEventsFromSupabase(undefined, 100);
    
    // Then connect to real-time stream
    connect();

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prevent Cmd+S / Ctrl+S from triggering browser save (which closes connection)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const value: StreamingContextType = {
    updates,
    isConnected,
    isLoading,
    connect,
    disconnect,
    clearUpdates,
    loadEventsFromSupabase,
  };

  return (
    <StreamingContext.Provider value={value}>
      {children}
    </StreamingContext.Provider>
  );
}

