/**
 * Type definitions for n8n workflow structures and execution results
 */

/**
 * n8n workflow node structure
 */
export interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion?: number;
  position: [number, number];
  parameters?: Record<string, unknown>;
  alwaysOutputData?: boolean;
  retryOnFail?: boolean;
  maxTries?: number;
  [key: string]: unknown;
}

/**
 * n8n workflow node with executeWorkflowTrigger type
 */
export interface ExecuteWorkflowTriggerNode extends N8nNode {
  type: 'n8n-nodes-base.executeWorkflowTrigger';
  parameters?: {
    workflowInputs?: {
      values?: Array<{
        name: string;
        type?: string;
        required?: boolean;
      } | string>;
    };
    [key: string]: unknown;
  };
}

/**
 * n8n workflow structure
 */
export interface N8nWorkflow {
  id?: string;
  name?: string;
  nodes?: N8nNode[];
  [key: string]: unknown;
}

/**
 * n8n execution error structure
 */
export interface N8nExecutionError {
  message?: string;
  name?: string;
  stack?: string;
  [key: string]: unknown;
}

/**
 * n8n node execution data structure
 */
export interface N8nNodeExecutionData {
  json?: Record<string, unknown>;
  binary?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * n8n node execution result
 */
export interface N8nNodeExecution {
  executionStatus: 'success' | 'error' | 'waiting' | 'running';
  error?: N8nExecutionError;
  data?: {
    main?: N8nNodeExecutionData[][];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * n8n execution run data structure
 */
export interface N8nExecutionRunData {
  [nodeName: string]: N8nNodeExecution[];
}

/**
 * n8n execution result data structure
 */
export interface N8nExecutionResultData {
  runData?: N8nExecutionRunData;
  [key: string]: unknown;
}

/**
 * n8n full execution JSON structure (default format)
 */
export interface N8nFullExecutionJson {
  data?: {
    resultData?: N8nExecutionResultData;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * n8n raw output format (array of workflow outputs)
 */
export type N8nRawOutputArray = Array<{
  output?: unknown;
  [key: string]: unknown;
}>;

/**
 * n8n raw output format (single workflow output object)
 */
export interface N8nRawOutputObject {
  output?: unknown;
  [key: string]: unknown;
}

/**
 * Union type for all possible n8n execution JSON formats
 */
export type N8nExecutionJson =
  | N8nFullExecutionJson
  | N8nRawOutputArray
  | N8nRawOutputObject
  | unknown;

/**
 * Type guard to check if value is a valid n8n execution JSON
 */
export function isN8nExecutionJson(value: unknown): value is N8nExecutionJson {
  return (
    typeof value === 'object' &&
    value !== null &&
    (Array.isArray(value) || 'data' in value || 'output' in value)
  );
}

/**
 * Type guard to check if value is N8nFullExecutionJson
 */
export function isN8nFullExecutionJson(
  value: unknown
): value is N8nFullExecutionJson {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    typeof (value as N8nFullExecutionJson).data === 'object' &&
    (value as N8nFullExecutionJson).data !== null
  );
}

/**
 * Type guard to check if value is N8nRawOutputArray
 */
export function isN8nRawOutputArray(
  value: unknown
): value is N8nRawOutputArray {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Type guard to check if value is N8nRawOutputObject
 */
export function isN8nRawOutputObject(
  value: unknown
): value is N8nRawOutputObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    'output' in value &&
    !('data' in value)
  );
}

/**
 * Type guard to check if node is ExecuteWorkflowTriggerNode
 */
export function isExecuteWorkflowTriggerNode(
  node: N8nNode
): node is ExecuteWorkflowTriggerNode {
  return node.type === 'n8n-nodes-base.executeWorkflowTrigger';
}

