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
    const response = await client.get<unknown>('/workflows');
    if (response.status !== 200) {
      throw new Error(`Failed to export workflows: ${response.status} ${response.statusText}`);
    }
    
    // Handle both direct array and paginated response formats
    let workflows: Workflow[];
    if (Array.isArray(response.data)) {
      workflows = response.data as Workflow[];
    } else if (response.data && typeof response.data === 'object' && response.data !== null && 'data' in response.data) {
      const dataObj = response.data as { data: unknown };
      if (Array.isArray(dataObj.data)) {
        workflows = dataObj.data as Workflow[];
      } else {
        workflows = [];
      }
    } else {
      // Single workflow object
      workflows = [response.data as Workflow];
    }
    
    return workflows;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.message || error.message;
      throw new Error(`Failed to export workflows: ${message}`);
    }
    throw error;
  }
}

/**
 * Check if a string is a valid UUID (for older n8n workflows)
 */
function isUUID(id: string): boolean {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(id);
}

/**
 * Check if a string is a valid n8n database ID (UUID or NanoID)
 * n8n uses UUIDs for older workflows and NanoIDs for newer ones
 */
function isValidDatabaseId(id: string): boolean {
  // UUID format: 550e8400-e29b-41d4-a716-446655440000
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  // NanoID format: IZa7S90Z9W1qxysr (typically 10-21 characters, alphanumeric)
  // Note: Custom IDs like "TestRunnerHelper001" are NOT valid database IDs
  const nanoIdPattern = /^[A-Za-z0-9_-]{10,21}$/;
  
  return uuidPattern.test(id) || nanoIdPattern.test(id);
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
  if (workflowData.settings !== undefined) cleaned.settings = workflowData.settings;
  if (workflowData.staticData !== undefined) cleaned.staticData = workflowData.staticData;
  
  // CRITICAL: Read-only fields that must NEVER be included in POST/PUT request bodies:
  // - 'id': Read-only, generated by n8n. Only used in URL paths (GET /workflows/{id}, PUT /workflows/{id})
  // - 'active': Read-only in POST. Can be set via PUT /workflows/{id}/activate endpoint
  // - 'tags': Read-only in POST. Must be managed via separate tag endpoints
  // - 'createdAt', 'updatedAt', 'isArchived': All read-only
  //
  // Workflow JSON files may contain custom IDs (like "TestRunnerHelper001") or database IDs,
  // but these should NEVER be sent in POST/PUT request bodies
  // We'll search by name to find the database ID if we need to update an existing workflow
  
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
    
    // Check if workflow exists by searching by name
    // We can't use the 'id' from workflowData because:
    // 1. It might be a custom ID (like "TestRunnerHelper001") which is not a database ID
    // 2. Even if it's a database ID, we shouldn't use it in request bodies
    // 3. We need to find the actual database ID (UUID or NanoID) by searching by name
    let existingWorkflow: Workflow | null = null;
    if (workflowData.name) {
      try {
        const workflows = await exportWorkflows(config);
        const byName = workflows.find(w => w.name === workflowData.name);
        if (byName && byName.id && isValidDatabaseId(byName.id)) {
          existingWorkflow = byName;
        }
      } catch {
        // If search fails, proceed to create new workflow
        // This is fine - workflow might not exist yet
      }
    }

    let response;
    if (existingWorkflow && isValidDatabaseId(existingWorkflow.id)) {
      // Update existing workflow - use the database ID (UUID or NanoID) in URL path
      const workflowId = existingWorkflow.id;
      // For PUT, the id goes in the URL path, NOT in the request body
      // cleanedData already doesn't include id (we removed it in cleanWorkflowForApi)
      response = await client.put<Workflow>(`/workflows/${workflowId}`, cleanedData);
    } else {
      // Create new workflow - POST never accepts id in request body (it's read-only)
      // cleanedData already doesn't include id (we removed it in cleanWorkflowForApi)
      
      // Debug: log what we're sending (remove in production)
      if (process.env.DEBUG) {
        const dataPreview = JSON.stringify(cleanedData, null, 2).substring(0, 500);
        logger.debug(`Creating workflow with data: ${dataPreview}`);
      }
      
      response = await client.post<Workflow>('/workflows', cleanedData);
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
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    // Validate JSON before parsing
    if (!content.trim()) {
      throw new Error(`Workflow file is empty: ${filePath}`);
    }
    const workflowData = JSON.parse(content) as Workflow;
    return importWorkflow(workflowData, config);
  } catch (error) {
    if (error instanceof SyntaxError) {
      // JSON parsing error - provide more context
      const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
      throw new Error(
        `Invalid JSON in workflow file "${filePath}" (${fileSize} bytes): ${error.message}`
      );
    }
    throw error;
  }
}

