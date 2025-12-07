/**
 * Utilities for parsing and processing n8n test execution results
 */

import type {
  N8nExecutionJson,
  N8nFullExecutionJson,
  N8nRawOutputArray,
  N8nRawOutputObject,
  N8nExecutionError,
} from '../types/n8n';
import {
  isN8nFullExecutionJson,
  isN8nRawOutputArray,
  isN8nRawOutputObject,
} from '../types/n8n';

export interface WorkflowFile {
  path: string;
  content: {
    id?: string;
    name?: string;
  };
  basename: string;
}

export interface ExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  errorDetails?: N8nExecutionError;
}

/**
 * Find workflow file by matching ID, name, or basename
 * @param workflowIdentifier - Workflow ID, name, or basename to match
 * @param workflowFiles - Array of workflow file objects to search
 * @returns Path to matching workflow file, or undefined if not found
 */
export function findWorkflowFile(
  workflowIdentifier: string,
  workflowFiles: WorkflowFile[]
): string | undefined {
  for (const file of workflowFiles) {
    // Match by ID (most reliable)
    if (file.content.id === workflowIdentifier) {
      return file.path;
    }

    // Match by exact name
    if (file.content.name === workflowIdentifier) {
      return file.path;
    }

    // Match by basename (fallback for workflows without proper name/ID)
    const basenameWithoutTag = file.basename.replace(/\[.*?\]\s*/, '');
    if (file.basename === workflowIdentifier || basenameWithoutTag === workflowIdentifier) {
      return file.path;
    }
  }

  return undefined;
}

/**
 * Parse JSON from n8n execution output
 * Handles various output formats with separator lines or embedded JSON
 * @param stdout - Raw stdout from n8n execute command
 * @returns Parsed execution JSON object
 * @throws Error if JSON cannot be parsed
 */
export function parseExecutionOutput(stdout: string): N8nExecutionJson {
  const trimmed = stdout.trim();
  
  // Try to parse the entire output as JSON first (for --rawOutput format)
  try {
    const parsed = JSON.parse(trimmed);
    if (isN8nExecutionJson(parsed)) {
      return parsed;
    }
  } catch {
    // Not valid JSON, continue with other parsing methods
  }

  const lines = stdout.split('\n');
  const separatorIndex = lines.findIndex(line => line.trim().startsWith('==='));
  
  if (separatorIndex >= 0 && separatorIndex < lines.length - 1) {
    // JSON block after separator line
    const jsonLines = lines.slice(separatorIndex + 1).join('\n');
    try {
      const parsed = JSON.parse(jsonLines.trim());
      if (isN8nExecutionJson(parsed)) {
        return parsed;
      }
    } catch {
      // Continue to fallback
    }
  }
  
  // Fallback: try to find JSON object or array anywhere in output
  const jsonMatch = stdout.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (isN8nExecutionJson(parsed)) {
        return parsed;
      }
    } catch {
      // Continue to error
    }
  }
  
  throw new Error('No JSON found in execution output');
}

/**
 * Type guard helper for parsing - more lenient to accept any object/array
 * The actual validation happens in extractWorkflowResults
 */
function isN8nExecutionJson(value: unknown): value is N8nExecutionJson {
  // Accept any object or array as potential n8n execution JSON
  // Actual structure validation happens in extractWorkflowResults
  return typeof value === 'object' && value !== null;
}

/**
 * Extract workflow results from n8n execution JSON
 * @param executionJson - Parsed execution JSON from n8n
 * @returns Result object with success status, output, or error details
 */
