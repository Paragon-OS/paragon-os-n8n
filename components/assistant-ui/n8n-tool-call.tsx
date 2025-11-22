"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LoaderIcon,
  XIcon,
  WorkflowIcon,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { N8nConfirmationDialog } from "./n8n-confirmation-dialog";
import {
  requiresConfirmation,
  getWorkflowDescription,
  type WorkflowName,
} from "@/lib/n8n-config";
import { cn } from "@/lib/utils";
import { useStreaming } from "./streaming-context";
import { extractExecutionId } from "@/lib/n8n-client/webhook-utils";
import { useExecutionStore } from "@/lib/execution-store";

export const N8nToolCall: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isUpdatesExpanded, setIsUpdatesExpanded] = useState(false);
  const { updates } = useStreaming();
  const registerExecution = useExecutionStore((state) => state.registerExecution);
  const getExecution = useExecutionStore((state) => state.getExecution);

  // Parse arguments
  let args: Record<string, unknown> = {};
  try {
    args = argsText ? JSON.parse(argsText) : {};
  } catch {
    // If parsing fails, treat as plain text
    args = { raw: argsText };
  }

  // Parse result
  let resultData: unknown = null;
  let resultSuccess = true;
  let resultError: string | null = null;

  if (result !== undefined) {
    if (typeof result === "string") {
      try {
        resultData = JSON.parse(result);
        const parsed = resultData as Record<string, unknown>;
        resultSuccess = parsed.success !== false;
        resultError = (typeof parsed.error === "string" ? parsed.error : null) || null;
      } catch {
        resultData = result;
      }
    } else {
      resultData = result;
      const dataObj = resultData && typeof resultData === "object" ? resultData as Record<string, unknown> : null;
      resultSuccess = dataObj?.success !== false;
      resultError = (dataObj && typeof dataObj.error === "string" ? dataObj.error : null) || null;
    }
  }

  // Extract executionId from resultData
  const executionId = useMemo(() => {
    if (!resultData) return null;
    return extractExecutionId(resultData);
  }, [resultData]);

  // Register execution in store when executionId is found
  useEffect(() => {
    if (executionId && resultData) {
      const dataObj = resultData && typeof resultData === "object" ? resultData as Record<string, unknown> : null;
      const workflowId = dataObj?.workflowId as string | undefined;
      
      registerExecution(executionId, {
        workflowId,
        status: resultSuccess ? "completed" : "error",
      });
    }
  }, [executionId, resultData, resultSuccess, registerExecution]);

  // Get execution metadata from store
  const executionMetadata = executionId ? getExecution(executionId) : undefined;

  // Filter updates by executionId
  const filteredUpdates = useMemo(() => {
    if (!executionId) return [];
    return updates.filter((update) => update.executionId === executionId);
  }, [updates, executionId]);

  // Auto-expand updates section when new updates arrive
  useEffect(() => {
    if (filteredUpdates.length > 0 && !isUpdatesExpanded) {
      setIsUpdatesExpanded(true);
    }
  }, [filteredUpdates.length, isUpdatesExpanded]);

  // Check if this workflow requires confirmation
  const needsConfirmation =
    requiresConfirmation(toolName as WorkflowName) &&
    result === undefined;

  const handleConfirm = () => {
    setIsExecuting(true);
    setShowConfirmation(false);
    // The actual execution happens server-side, this is just for UI feedback
    // In a real implementation, you might want to trigger a re-execution here
  };

  const handleCancel = () => {
    setShowConfirmation(false);
  };

  // Determine status icon and color
  const getStatusInfo = () => {
    if (result === undefined) {
      return {
        icon: LoaderIcon,
        color: "text-blue-500",
        bgColor: "bg-blue-50 dark:bg-blue-950/20",
        borderColor: "border-blue-200 dark:border-blue-900/50",
        status: "Executing...",
      };
    }
    if (resultSuccess) {
      return {
        icon: CheckIcon,
        color: "text-green-500",
        bgColor: "bg-green-50 dark:bg-green-950/20",
        borderColor: "border-green-200 dark:border-green-900/50",
        status: "Completed",
      };
    }
    return {
      icon: XIcon,
      color: "text-red-500",
      bgColor: "bg-red-50 dark:bg-red-950/20",
      borderColor: "border-red-200 dark:border-red-900/50",
      status: "Failed",
    };
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;

  // Helper functions for displaying updates
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

  return (
    <>
      <div
        className={cn(
          "aui-n8n-tool-call-root mb-4 flex w-full flex-col gap-3 rounded-lg border py-3",
          statusInfo.bgColor,
          statusInfo.borderColor,
        )}
      >
        <div className="aui-n8n-tool-call-header flex items-center gap-2 px-4">
          <div className="flex items-center gap-2 flex-grow">
            <WorkflowIcon className={cn("size-4", statusInfo.color)} />
            <StatusIcon className={cn("size-4", statusInfo.color)} />
            <div className="flex-grow">
              <p className="aui-n8n-tool-call-title font-medium">
                n8n Workflow: <b>{toolName}</b>
              </p>
              <p className="text-xs text-muted-foreground">
                {statusInfo.status}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="size-8"
          >
            {isCollapsed ? (
              <ChevronUpIcon className="size-4" />
            ) : (
              <ChevronDownIcon className="size-4" />
            )}
          </Button>
        </div>

        {!isCollapsed && (
          <div className="aui-n8n-tool-call-content flex flex-col gap-2 border-t pt-2">
            <div className="aui-n8n-tool-call-args-root px-4">
              <p className="text-xs font-semibold text-muted-foreground mb-1">
                Parameters:
              </p>
              <pre className="aui-n8n-tool-call-args-value whitespace-pre-wrap text-xs bg-background/50 rounded p-2 overflow-auto max-h-48">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>

            {result !== undefined && (
              <div className="aui-n8n-tool-call-result-root border-t border-dashed px-4 pt-2">
                <p className="aui-n8n-tool-call-result-header text-xs font-semibold mb-1">
                  {resultSuccess ? "Result:" : "Error:"}
                </p>
                <pre
                  className={cn(
                    "aui-n8n-tool-call-result-content whitespace-pre-wrap text-xs rounded p-2 overflow-auto max-h-48",
                    resultSuccess
                      ? "bg-background/50"
                      : "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300",
                  )}
                >
                  {resultError
                    ? resultError
                    : typeof resultData === "string"
                      ? resultData
                      : JSON.stringify(resultData, null, 2)}
                </pre>
              </div>
            )}

            {/* Stream Updates Section */}
            {executionId && filteredUpdates.length > 0 && (
              <div className="aui-n8n-tool-call-updates-root border-t border-dashed px-4 pt-2">
                <div className="flex items-center justify-between mb-2">
                  <p className="aui-n8n-tool-call-updates-header text-xs font-semibold">
                    Stream Updates{" "}
                    <span className="text-muted-foreground font-normal">
                      ({filteredUpdates.length})
                    </span>
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsUpdatesExpanded(!isUpdatesExpanded)}
                    className="size-6 h-6"
                  >
                    {isUpdatesExpanded ? (
                      <ChevronUpIcon className="size-3" />
                    ) : (
                      <ChevronDownIcon className="size-3" />
                    )}
                  </Button>
                </div>
                {isUpdatesExpanded && (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {filteredUpdates.map((update, index) => (
                      <div
                        key={`${update.executionId}-${update.timestamp}-${index}`}
                        className="border rounded p-2 bg-background/50 text-xs"
                      >
                        <div className="flex items-start justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {update.executionId.slice(0, 8)}...
                            </span>
                            <span
                              className={cn(
                                "text-[10px] font-semibold uppercase",
                                getStatusTextColor(update.status),
                              )}
                            >
                              {update.stage}
                            </span>
                          </div>
                          <span
                            className={cn(
                              "px-1.5 py-0.5 text-[10px] font-medium rounded text-white",
                              getStatusColor(update.status),
                            )}
                          >
                            {update.status}
                          </span>
                        </div>
                        <div className="text-xs mb-1">{update.message}</div>
                        <div className="text-[10px] text-muted-foreground mb-1">
                          {new Date(update.timestamp).toLocaleString()}
                        </div>
                        {update.data &&
                          Object.keys(update.data).length > 0 && (
                            <div className="mt-1 p-1.5 bg-muted/50 rounded text-[10px] font-mono overflow-x-auto">
                              <pre className="whitespace-pre-wrap">
                                {JSON.stringify(update.data, null, 2)}
                              </pre>
                            </div>
                          )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {needsConfirmation && result === undefined && (
              <div className="px-4 pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowConfirmation(true)}
                  disabled={isExecuting}
                >
                  {isExecuting ? "Executing..." : "View Details & Confirm"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {showConfirmation && (
        <N8nConfirmationDialog
          open={showConfirmation}
          onOpenChange={setShowConfirmation}
          workflowName={toolName}
          workflowDescription={getWorkflowDescription(toolName as WorkflowName)}
          parameters={args}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </>
  );
};
