"use client";

import { useEffect, useRef } from "react";
import { useStreaming } from "./streaming-context";

interface StreamMonitorProps {
  executionIds?: string[]; // Optional: filter to specific executions
}

export function StreamMonitor({
  executionIds = [],
}: StreamMonitorProps) {
  const { updates, isConnected, connect, disconnect, clearUpdates } = useStreaming();
  const updatesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new updates arrive
  useEffect(() => {
    updatesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [updates]);

  // Filter updates by executionIds if specified
  const filteredUpdates =
    executionIds.length > 0
      ? updates.filter((update) => executionIds.includes(update.executionId))
      : updates;

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
                className="px-3 py-1 text-sm bg-destructive text-destructive-foreground rounded hover:bg-destructive/90"
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
        {filteredUpdates.length === 0 ? (
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
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {update.executionId.slice(0, 8)}...
                  </span>
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
      <div className="border-t p-2 text-xs text-muted-foreground text-center">
        {filteredUpdates.length} update{filteredUpdates.length !== 1 ? "s" : ""}{" "}
        {executionIds.length > 0 ? "shown" : "received"}
        {executionIds.length > 0 && (
          <span> • Filtering {executionIds.length} execution(s)</span>
        )}
      </div>
    </div>
  );
}

