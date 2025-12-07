/**
 * n8n REST API Client
 * Replaces CLI calls with direct API calls for better performance and reliability
 */

// Load environment variables from .env file if it exists
// This is safe to call multiple times - dotenv only loads if not already loaded
import 'dotenv/config';

import axios, { AxiosInstance, AxiosError } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

export interface N8nApiConfig {
  baseURL?: string;
  apiKey?: string;
  sessionCookie?: string;
  timeout?: number;
}

export interface Workflow {
  id: string;
  name: string;
  active: boolean;
  nodes: unknown[];
  connections: unknown;
  settings?: unknown;
  staticData?: unknown;
  tags?: Array<{ id: string; name: string }>;
  [key: string]: unknown;
}

export interface N8nExecutionResponse {
  id: string;
  finished: boolean;
  mode: string;
  retryOf?: string;
  retrySuccessId?: string;
  startedAt: string;
  stoppedAt?: string;
  workflowId: string;
  workflowData: Workflow;
  data: {
    resultData: {
      runData: Record<string, Array<{
        executionStatus: 'success' | 'error' | 'waiting' | 'canceled';
        data?: {
          main: Array<Array<{ json: unknown }>>;
        };
        error?: {
          message: string;
          name?: string;
          stack?: string;
        };
        [key: string]: unknown;
      }>>;
      error?: unknown;
    };
  };
  [key: string]: unknown;
}

/**
 * Get n8n base URL from environment or use default
 */
function getN8nBaseUrl(): string {
  return process.env.N8N_URL || process.env.N8N_BASE_URL || 'http://localhost:5678';
}

/**
 * Get n8n API key from environment
 */
function getN8nApiKey(): string | undefined {
  return process.env.N8N_API_KEY || process.env.N8N_API_TOKEN;
}

/**
 * Get n8n session cookie from environment (for web UI login)
 */
function getN8nSessionCookie(): string | undefined {
  return process.env.N8N_SESSION_COOKIE || process.env.N8N_COOKIE;
}

/**
 * Create axios instance with n8n API configuration
 */