export function extractWorkflowResults(
  executionJson: N8nExecutionJson
): ExecutionResult {
  try {
    // Handle --rawOutput format: direct workflow output (array)
    if (isN8nRawOutputArray(executionJson)) {
      // Empty array indicates failure or no output
      if (executionJson.length === 0) {
        return { 
          success: false, 
          error: 'Workflow returned empty output (possible error in sub-workflow)' 
        };
      }
      
      const firstItem = executionJson[0];
      
      // Check for error indicators in raw output
      if (firstItem && typeof firstItem === 'object') {
        // Check for error fields
        if ('error' in firstItem || 'errorMessage' in firstItem || 'message' in firstItem) {
          const errorMsg = 
            (firstItem as { error?: { message?: string }; errorMessage?: string; message?: string }).error?.message ||
            (firstItem as { errorMessage?: string }).errorMessage ||
            (firstItem as { message?: string }).message ||
            'Unknown error in workflow execution';
          return {
            success: false,
            error: errorMsg,
            errorDetails: firstItem as N8nExecutionError,
          };
        }
        
        // Check if it looks like workflow output (has 'output' field)
        if ('output' in firstItem) {
          return { success: true, output: firstItem };
        }
      }
      
      // If we have items but they don't match expected format, return them
      return { success: true, output: executionJson };
    }

    // Handle direct object output (--rawOutput single object)
    if (isN8nRawOutputObject(executionJson)) {
      // Check for error indicators
      if ('error' in executionJson || 'errorMessage' in executionJson) {
        const errorMsg = 
          (executionJson as { error?: { message?: string }; errorMessage?: string }).error?.message ||
          (executionJson as { errorMessage?: string }).errorMessage ||
          'Unknown error in workflow execution';
        return {
          success: false,
          error: errorMsg,
          errorDetails: executionJson as unknown as N8nExecutionError,
        };
      }
      return { success: true, output: executionJson };
    }

    // Handle full execution JSON structure (default format)
    if (isN8nFullExecutionJson(executionJson)) {
      const runData = executionJson.data?.resultData?.runData;
      if (!runData) {
        // Check if there's a top-level error in resultData
        const topLevelError = executionJson.data?.resultData?.error;
        if (topLevelError) {
          const errorMsg = 
            (topLevelError && typeof topLevelError === 'object' && 'message' in topLevelError
              ? (topLevelError as { message?: string }).message
              : undefined) ||
            (typeof topLevelError === 'string' ? topLevelError : 'Workflow execution failed');
          return {
            success: false,
            error: errorMsg,
            errorDetails: topLevelError as N8nExecutionError,
          };
        }
        return { success: false, error: 'No execution data found' };
      }

      // FIRST: Check ALL nodes for errors (including sub-workflow nodes)
      const errorNodes = Object.entries(runData).filter(
        ([, data]) =>
          Array.isArray(data) &&
          data.some((exec) => exec.executionStatus === 'error')
      );
      
      if (errorNodes.length > 0) {
        // Find the most relevant error (prefer "Run: " nodes, but any error is important)
        const runNodeError = errorNodes.find(([name]) => name.startsWith('Run: '));
        const [nodeName, nodeData] = runNodeError || errorNodes[0];
        
        if (Array.isArray(nodeData)) {
          const errorExec = nodeData.find(
            (exec) => exec.executionStatus === 'error'
          );
          if (errorExec) {
            const errorObj = errorExec.error;
            const errorMessage = 
              (errorObj && typeof errorObj === 'object' && 'message' in errorObj 
                ? (errorObj as { message?: string }).message 
                : undefined) ||
              (typeof errorObj === 'string' ? errorObj : 'Unknown error');
            return {
              success: false,
              error: `Error in ${nodeName}: ${errorMessage}`,
              errorDetails: errorObj as N8nExecutionError,
            };
          }
        }
      }

      // SECOND: Find the workflow execution node (starts with "Run: ")
      const workflowNodeName = Object.keys(runData).find((name) =>
        name.startsWith('Run: ')
      );
      if (!workflowNodeName) {
        return {
          success: false,
          error: 'Workflow execution node not found',
        };
      }

      const workflowNodeData = runData[workflowNodeName];
      if (!workflowNodeData || workflowNodeData.length === 0) {
        return {
          success: false,
          error: 'Workflow execution data is empty',
        };
      }

      const execution = workflowNodeData[0];

      // Check for execution errors
      if (execution.executionStatus !== 'success') {
        const errorMessage =
          execution.error?.message ||
          (typeof execution.error === 'string'
            ? execution.error
            : 'Workflow execution failed');
        return {
          success: false,
          error: errorMessage,
          errorDetails: execution.error,
        };
      }

      // Extract output from the workflow execution
      const outputData = execution.data?.main;
      if (
        !outputData ||
        outputData.length === 0 ||
        outputData[0].length === 0
      ) {
        return { success: true, output: null };
      }

      // Return the first item's JSON (workflow output)
      const output = outputData[0][0]?.json;
      return { success: true, output };
    }

    // Fallback: if it doesn't match known formats, check if it's a valid object/array
    // If it's null, empty object, or doesn't have expected structure, return error
    if (
      executionJson === null ||
      (typeof executionJson === 'object' &&
        !Array.isArray(executionJson) &&
        Object.keys(executionJson).length === 0)
    ) {
      return { success: false, error: 'No execution data found' };
    }
    
    // Return the raw JSON if it doesn't match known formats but is still valid
    return { success: true, output: executionJson };
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse execution result: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}


