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
      const firstItem = executionJson[0];
      // Check if it looks like workflow output (has 'output' field)
      if (
        firstItem &&
        typeof firstItem === 'object' &&
        'output' in firstItem
      ) {
        return { success: true, output: firstItem };
      }
    }

    // Handle direct object output (--rawOutput single object)
    if (isN8nRawOutputObject(executionJson)) {
      return { success: true, output: executionJson };
    }

    // Handle full execution JSON structure (default format)
    if (isN8nFullExecutionJson(executionJson)) {
      const runData = executionJson.data?.resultData?.runData;
      if (!runData) {
        return { success: false, error: 'No execution data found' };
      }

      // Find the workflow execution node (starts with "Run: ")
      const workflowNodeName = Object.keys(runData).find((name) =>
        name.startsWith('Run: ')
      );
      if (!workflowNodeName) {
        // Check for errors in other nodes
        const errorNodes = Object.entries(runData).filter(
          ([, data]) =>
            Array.isArray(data) &&
            data.some((exec) => exec.executionStatus === 'error')
        );
        if (errorNodes.length > 0) {
          const [nodeName, nodeData] = errorNodes[0];
          if (Array.isArray(nodeData)) {
            const errorExec = nodeData.find(
              (exec) => exec.executionStatus === 'error'
            );
            return {
              success: false,
              error: `Error in ${nodeName}: ${
                errorExec?.error?.message || 'Unknown error'
              }`,
              errorDetails: errorExec?.error,
            };
          }
        }
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


