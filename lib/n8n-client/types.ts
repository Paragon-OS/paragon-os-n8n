/**
 * n8n Client Types
 * Type definitions for n8n workflow calls and responses
 */

/**
 * Streaming update from n8n workflow execution
 */
export interface StreamUpdate {
  executionId: string;
  stage: string;
  status: "in_progress" | "completed" | "error" | "info";
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/**
 * Callbacks for streaming workflow execution updates
 */
export interface StreamingCallbacks {
  onStart?: (executionId: string, workflowId?: string) => void;
  onUpdate?: (update: StreamUpdate) => void;
  onComplete?: (result: unknown, executionId: string) => void;
  onError?: (error: string, executionId?: string) => void;
}

export interface N8nWorkflowCallOptions {
  webhookUrl?: string;
  workflowId?: string;
  method?: "GET" | "POST";
  payload?: Record<string, unknown>;
  timeout?: number;
  waitForCompletion?: boolean; // Override default wait behavior
  streaming?: StreamingCallbacks; // Enable streaming mode with callbacks
}

export interface N8nWorkflowResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  executionId?: string; // Execution ID when available
  workflowId?: string; // Workflow ID extracted from webhook URL
  streaming?: boolean; // True if response is in streaming mode (immediate return)
}

/**
 * n8n Execution API response types
 */
export interface N8nExecution {
  id: string;
  finished: boolean;
  stoppedAt?: string;
  startedAt: string;
  workflowId: string;
  mode: string;
  retryOf?: string;
  retrySuccessId?: string;
  status: "success" | "error" | "waiting" | "running" | "canceled";
  data?: {
    resultData?: {
      runData?: Record<string, unknown[]>;
    };
    error?: {
      message?: string;
      error?: {
        message?: string;
      };
    };
  };
}

export interface N8nExecutionResponse {
  data?: N8nExecution[];
}

