"use client";

import { useEffect, useRef, useState } from "react";
import { InfoIcon } from "lucide-react";
import { useStreaming } from "./streaming-context";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface StreamMonitorProps {
  executionIds?: string[]; // Optional: filter to specific executions
}

export function StreamMonitor({
  executionIds = [],
}: StreamMonitorProps) {
  const {
    updates,
    isConnected,
    isLoading,
    connect,
    disconnect,
    clearUpdates,
    loadEventsFromSupabase,
  } = useStreaming();
  const updatesEndRef = useRef<HTMLDivElement>(null);
  const [hasLoadedFilteredEvents, setHasLoadedFilteredEvents] = useState(false);
  const getAllExecutions = useExecutionStore((state) => state.getAllExecutions);
  const getStats = useExecutionStore((state) => state.getStats);
  
  const executions = getAllExecutions();
  const stats = getStats();

  // Load filtered events from Supabase when executionIds are provided
  useEffect(() => {
    if (executionIds.length > 0 && !hasLoadedFilteredEvents) {
      loadEventsFromSupabase(executionIds).then(() => {
        setHasLoadedFilteredEvents(true);
      });
    }
  }, [executionIds, hasLoadedFilteredEvents, loadEventsFromSupabase]);

  // Reset filtered events flag when executionIds change
  useEffect(() => {
    setHasLoadedFilteredEvents(false);
  }, [executionIds.join(",")]); // Dependency on executionIds array

  // Auto-scroll to bottom when new updates arrive
  useEffect(() => {
    updatesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [updates]);

  // Filter updates by executionIds if specified
  const filteredUpdates =
    executionIds.length > 0
      ? updates.filter((update) => executionIds.includes(update.executionId))
      : updates;

  // Get unique session IDs from filtered updates
  const uniqueSessionIds = Array.from(
    new Set(
      filteredUpdates
        .map((update) => update.metadata?.sessionId)
        .filter((id): id is string => Boolean(id))
    )
  );

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "completed":
        return "bg-green-500";
      case "error":
        return "bg-red-500";
      case "in_progress":
        return "bg-orange-500";
      default:
        return "bg-blue-500";
    }
  };

  const getStatusTextColor = (status: string): string => {
    switch (status) {
      case "completed":
        return "text-green-400";
      case "error":
        return "text-red-400";
      case "in_progress":
        return "text-orange-400";
      default:
        return "text-blue-400";
    }
  };

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/stream/update`
      : "http://localhost:3000/api/stream/update";

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    // Could add a toast notification here
    console.log("Webhook URL copied to clipboard!");
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Stream Monitor</h2>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isConnected ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="text-sm text-muted-foreground">
                {isConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            {!isConnected && (
              <button
                onClick={connect}
                className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
              >
                Connect
              </button>
            )}
            {isConnected && (
              <button
                onClick={disconnect}
                className="px-3 py-1 text-sm bg-destructive text-destructive-foreground text-white rounded hover:bg-destructive/90"
              >
                Disconnect
              </button>
            )}
            <button
              onClick={clearUpdates}
              className="px-3 py-1 text-sm bg-secondary text-secondary-foreground rounded hover:bg-secondary/80"
            >
              Clear
            </button>
          </div>
        </div>
        
        {/* Webhook URL */}
        <div className="bg-muted rounded p-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">
            n8n Webhook URL:
          </span>
          <code className="flex-1 text-xs bg-background px-2 py-1 rounded font-mono">
            {webhookUrl}
          </code>
          <button
            onClick={copyWebhookUrl}
            className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
            title="Copy to clipboard"
          >
            Copy
          </button>
        </div>
      </div>

      {/* Updates List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {isLoading && filteredUpdates.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            Loading events from database...
          </div>
        ) : filteredUpdates.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            {isConnected
              ? "Waiting for workflow updates..."
              : "Disconnected - click Connect to see updates"}
          </div>
        ) : (
          filteredUpdates.map((update, index) => (
            <div
              key={`${update.executionId}-${update.timestamp}-${index}`}
              className="border rounded-lg p-3 bg-card"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">
                    {update.executionId.slice(0, 8)}...
                  </span>
                  {(update.metadata?.sessionId || update.metadata?.messageId) && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors">
                          <InfoIcon className="w-3.5 h-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <div className="space-y-1 text-xs">
                          {update.metadata?.sessionId && (
                            <div>
                              <span className="font-semibold">Session ID:</span>
                              <div className="font-mono break-all">{update.metadata.sessionId}</div>
                            </div>
                          )}
                          {update.metadata?.messageId && (
                            <div>
                              <span className="font-semibold">Message ID:</span>
                              <div className="font-mono break-all">{update.metadata.messageId}</div>
                            </div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <span
                    className={`text-xs font-semibold uppercase ${getStatusTextColor(
                      update.status
                    )}`}
                  >
                    {update.stage}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(
                    update.status
                  )} text-white`}
                >
                  {update.status}
                </span>
              </div>

              {/* Message */}
              <div className="text-sm mb-2 break-words whitespace-pre-wrap">{update.message}</div>

              {/* Timestamp */}
              <div className="text-xs text-muted-foreground mb-2">
                {new Date(update.timestamp).toLocaleString()}
              </div>

              {/* Data */}
              {update.data && Object.keys(update.data).length > 0 && (
                <div className="mt-2 p-2 bg-muted rounded text-xs font-mono overflow-x-auto">
                  <pre className="whitespace-pre-wrap break-words">{JSON.stringify(update.data, null, 2)}</pre>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={updatesEndRef} />
      </div>

      {/* Footer */}
      <div className="border-t p-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div>
              {filteredUpdates.length} update{filteredUpdates.length !== 1 ? "s" : ""}{" "}
              {executionIds.length > 0 ? "shown" : "received"}
              {executionIds.length > 0 && (
                <span> • Filtering {executionIds.length} execution(s)</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span>Executions: {stats.total}</span>
              {stats.running > 0 && <span className="text-orange-400">Running: {stats.running}</span>}
              {stats.completed > 0 && <span className="text-green-400">Completed: {stats.completed}</span>}
              {stats.error > 0 && <span className="text-red-400">Errors: {stats.error}</span>}
            </div>
          </div>
          {uniqueSessionIds.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="text-muted-foreground font-medium">Session IDs:</span>
              {uniqueSessionIds.map((sessionId) => (
                <span
                  key={sessionId}
                  className="font-mono text-blue-400 bg-blue-950/30 px-2 py-0.5 rounded"
                  title={sessionId}
                >
                  {sessionId.slice(0, 8)}...
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

