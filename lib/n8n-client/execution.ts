/**
 * n8n Execution Management
 * Handles execution polling, status checking, and result extraction
 */

import type { N8nExecution, N8nExecutionResponse, N8nWorkflowResponse } from "./types";
import { getN8nBaseUrl, getPollInterval, getApiKey } from "./config";
import {
  EXECUTION_LOOKUP_BUFFER_MS,
  MAX_WORKFLOW_ID_ATTEMPTS,
  MAX_TIME_BASED_ATTEMPTS,
} from "./constants";

// Simple logger utility
const logger = {
  info: (message: string, ...args: unknown[]) => {
    console.log(`[n8n-execution] ${message}`, ...args);
  },
  error: (message: string, error?: unknown) => {
    console.error(`[n8n-execution] ${message}`, error);
  },
};

/**
 * Get execution details from n8n API
 */
export async function getExecution(
  executionId: string,
): Promise<N8nExecution | null> {
  const baseUrl = getN8nBaseUrl();
  // Include includeData=true to get the full execution data with results
  const apiUrl = `${baseUrl}/api/v1/executions/${executionId}?includeData=true`;

  try {
    const options: RequestInit = {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    };

    // Add authentication if available
    const apiKey = getApiKey();
    if (apiKey) {
      options.headers = {
        ...options.headers,
        "X-N8N-API-KEY": apiKey,
      };
    }

    const response = await fetch(apiUrl, options);

    if (!response.ok) {
      logger.info(`getExecution failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as N8nExecution;
    return data;
  } catch (error) {
    logger.error("getExecution error:", error);
    return null;
  }
}

/**
 * Sort executions by start time in descending order
 */
function sortExecutionsByTime(executions: N8nExecution[]): N8nExecution[] {
  return executions.sort((a, b) => {
    const aTime = new Date(a.startedAt).getTime();
    const bTime = new Date(b.startedAt).getTime();
    return bTime - aTime; // Descending order
  });
}

/**
 * Filter executions that started after a given time
 */
function filterExecutionsByTime(
  executions: N8nExecution[],
  startedAfter: Date,
): N8nExecution[] {
  return executions.filter((exec) => {
    const startedAt = new Date(exec.startedAt);
    return startedAt >= startedAfter;
  });
}

/**
 * Find the best matching execution (prefer unfinished, then most recent)
 */
function selectBestExecution(executions: N8nExecution[]): string | null {
  if (executions.length === 0) return null;

  // Prefer unfinished executions
  const unfinished = executions.find((exec) => !exec.finished);
  if (unfinished) {
    logger.info(`Found unfinished execution: ${unfinished.id}`);
    return unfinished.id;
  }

  // Fall back to most recent finished execution
  logger.info(`All finished, returning most recent: ${executions[0].id}`);
  return executions[0].id;
}

/**
 * Find execution by workflow ID and recent timestamp
 * Used as fallback when execution ID is not in webhook response
 */
export async function findLatestExecution(
  workflowId: string,
  startedAfter: Date,
): Promise<string | null> {
  const baseUrl = getN8nBaseUrl();
  logger.info(
    `Finding latest execution for workflow: ${workflowId}, started after: ${startedAfter.toISOString()}`,
  );

  // Try both with and without workflowId parameter - some n8n versions use different endpoints
  const apiUrls = [
    `${baseUrl}/api/v1/executions?workflowId=${workflowId}&limit=20`,
    `${baseUrl}/api/v1/executions?limit=20`,
  ];

  for (const apiUrl of apiUrls) {
    try {
      logger.info(`Trying API URL: ${apiUrl}`);
      const options: RequestInit = {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      };

      // Add authentication if available
      const apiKey = getApiKey();
      if (apiKey) {
        options.headers = {
          ...options.headers,
          "X-N8N-API-KEY": apiKey,
        };
      }

      const response = await fetch(apiUrl, options);

      if (!response.ok) {
        logger.info(`API response not OK: ${response.status} ${response.statusText}`);
        if (response.status === 401) {
          logger.info(
            `Authentication failed - API key may be missing or invalid (configured: ${!!getApiKey()})`,
          );
        }
        continue; // Try next URL
      }

      const data = (await response.json()) as N8nExecutionResponse;
      logger.info(`Found ${data.data?.length || 0} executions`);

      if (!data.data || data.data.length === 0) {
        continue; // Try next URL
      }

      // Filter by workflow ID if not already filtered by API
      let executions = data.data;
      const isFiltered = apiUrl.includes("workflowId=");

      if (!isFiltered) {
        logger.info(
          `Filtering ${executions.length} executions for workflow ID: ${workflowId}`,
        );
        executions = executions.filter((exec) => exec.workflowId === workflowId);
        logger.info(`Filtered to ${executions.length} executions`);
      }

      // Find the most recent execution that started after our webhook call
      const recentExecutions = sortExecutionsByTime(
        filterExecutionsByTime(executions, startedAfter),
      );

      logger.info(`Recent executions (after time filter): ${recentExecutions.length}`);

      const executionId = selectBestExecution(recentExecutions);
      if (executionId) return executionId;

      // If no matches with workflow ID filter, try without it as a fallback
      // This handles cases where the webhook path UUID doesn't match the workflow ID
      if (executions.length === 0 && !isFiltered) {
        logger.info("No matches with workflow ID filter, trying all recent executions");
        const allRecentExecutions = sortExecutionsByTime(
          filterExecutionsByTime(data.data, startedAfter),
        );

        if (allRecentExecutions.length > 0) {
          logger.info(
            `Found ${allRecentExecutions.length} recent executions without workflow filter`,
          );
          logger.info(
            `Using most recent execution: ${allRecentExecutions[0].id} from workflow: ${allRecentExecutions[0].workflowId}`,
          );
          return allRecentExecutions[0].id;
        }
      }
    } catch (error) {
      logger.error("Error fetching executions:", error);
      continue; // Try next URL
    }
  }

  logger.info("No execution found");
  return null;
}

/**
 * Find latest execution by time only (fallback when workflow ID is unknown)
 */
export async function findLatestExecutionByTime(
  startedAfter: Date,
): Promise<string | null> {
  const baseUrl = getN8nBaseUrl();
  const apiUrl = `${baseUrl}/api/v1/executions?limit=20`;

  try {
    const options: RequestInit = {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    };

    // Add authentication if available
    const apiKey = getApiKey();
    if (apiKey) {
      options.headers = {
        ...options.headers,
        "X-N8N-API-KEY": apiKey,
      };
    }

    const response = await fetch(apiUrl, options);

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as N8nExecutionResponse;
    if (!data.data || data.data.length === 0) {
      return null;
    }

    // Find the most recent execution that started after our webhook call
    const recentExecutions = sortExecutionsByTime(
      filterExecutionsByTime(data.data, startedAfter),
    );

    return selectBestExecution(recentExecutions);
  } catch (error) {
    logger.error("Error in findLatestExecutionByTime:", error);
    return null;
  }
}

/**
 * Attempt to find execution ID via API lookup with retry logic
 * This function wraps findLatestExecution and findLatestExecutionByTime with retry attempts
 * and helpful logging for webhook use cases.
 */
export async function findExecutionViaApi(
  workflowId: string | null,
  startTime: number,
): Promise<string | null> {
  const hasApiKey = !!getApiKey();
  logger.info(`API key configured: ${hasApiKey}`);

  if (!hasApiKey) {
    logger.info("Skipping API lookup - no API key configured");
    logger.info("To track executions, either:");
    logger.info("  1. Set N8N_API_KEY in .env.local");
    logger.info("  2. Configure webhook to 'Wait for Webhook Response' mode in n8n");
    if (workflowId) {
      logger.info(`  3. Use workflow ID: ${workflowId}`);
    }
    return null;
  }

  logger.info("Attempting to find execution via API lookup");

  if (workflowId) {
    // Try multiple times with increasing delays
    for (let attempt = 0; attempt < MAX_WORKFLOW_ID_ATTEMPTS; attempt++) {
      logger.info(`Attempt ${attempt + 1} to find execution by workflow ID`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));

      const executionId = await findLatestExecution(
        workflowId,
        new Date(startTime - EXECUTION_LOOKUP_BUFFER_MS),
      );

      if (executionId) {
        logger.info(`Found execution ID: ${executionId}`);
        return executionId;
      }
    }
  } else {
    // Fallback: try to find any recent execution by time
    logger.info("No workflow ID, trying to find by time");
    for (let attempt = 0; attempt < MAX_TIME_BASED_ATTEMPTS; attempt++) {
      logger.info(`Attempt ${attempt + 1} to find execution by time`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));

      const executionId = await findLatestExecutionByTime(
        new Date(startTime - EXECUTION_LOOKUP_BUFFER_MS),
      );

      if (executionId) {
        logger.info(`Found execution ID: ${executionId}`);
        return executionId;
      }
    }
  }

  return null;
}

/**
 * Extract workflow result from completed execution
 */
export function extractWorkflowResult(execution: N8nExecution): unknown {
  logger.info(`Extracting result from execution: ${execution.id}`);
  logger.info(`Execution data structure: ${JSON.stringify(execution, null, 2)}`);
  
  // Try to extract result from the last node's output
  if (execution.data?.resultData?.runData) {
    const runData = execution.data.resultData.runData;
    const nodeIds = Object.keys(runData);
    logger.info(`Found ${nodeIds.length} nodes in runData: ${nodeIds.join(', ')}`);
    
    if (nodeIds.length > 0) {
      // Get the last node's output
      const lastNodeId = nodeIds[nodeIds.length - 1];
      const lastNodeData = runData[lastNodeId];
      logger.info(`Last node ID: ${lastNodeId}`);
      logger.info(`Last node data: ${JSON.stringify(lastNodeData, null, 2)}`);
      
      if (Array.isArray(lastNodeData) && lastNodeData.length > 0) {
        const lastExecution = lastNodeData[lastNodeData.length - 1];
        if (lastExecution && typeof lastExecution === "object") {
          const execData = lastExecution as Record<string, unknown>;
          logger.info(`Last execution data keys: ${Object.keys(execData).join(', ')}`);
          // Return the data from the last node
          const result = execData.data || execData.output || execData;
          logger.info(`Extracted result: ${JSON.stringify(result, null, 2)}`);
          return result;
        }
      }
    }
  } else {
    logger.info(`No runData found. Execution data keys: ${Object.keys(execution.data || {}).join(', ')}`);
  }

  // Fallback: return the execution data itself
  logger.info(`Using fallback result: ${JSON.stringify(execution.data || { status: execution.status }, null, 2)}`);
  return execution.data || { status: execution.status };
}

/**
 * Get all executions from n8n API with optional filters
 */
export async function getAllExecutions(
  limit: number = 100,
  workflowId?: string,
): Promise<N8nExecution[]> {
  const baseUrl = getN8nBaseUrl();
  let apiUrl = `${baseUrl}/api/v1/executions?limit=${limit}`;
  
  if (workflowId) {
    apiUrl += `&workflowId=${workflowId}`;
  }

  try {
    const options: RequestInit = {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    };

    // Add authentication if available
    const apiKey = getApiKey();
    if (apiKey) {
      options.headers = {
        ...options.headers,
        "X-N8N-API-KEY": apiKey,
      };
    }

    logger.info(`Fetching all executions from: ${apiUrl}`);
    const response = await fetch(apiUrl, options);

    if (!response.ok) {
      logger.error(`Failed to fetch executions: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = (await response.json()) as N8nExecutionResponse;
    const executions = data.data || [];
    logger.info(`Found ${executions.length} executions`);
    return executions;
  } catch (error) {
    logger.error("Error fetching all executions:", error);
    return [];
  }
}

/**
 * Get detailed execution information including full data
 */
export async function getExecutionDetails(executionId: string): Promise<N8nExecution | null> {
  return await getExecution(executionId);
}

/**
 * List all executions with their events and data
 */
export async function listAllExecutionsWithDetails(
  limit: number = 100,
  workflowId?: string,
): Promise<Array<{
  id: string;
  workflowId: string;
  status: string;
  finished: boolean;
  startedAt: string;
  stoppedAt?: string;
  mode: string;
  retryOf?: string;
  data?: {
    resultData?: {
      runData?: Record<string, unknown[]>;
    };
    error?: unknown;
  };
  fullData?: unknown;
}>> {
  const executions = await getAllExecutions(limit, workflowId);
  
  // Fetch detailed data for each execution
  const detailedExecutions = await Promise.all(
    executions.map(async (exec) => {
      const details = await getExecutionDetails(exec.id);
      return {
        id: exec.id,
        workflowId: exec.workflowId,
        status: exec.status,
        finished: exec.finished,
        startedAt: exec.startedAt,
        stoppedAt: exec.stoppedAt,
        mode: exec.mode,
        retryOf: exec.retryOf,
        data: exec.data,
        fullData: details?.data,
      };
    })
  );

  return detailedExecutions;
}

/**
 * Poll execution status until completion
 */
export async function pollExecutionStatus(
  executionId: string,
  timeout: number,
  startTime: number = Date.now(),
): Promise<N8nWorkflowResponse> {
  const pollInterval = getPollInterval();
  logger.info(
    `Starting to poll execution: ${executionId}, timeout: ${timeout}ms, pollInterval: ${pollInterval}ms`,
  );

  while (Date.now() - startTime < timeout) {
    const execution = await getExecution(executionId);
    const elapsed = Date.now() - startTime;

    if (!execution) {
      logger.info(`Execution not found yet, elapsed: ${elapsed}ms`);
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      continue;
    }

    logger.info(
      `Execution status: id=${execution.id}, finished=${execution.finished}, status=${execution.status}, elapsed=${elapsed}ms`,
    );

    // Check if execution is finished
    // Note: Some n8n executions may have status=error but finished=false
    // If stoppedAt is set, consider it finished
    const isActuallyFinished = execution.finished || 
      (execution.status === "error" && execution.stoppedAt) ||
      (execution.status === "canceled" && execution.stoppedAt);

    if (isActuallyFinished) {
      logger.info(`Execution finished with status: ${execution.status} (finished=${execution.finished}, stoppedAt=${execution.stoppedAt})`);

      if (execution.status === "success") {
        const result = extractWorkflowResult(execution);
        return {
          success: true,
          data: result,
          executionId: execution.id,
        };
      }

      if (execution.status === "error") {
        // Try to extract error message from execution data
        const errorMessage = execution.data?.error?.message || 
                           execution.data?.error?.error?.message ||
                           `Workflow execution failed: ${execution.status}`;
        
        logger.error(`Execution error: ${errorMessage}`);
        return {
          success: false,
          error: errorMessage,
          executionId: execution.id,
        };
      }

      if (execution.status === "canceled") {
        return {
          success: false,
          error: "Workflow execution was canceled",
          executionId: execution.id,
        };
      }
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  logger.info("Polling timeout reached");
  return {
    success: false,
    error: "Workflow execution timeout - workflow took too long to complete",
  };
}