function createApiClient(config?: N8nApiConfig): AxiosInstance {
  const baseURL = config?.baseURL || getN8nBaseUrl();
  const apiKey = config?.apiKey || getN8nApiKey();
  const sessionCookie = config?.sessionCookie || getN8nSessionCookie();
  const timeout = config?.timeout || 120000; // 2 minutes default

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Prefer API key over session cookie
  if (apiKey) {
    headers['X-N8N-API-KEY'] = apiKey;
  } else if (sessionCookie) {
    headers['Cookie'] = sessionCookie;
  }

  const client = axios.create({
    baseURL: `${baseURL}/api/v1`,
    headers,
    timeout,
    validateStatus: (status) => status < 500, // Don't throw on 4xx
    withCredentials: true, // Support cookie-based auth
  });

  // Add response interceptor for better error handling
  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to n8n at ${baseURL}. Is n8n running?`);
      }
      if (error.code === 'ETIMEDOUT') {
        throw new Error(`Request to n8n timed out after ${timeout}ms`);
      }
      throw error;
    }
  );

  return client;
}

let defaultClient: AxiosInstance | null = null;

/**
 * Get or create default API client instance
 */
function getDefaultClient(): AxiosInstance {
  if (!defaultClient) {
    defaultClient = createApiClient();
  }
  return defaultClient;
}

/**
 * Export all workflows from n8n
 */
export async function exportWorkflows(config?: N8nApiConfig): Promise<Workflow[]> {
  const client = config ? createApiClient(config) : getDefaultClient();

  try {
    const response = await client.get<Workflow[]>('/workflows');
    if (response.status !== 200) {
      throw new Error(`Failed to export workflows: ${response.status} ${response.statusText}`);
    }
    return Array.isArray(response.data) ? response.data : [response.data];
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.message || error.message;
      throw new Error(`Failed to export workflows: ${message}`);
    }
    throw error;
  }
}

/**
 * Clean workflow data for API submission
 * Removes metadata fields that n8n API doesn't accept
 */
function cleanWorkflowForApi(workflowData: Workflow): Record<string, unknown> {
  // n8n API has strict schema - only specific fields allowed
  // Start with minimum required: name, nodes, connections
  const cleaned: Record<string, unknown> = {
    name: workflowData.name,
    nodes: workflowData.nodes,
    connections: workflowData.connections || {},
  };
  
  // Add optional but commonly accepted fields
  if (workflowData.active !== undefined) cleaned.active = workflowData.active;
  if (workflowData.settings !== undefined) cleaned.settings = workflowData.settings;
  if (workflowData.staticData !== undefined) cleaned.staticData = workflowData.staticData;
  
  // Tags - only include if it's an array of simple objects
  if (workflowData.tags && Array.isArray(workflowData.tags)) {
    cleaned.tags = workflowData.tags.map(tag => 
      typeof tag === 'object' && tag !== null && ('id' in tag || 'name' in tag)
        ? { id: 'id' in tag ? tag.id : undefined, name: 'name' in tag ? tag.name : undefined }
        : tag
    );
  }
  
  // Exclude all other fields to avoid "additional properties" error
  return cleaned;
}

/**
 * Import/update a workflow in n8n
 */
export async function importWorkflow(
  workflowData: Workflow,
  config?: N8nApiConfig
): Promise<Workflow> {
  const client = config ? createApiClient(config) : getDefaultClient();

  try {
    // Clean workflow data before sending to API
    const cleanedData = cleanWorkflowForApi(workflowData);
    
    // Check if workflow exists (by ID or name)
    let existingWorkflow: Workflow | null = null;
    if (cleanedData.id) {
      try {
        const getResponse = await client.get<Workflow>(`/workflows/${cleanedData.id}`);
        if (getResponse.status === 200) {
          existingWorkflow = getResponse.data;
        }
      } catch {
        // Workflow doesn't exist, will create new
      }
    }

    let response;
    if (existingWorkflow) {
      // Update existing workflow - use the existing workflow's actual ID (UUID)
      const workflowId = existingWorkflow.id;
      // For PUT, don't include id in body, but active is allowed
      const { id, ...updateData } = cleanedData;
      response = await client.put<Workflow>(`/workflows/${workflowId}`, updateData);
    } else {
      // Create new workflow - POST doesn't accept id, active, or tags fields (read-only)
      const { id, active, tags, ...createData } = cleanedData;
      
      // Debug: log what we're sending (remove in production)
      if (process.env.DEBUG) {
        logger.debug('Creating workflow with data:', JSON.stringify(createData, null, 2).substring(0, 500));
      }
      
      response = await client.post<Workflow>('/workflows', createData);
    }

    if (response.status === 401) {
      throw new Error(
        `Authentication required. Please set N8N_API_KEY or N8N_SESSION_COOKIE environment variable. ` +
        `To get an API key: Settings > API in n8n UI. ` +
        `To get session cookie: Log in to n8n UI and copy the session cookie from browser dev tools.`
      );
    }
    if (response.status !== 200 && response.status !== 201) {
      // Extract error message from response body if available
      const errorMessage = 
        (typeof response.data === 'object' && response.data !== null && 'message' in response.data
          ? (response.data as { message?: string }).message
          : undefined) ||
        (typeof response.data === 'string' ? response.data : undefined) ||
        response.statusText;
      
      // Include more details for debugging
      const errorDetails = typeof response.data === 'object' && response.data !== null
        ? JSON.stringify(response.data).substring(0, 500)
        : String(response.data).substring(0, 500);
      
      throw new Error(
        `Failed to import workflow: ${response.status} ${errorMessage}${errorDetails ? `\nDetails: ${errorDetails}` : ''}`
      );
    }

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        throw new Error(
          `Authentication required. Please set N8N_API_KEY or N8N_SESSION_COOKIE environment variable. ` +
          `To get an API key: Settings > API in n8n UI. ` +
          `To get session cookie: Log in to n8n UI and copy the session cookie from browser dev tools.`
        );
      }
      const message = error.response?.data?.message || error.message;
      throw new Error(`Failed to import workflow "${workflowData.name || workflowData.id}": ${message}`);
    }
    throw error;
  }
}

/**
 * Import workflow from file path
 */
export async function importWorkflowFromFile(
  filePath: string,
  config?: N8nApiConfig
): Promise<Workflow> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const workflowData = JSON.parse(content) as Workflow;
  return importWorkflow(workflowData, config);
}

/**
 * Find workflow by ID or name (returns the actual database UUID)
 * This is needed because n8n REST API requires database UUID, not custom IDs
 */
async function resolveWorkflowId(
  identifier: string,
  config?: N8nApiConfig
): Promise<string> {
  // If it looks like a UUID, return it directly
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(identifier)) {
    return identifier;
  }

  // Otherwise, search for workflow by name or custom ID
  try {
    const workflows = await exportWorkflows(config);
    
    // When workflows are exported via API, they have the actual database UUID as id
    // But the workflow JSON files might have custom IDs
    // We need to match by the workflow name or search all workflows
    
    // Try to find by exact name match first
    const byName = workflows.find(w => w.name === identifier);
    if (byName && byName.id) {
      return byName.id;
    }
    
    // Try partial name match
    const byPartialName = workflows.find(w => 
      w.name?.toLowerCase().includes(identifier.toLowerCase()) ||
      identifier.toLowerCase().includes(w.name?.toLowerCase() || '')
    );
    if (byPartialName && byPartialName.id) {
      return byPartialName.id;
    }
    
    // Try matching by the identifier as a substring in the name (for cases like "TestRunnerHelper001")
    // This handles cases where the identifier might be in the workflow name
    const byIdentifierInName = workflows.find(w => 
      w.name?.includes(identifier) || identifier.includes(w.name || '')
    );
    if (byIdentifierInName && byIdentifierInName.id) {
      return byIdentifierInName.id;
    }
    
    // If not found, return the identifier anyway - let the API call fail with proper error
    logger.warn(`Could not resolve workflow ID for "${identifier}". Available workflows: ${workflows.map(w => w.name || w.id).join(', ')}`);
    return identifier;
  } catch (error) {
    // If we can't list workflows, just return the identifier and let execute fail
    logger.debug(`Could not resolve workflow ID for "${identifier}": ${error instanceof Error ? error.message : String(error)}`);
    return identifier;
  }
}

/**
 * Execute a workflow by ID or name
 * NOTE: n8n REST API doesn't expose workflow execution directly.
 * This falls back to CLI for now until we find the correct API endpoint.
 * TODO: Find and implement proper REST API execution endpoint
 */
export async function executeWorkflow(
  workflowId: string,
  inputData?: unknown,
  config?: N8nApiConfig
): Promise<N8nExecutionResponse> {
  // NOTE: n8n REST API doesn't expose workflow execution endpoint
  // Fall back to CLI which uses internal APIs that work reliably
  const { runN8nCapture } = await import('./n8n');
  const { parseExecutionOutput } = await import('./test-helpers');
  const timeout = config?.timeout || 120000;

  try {
    // First ensure workflow is active (execute requires active workflow)
    // Use API to activate if needed
    try {
      const workflow = await getWorkflow(workflowId, config);
      if (!workflow.active) {
        logger.debug(`Activating workflow ${workflowId} before execution`);
        const client = config ? createApiClient(config) : getDefaultClient();
        await client.post(`/workflows/${workflowId}/activate`, {});
      }
    } catch (activateError) {
      // If we can't check/activate, proceed anyway - execute might work
      logger.debug(`Could not check/activate workflow ${workflowId}: ${activateError instanceof Error ? activateError.message : String(activateError)}`);
    }
    
    // Use CLI to execute workflow (it works and uses internal APIs)
    // Note: n8n CLI execute command can use --id (database ID) or --file (workflow file)
    // Try using the workflow ID directly - if it doesn't work, we'll try by name
    const args = ['execute', `--id=${workflowId}`];
    
    // Also try to get workflow name for fallback
    let workflowName: string | undefined;
    try {
      const workflow = await getWorkflow(workflowId, config);
      workflowName = workflow.name;
    } catch {
      // Ignore if we can't get workflow name
    }
    if (inputData) {
      args.push('--data', JSON.stringify(inputData));
    }
    
    const { code, stdout, stderr } = await runN8nCapture(args, timeout);

    // Combine stdout and stderr - n8n may output to either
    const combinedOutput = (stdout || '') + (stderr ? '\n' + stderr : '');
    
    // Log output for debugging if it's unexpected
    if (!combinedOutput.trim()) {
      logger.warn(`Workflow ${workflowId} execution produced no output. Exit code: ${code}`);
    }

    if (code !== 0) {
      const errorOutput = combinedOutput || 'No output';
      throw new Error(`Workflow execution failed with exit code ${code}: ${errorOutput.substring(0, 500)}`);
    }
    
    // Check if output is empty after successful execution
    if (!combinedOutput.trim()) {
      // Empty output - try executing by name if we have it and ID didn't work
      if (workflowName && workflowName !== workflowId) {
        logger.debug(`Retrying workflow execution by name: ${workflowName}`);
        const nameArgs = ['execute', `--file=${workflowName}`];
        if (inputData) {
          nameArgs.push('--data', JSON.stringify(inputData));
        }
        
        const nameResult = await runN8nCapture(nameArgs, timeout);
        const nameOutput = (nameResult.stdout || '') + (nameResult.stderr ? '\n' + nameResult.stderr : '');
        
        if (nameResult.code === 0 && nameOutput.trim()) {
          // Found output with name-based execution
          const executionJson = parseExecutionOutput(nameOutput);
          if (typeof executionJson === 'object' && executionJson !== null) {
            return executionJson as N8nExecutionResponse;
          }
        }
      }
      
      // Still no output - create minimal response
      logger.warn(`Workflow ${workflowId} executed successfully but produced no output`);
      throw new Error(`Workflow execution completed but produced no JSON output. This might indicate the workflow ID format is incorrect or the workflow didn't execute properly.`);
    }
    
    // Parse CLI output - parseExecutionOutput extracts JSON from output
    let executionJson: unknown;
    try {
      executionJson = parseExecutionOutput(combinedOutput);
    } catch (parseError) {
      // If parsing fails, log the actual output for debugging
      logger.debug(`Failed to parse execution output for workflow ${workflowId}. Raw output: ${combinedOutput.substring(0, 1000)}`);
      throw new Error(`No JSON found in execution output. Output preview: ${combinedOutput.substring(0, 300)}`);
    }
    
    // parseExecutionOutput returns the execution data directly
    // We need to wrap it in N8nExecutionResponse format if needed
    if (typeof executionJson === 'object' && executionJson !== null) {
      // If it already has the expected structure, return it
      if ('data' in executionJson || 'id' in executionJson) {
        return executionJson as N8nExecutionResponse;
      }
      // Otherwise wrap it
      return {
        id: 'execution-' + Date.now(),
        finished: true,
        mode: 'manual',
        startedAt: new Date().toISOString(),
        workflowId: workflowId,
        workflowData: {} as Workflow,
        data: executionJson as { resultData: { runData: Record<string, unknown> } },
      } as N8nExecutionResponse;
    }
    
    // If parsing failed, throw error with output for debugging
    throw new Error(`Failed to parse execution output. Output: ${combinedOutput.substring(0, 500)}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) {
      throw new Error(`Workflow execution timed out after ${timeout}ms`);
    }
    throw new Error(`Failed to execute workflow ${workflowId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get workflow by ID
 */
export async function getWorkflow(
  workflowId: string,
  config?: N8nApiConfig
): Promise<Workflow> {
  const client = config ? createApiClient(config) : getDefaultClient();

  try {
    const response = await client.get<Workflow>(`/workflows/${workflowId}`);
    if (response.status !== 200) {
      throw new Error(`Failed to get workflow: ${response.status} ${response.statusText}`);
    }
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.message || error.message;
      throw new Error(`Failed to get workflow ${workflowId}: ${message}`);
    }
    throw error;
  }
}

/**
 * Convert execution result to the format expected by existing code
 * (compatible with parseExecutionOutput output)
 * This returns the format that extractWorkflowResults expects
 */
export function formatExecutionResult(execution: N8nExecutionResponse): unknown {
  // Return in the same format as CLI output for backward compatibility
  // This matches the structure that parseExecutionOutput would create
  return {
    data: execution.data,
    finished: execution.finished,
    id: execution.id,
    mode: execution.mode,
    startedAt: execution.startedAt,
    stoppedAt: execution.stoppedAt,
    workflowId: execution.workflowId,
  };
}

// Re-export type alias for backward compatibility
export type ExecutionResult = N8nExecutionResponse;

