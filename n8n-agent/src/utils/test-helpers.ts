/**
 * Utilities for parsing and processing n8n test execution results
 */

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
  output?: any;
  error?: string;
  errorDetails?: any;
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
export function parseExecutionOutput(stdout: string): any {
  const lines = stdout.split('\n');
  const separatorIndex = lines.findIndex(line => line.trim().startsWith('==='));
  
  if (separatorIndex >= 0 && separatorIndex < lines.length - 1) {
    // JSON block after separator line
    const jsonLines = lines.slice(separatorIndex + 1).join('\n');
    return JSON.parse(jsonLines.trim());
  } else {
    // Fallback: try to find JSON object anywhere in output
    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON found in execution output');
  }
}

/**
 * Extract workflow results from n8n execution JSON
 * @param executionJson - Parsed execution JSON from n8n
 * @returns Result object with success status, output, or error details
 */
export function extractWorkflowResults(executionJson: any): ExecutionResult {
  try {
    const runData = executionJson?.data?.resultData?.runData;
    if (!runData) {
      return { success: false, error: 'No execution data found' };
    }

    // Find the workflow execution node (starts with "Run: ")
    const workflowNodeName = Object.keys(runData).find(name => name.startsWith('Run: '));
    if (!workflowNodeName) {
      // Check for errors in other nodes
      const errorNodes = Object.entries(runData).filter(([_, data]: [string, any]) => 
        Array.isArray(data) && data.some((exec: any) => exec.executionStatus === 'error')
      );
      if (errorNodes.length > 0) {
        const [nodeName, nodeData] = errorNodes[0];
        const errorExec = (nodeData as any[]).find((exec: any) => exec.executionStatus === 'error');
        return { 
          success: false, 
          error: `Error in ${nodeName}: ${errorExec?.error?.message || 'Unknown error'}`,
          errorDetails: errorExec?.error
        };
      }
      return { success: false, error: 'Workflow execution node not found' };
    }

    const workflowNodeData = runData[workflowNodeName];
    if (!workflowNodeData || workflowNodeData.length === 0) {
      return { success: false, error: 'Workflow execution data is empty' };
    }

    const execution = workflowNodeData[0];
    
    // Check for execution errors
    if (execution.executionStatus !== 'success') {
      const errorMessage = execution.error?.message || execution.error || 'Workflow execution failed';
      return { 
        success: false, 
        error: errorMessage,
        errorDetails: execution.error
      };
    }

    // Extract output from the workflow execution
    const outputData = execution.data?.main;
    if (!outputData || outputData.length === 0 || outputData[0].length === 0) {
      return { success: true, output: null };
    }

    // Return the first item's JSON (workflow output)
    const output = outputData[0][0]?.json;
    return { success: true, output };
    
  } catch (error) {
    return { 
      success: false, 
      error: `Failed to parse execution result: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
}