/**
 * Find workflow by ID or name (returns the actual database UUID)
 * This is needed because n8n REST API requires database UUID, not custom IDs
 */
async function resolveWorkflowId(
  identifier: string,
  config?: N8nApiConfig
): Promise<string> {
  // If it's already a valid database ID (UUID or NanoID), return it directly
  if (isValidDatabaseId(identifier)) {
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
  // THINKING OUTSIDE THE BOX: Use the EXACT same approach as the working CLI test code!
  // The original test.ts uses runN8nCapture directly and it works - let's do the same
  const { runN8nCapture } = await import('./n8n');
  const { parseExecutionOutput } = await import('./test-helpers');
  const timeout = config?.timeout || 120000;

  try {
    // Use the EXACT same approach as working test.ts - direct runN8nCapture call
    const args = ['execute', `--id=${workflowId}`];
    if (inputData) {
      args.push('--data', JSON.stringify(inputData));
    }
    
    // This is what test.ts does and it works!
    const { code, stdout, stderr } = await runN8nCapture(args, timeout);
    
    // Filter version warnings - inline function since it's not exported
    const filterVersionWarnings = (output: string): string => {
      const lines = output.split('\n');
      return lines
        .filter(line => !line.includes('deprecated') && !line.includes('The CJS build'))
        .join('\n');
    };
    
    const filteredStdout = filterVersionWarnings(stdout);
    const filteredStderr = filterVersionWarnings(stderr);
    const combinedOutput = filteredStdout + (filteredStderr ? '\n' + filteredStderr : '');
    
    logger.debug(`Captured output: code=${code}, stdout=${stdout.length}, stderr=${stderr.length}, filtered=${combinedOutput.length}`);
    if (combinedOutput.trim()) {
      logger.debug(`Output preview: ${combinedOutput.substring(0, 200)}`);
    }
    
    if (code === 124) {
      throw new Error(`Workflow execution timed out after ${timeout}ms`);
    }
    
    // Even if exit code is 0, check if we have output
    // Sometimes successful executions produce output, sometimes they don't
    if (!combinedOutput.trim()) {
      // OUTSIDE THE BOX: Maybe successful executions don't output JSON by default?
      // Try querying the executions API to get the result!
      logger.debug(`No CLI output, trying to get execution from API...`);
      const client = config ? createApiClient(config) : getDefaultClient();
      
      try {
        // Get the workflow to find its database ID
        const workflow = await getWorkflow(workflowId, config).catch(() => null);
        if (workflow) {
          // Get most recent execution
          const execResponse = await client.get('/executions', {
            params: { workflowId: workflow.id, limit: 1 },
          });
          
          if (execResponse.status === 200) {
            const executions = Array.isArray(execResponse.data) ? execResponse.data :
                              execResponse.data?.data ? execResponse.data.data :
                              execResponse.data?.executions || [];
            
            if (executions.length > 0) {
              const exec = executions[0] as { id: string };
              const detailResponse = await client.get(`/executions/${exec.id}`);
              if (detailResponse.status === 200) {
                logger.debug(`Found execution via API: ${exec.id}`);
                return detailResponse.data as N8nExecutionResponse;
              }
            }
          }
        }
      } catch (apiError) {
        logger.debug(`API fallback failed: ${apiError instanceof Error ? apiError.message : String(apiError)}`);
      }
      
      // If API didn't work either, throw error
      throw new Error(`Workflow execution produced no output and API query failed. Exit code: ${code}`);
    }
    
    if (code !== 0) {
      throw new Error(`Workflow execution failed with exit code ${code}: ${combinedOutput.substring(0, 500)}`);
    }
    
    // Parse exactly like test.ts does
    const executionJson = parseExecutionOutput(combinedOutput);
    
    // Convert to N8nExecutionResponse format
    if (typeof executionJson === 'object' && executionJson !== null) {
      return executionJson as N8nExecutionResponse;
    }
    
    throw new Error(`Could not parse execution output`);
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
 * Delete workflow by ID
 */
export async function deleteWorkflow(
  workflowId: string,
  config?: N8nApiConfig
): Promise<void> {
  const client = config ? createApiClient(config) : getDefaultClient();

  try {
    logger.debug(`Attempting to delete workflow ${workflowId}`);
    const response = await client.delete(`/workflows/${workflowId}`);
    
    // Log full response for debugging
    logger.debug(`Delete response for workflow ${workflowId}`, undefined, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data,
    });
    
    // n8n API returns 200 or 204 on successful deletion
    // 404 means workflow doesn't exist (already deleted) - treat as success
    if (response.status === 404) {
      logger.debug(`Workflow ${workflowId} not found (may already be deleted) - treating as success`);
      return;
    }
    
    if (response.status !== 200 && response.status !== 204) {
      const errorMessage = response.data?.message || response.statusText || 'Unknown error';
      const errorDetails = response.data ? JSON.stringify(response.data).substring(0, 200) : '';
      logger.error(`Delete failed for workflow ${workflowId}`, undefined, {
        status: response.status,
        statusText: response.statusText,
        errorMessage,
        errorDetails,
      });
      throw new Error(`Failed to delete workflow: ${response.status} ${errorMessage}${errorDetails ? ` - ${errorDetails}` : ''}`);
    }
    
    // Verify the workflow was actually deleted by trying to fetch it
    // Wait a small amount to allow the deletion to propagate
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
      const verifyResponse = await client.get(`/workflows/${workflowId}`);
      if (verifyResponse.status === 200) {
        logger.warn(`Workflow ${workflowId} still exists after delete request (status: ${verifyResponse.status})`);
        // Don't throw - let the verification step at the end catch this
      }
    } catch (verifyError) {
      if (axios.isAxiosError(verifyError) && verifyError.response?.status === 404) {
        // 404 means deletion succeeded - this is expected
        logger.debug(`Verified: workflow ${workflowId} was successfully deleted (404 on verify)`);
      } else {
        logger.debug(`Could not verify deletion of ${workflowId}: ${verifyError instanceof Error ? verifyError.message : String(verifyError)}`);
      }
    }
    
    logger.debug(`Delete request successful for workflow ${workflowId} (status: ${response.status})`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        throw new Error(
          `Authentication required. Please set N8N_API_KEY or N8N_SESSION_COOKIE environment variable.`
        );
      }
      if (error.response?.status === 404) {
        // Workflow doesn't exist - might already be deleted, treat as success
        logger.debug(`Workflow ${workflowId} not found (may already be deleted) - treating as success`);
        return;
      }
      const message = error.response?.data?.message || error.message;
      const errorDetails = error.response?.data ? JSON.stringify(error.response.data).substring(0, 200) : '';
      logger.error(`Delete error for workflow ${workflowId}`, error, {
        status: error.response?.status,
        message,
        errorDetails,
      });
      throw new Error(`Failed to delete workflow ${workflowId}: ${message}${errorDetails ? ` - ${errorDetails}` : ''}`);
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

