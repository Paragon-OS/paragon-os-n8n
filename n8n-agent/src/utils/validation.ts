/**
 * Runtime validation utilities for parsed JSON structures
 */

import type {
  N8nExecutionJson,
  N8nFullExecutionJson,
  N8nRawOutputArray,
  N8nRawOutputObject,
} from '../types/n8n';
import {
  isN8nFullExecutionJson,
  isN8nRawOutputArray,
  isN8nRawOutputObject,
} from '../types/n8n';

/**
 * Validate and parse JSON string with runtime type checking
 * @param jsonString - JSON string to parse
 * @param expectedType - Optional type name for error messages
 * @returns Parsed JSON object
 * @throws Error if JSON is invalid or doesn't match expected structure
 */
export function validateAndParseJson<T = unknown>(
  jsonString: string,
  expectedType?: string
): T {
  try {
    const parsed = JSON.parse(jsonString);
    return parsed as T;
  } catch (error) {
    const typeHint = expectedType ? ` (expected ${expectedType})` : '';
    throw new Error(
      `Invalid JSON${typeHint}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Validate n8n execution JSON structure
 * @param value - Value to validate
 * @returns Validated N8nExecutionJson
 * @throws Error if value doesn't match n8n execution JSON structure
 */
export function validateN8nExecutionJson(
  value: unknown
): N8nExecutionJson {
  if (isN8nFullExecutionJson(value)) {
    return value;
  }
  if (isN8nRawOutputArray(value)) {
    return value;
  }
  if (isN8nRawOutputObject(value)) {
    return value;
  }
  throw new Error(
    'Value does not match n8n execution JSON structure. Expected one of: full execution JSON, raw output array, or raw output object.'
  );
}

/**
 * Validate workflow JSON structure
 * @param value - Value to validate
 * @returns Validated workflow object
 * @throws Error if value doesn't match workflow structure
 */
export function validateWorkflowJson(value: unknown): {
  id?: string;
  name?: string;
  nodes?: unknown[];
  [key: string]: unknown;
} {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Workflow JSON must be an object');
  }
  return value as {
    id?: string;
    name?: string;
    nodes?: unknown[];
    [key: string]: unknown;
  };
}

