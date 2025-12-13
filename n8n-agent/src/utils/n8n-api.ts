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
import { type McpSseCredentialMapping } from './workflow-reference-converter';

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
  pinData?: unknown;
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

// NOTE: Environment variable fallbacks have been removed.
// All n8n connections now require explicit config from pod-connection.ts.
// This ensures we always connect to the running pod, not a stale local instance.

/**
 * Create axios instance with n8n API configuration.
 *
 * IMPORTANT: Config is required. Use getRunningPodConnection() from pod-connection.ts
 * to get config for a running pod.
 *
 * @throws Error if config is not provided or baseURL is missing
 */
export function createApiClient(config: N8nApiConfig): AxiosInstance {
  if (!config) {
    throw new Error(
      'n8n API config is required.\n' +
      'Use getRunningPodConnection() from pod-connection.ts to get config for a running pod.'
    );
  }

  const baseURL = config.baseURL;

  if (!baseURL) {
    throw new Error(
      'baseURL is required in n8n API config.\n' +
      'Use getRunningPodConnection() from pod-connection.ts to get config for a running pod.'
    );
  }

  const apiKey = config.apiKey;
  const sessionCookie = config.sessionCookie;
  const timeout = config.timeout || 120000; // 2 minutes default

  // CRITICAL: Use /rest endpoints when only session cookie is available
  // /api/v1 requires API keys and rejects session cookies with "'X-N8N-API-KEY' header required"
  // /rest accepts session cookies for authentication
  const apiPath = (!apiKey && sessionCookie) ? '/rest' : '/api/v1';

  logger.info(`Creating API client for ${baseURL}${apiPath}`);
  logger.info(`Auth method: apiKey=${apiKey ? 'present' : 'missing'}, sessionCookie=${sessionCookie ? 'present' : 'missing'}`);
  if (sessionCookie) {
    logger.info(`Session cookie preview: ${sessionCookie.substring(0, 50)}...`);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Prefer API key over session cookie
  if (apiKey) {
    headers['X-N8N-API-KEY'] = apiKey;
    logger.info(`Using API key authentication with ${apiPath} endpoints`);
  } else if (sessionCookie) {
    headers['Cookie'] = sessionCookie;
    logger.info(`Using session cookie authentication with ${apiPath} endpoints (Cookie header set)`);
  } else {
    logger.warn(`No authentication method available - API calls will likely fail`);
  }

  const client = axios.create({
    baseURL: `${baseURL}${apiPath}`,
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

/**
 * Quick connection check to verify n8n is running
 * Uses a shorter timeout (5 seconds) for faster failure detection
 *
 * @throws Error if config is not provided
 */
export async function checkN8nConnection(config: N8nApiConfig): Promise<boolean> {
  if (!config || !config.baseURL) {
    throw new Error(
      'n8n API config with baseURL is required.\n' +
      'Use getRunningPodConnection() from pod-connection.ts to get config for a running pod.'
    );
  }

  const quickClient = createApiClient({
    ...config,
    timeout: 5000 // 5 second timeout for quick check
  });
  
  try {
    // Try a lightweight endpoint with minimal data
    await quickClient.get('/workflows', { 
      params: { limit: 1 },
      timeout: 5000 
    });
    return true;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Connection refused or timeout means n8n is not running
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        return false;
      }
      // Other errors (like 401, 403) mean n8n is running but auth failed
      // We consider this as "connected" since the server responded
      return true;
    }
    // Unknown error - assume not connected to be safe
    return false;
  }
}

// NOTE: getDefaultClient() has been removed.
// All API calls now require explicit config from pod-connection.ts.

/**
 * Export all workflows from n8n (handles pagination)
 *
 * @throws Error if config is not provided
 */
export async function exportWorkflows(config: N8nApiConfig): Promise<Workflow[]> {
  if (!config || !config.baseURL) {
    throw new Error(
      'n8n API config with baseURL is required.\n' +
      'Use getRunningPodConnection() from pod-connection.ts to get config for a running pod.'
    );
  }

  const apiKey = config.apiKey;
  const sessionCookie = config.sessionCookie;
  const useRestEndpoint = !apiKey && !!sessionCookie;
  const baseURL = config.baseURL;

  // CRITICAL: /rest/workflows returns summary data without nodes/connections
  // /api/v1/workflows requires API keys (both GET and POST require API keys)
  // Solution: When using /rest, get workflow summaries first, then fetch each workflow individually
  if (useRestEndpoint) {
    logger.info(`Using /rest endpoint - will fetch workflow summaries first, then full data for each`);
    
    try {
      // Step 1: Get workflow summaries from /rest/workflows
      const summaryClient = axios.create({
        baseURL: `${baseURL}/rest`,
        headers: {
          'Content-Type': 'application/json',
          'Cookie': sessionCookie!,
        },
        timeout: 120000,
        validateStatus: (status) => status < 500,
        withCredentials: true,
      });
      
      const summaryResponse = await summaryClient.get<{ count: number; data: Array<{ id: string; name: string }> }>('/workflows');
      
      if (summaryResponse.status !== 200) {
        throw new Error(`Failed to get workflow summaries: ${summaryResponse.status} ${summaryResponse.statusText}`);
      }
      
      const summaries = summaryResponse.data.data || [];
      logger.info(`Found ${summaries.length} workflow(s) in summary, fetching full data for each...`);
      
      // Step 2: Fetch each workflow individually to get full data with nodes/connections
      const allWorkflows: Workflow[] = [];
      for (const summary of summaries) {
        try {
          const fullResponse = await summaryClient.get<{ data: Workflow }>(`/workflows/${summary.id}`);
          if (fullResponse.status === 200 && fullResponse.data && 'data' in fullResponse.data) {
            // /rest/workflows/{id} returns { data: {...} }
            const workflow = (fullResponse.data as any).data;
            if (workflow && workflow.id && Array.isArray(workflow.nodes)) {
              allWorkflows.push(workflow);
              logger.debug(`Fetched full workflow: ${workflow.name} (${workflow.nodes.length} nodes)`);
            } else {
              logger.warn(`Workflow ${summary.id} missing nodes or invalid structure`);
            }
          }
        } catch (error) {
          logger.warn(`Failed to fetch full data for workflow ${summary.id} (${summary.name}): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      logger.info(`Total workflows fetched with full data: ${allWorkflows.length}`);
      return allWorkflows;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = error.response?.data?.message || error.message;
        throw new Error(`Failed to export workflows: ${message}`);
      }
      throw error;
    }
  }

  // Use /api/v1 for API key authentication
  const client = createApiClient(config);

  try {

    const allWorkflows: Workflow[] = [];
    let cursor: string | null = null;
    const limit = 250; // Maximum allowed by n8n API

    do {
      const params: Record<string, string | number> = { limit };
      if (cursor) {
        params.cursor = cursor;
      }

      logger.info(`GET /workflows from ${baseURL}/api/v1/workflows`);
      const response = await client.get<unknown>('/workflows', { params });
      logger.info(`GET /workflows response: status=${response.status}, data type=${typeof response.data}, isArray=${Array.isArray(response.data)}`);
      
      if (response.status !== 200) {
        logger.error(`Failed to export workflows: status=${response.status}, statusText=${response.statusText}`);
        logger.error(`Response data: ${JSON.stringify(response.data).substring(0, 500)}`);
        throw new Error(`Failed to export workflows: ${response.status} ${response.statusText}`);
      }
      
      // Handle both direct array and paginated response formats
      // /rest endpoints may return { data: [...] } format
      // /api/v1 endpoints may return { data: [...], nextCursor: "..." } or direct array
      let workflows: Workflow[] = [];
      let nextCursor: string | null = null;

      // Log raw response structure for debugging
      logger.info(`Response.data type: ${typeof response.data}, isArray: ${Array.isArray(response.data)}`);
      if (response.data && typeof response.data === 'object' && response.data !== null) {
        logger.info(`Response.data keys: ${Object.keys(response.data).join(', ')}`);
        if ('data' in response.data) {
          logger.info(`Response.data.data type: ${typeof (response.data as any).data}, isArray: ${Array.isArray((response.data as any).data)}`);
          if (Array.isArray((response.data as any).data)) {
            logger.info(`Response.data.data length: ${(response.data as any).data.length}`);
          }
        }
      }

      if (Array.isArray(response.data)) {
        // Direct array format (legacy or non-paginated)
        workflows = response.data as Workflow[];
        logger.info(`Got direct array format: ${workflows.length} workflows`);
      } else if (response.data && typeof response.data === 'object' && response.data !== null) {
        const dataObj = response.data as { data?: unknown; nextCursor?: string | null };
        
        if ('data' in dataObj && Array.isArray(dataObj.data)) {
          // Paginated format: { data: [...], nextCursor: "..." } or /rest format: { data: [...] }
          workflows = dataObj.data as Workflow[];
          nextCursor = dataObj.nextCursor || null;
          logger.info(`Got paginated/rest format: ${workflows.length} workflows${nextCursor ? `, has cursor` : ''}`);
        } else if ('data' in dataObj && !Array.isArray(dataObj.data)) {
          // Single workflow in data field (unlikely but handle it)
          workflows = [dataObj.data as Workflow];
          logger.info(`Got single workflow in data field`);
        } else {
          // Might be a single workflow object
          workflows = [response.data as Workflow];
          logger.info(`Got single workflow object`);
        }
      } else {
        // Single workflow object
        workflows = [response.data as Workflow];
        logger.info(`Got single workflow (non-object)`);
      }

      // Log sample workflow structure for debugging
      if (workflows.length > 0) {
        const sample = workflows[0];
        logger.info(`Sample workflow: name="${sample.name}", id="${sample.id}", nodes=${Array.isArray(sample.nodes) ? sample.nodes.length : 'not array'}`);
        if (!Array.isArray(sample.nodes) || sample.nodes.length === 0) {
          logger.warn(`⚠️  Workflow "${sample.name}" has no nodes!`);
          logger.warn(`   Workflow keys: ${Object.keys(sample).join(', ')}`);
          logger.warn(`   nodes type: ${typeof sample.nodes}, value: ${JSON.stringify(sample.nodes).substring(0, 200)}`);
          // Check if nodes are in a different field
          const sampleAny = sample as any;
          if (sampleAny.data && Array.isArray(sampleAny.data.nodes)) {
            logger.info(`   Found nodes in data.nodes field!`);
            sample.nodes = sampleAny.data.nodes;
          } else if (sampleAny.workflow && Array.isArray(sampleAny.workflow.nodes)) {
            logger.info(`   Found nodes in workflow.nodes field!`);
            sample.nodes = sampleAny.workflow.nodes;
          }
        }
      }

      allWorkflows.push(...workflows);
      cursor = nextCursor;

      logger.info(`Fetched ${workflows.length} workflows (total so far: ${allWorkflows.length})${cursor ? `, next cursor: ${cursor.substring(0, 20)}...` : ''}`);
    } while (cursor);

    logger.info(`Total workflows fetched: ${allWorkflows.length}`);
    return allWorkflows;
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
export function isValidDatabaseId(id: string): boolean {
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
function cleanWorkflowForApi(workflowData: Workflow, useRestEndpoint: boolean = false): Record<string, unknown> {
  // n8n API has strict schema - only specific fields allowed
  // Start with minimum required: name, nodes, connections, settings
  const cleaned: Record<string, unknown> = {
    name: workflowData.name,
    nodes: workflowData.nodes,
    connections: workflowData.connections || {},
    settings: workflowData.settings || {}, // settings is required in newer n8n versions
  };
  
  // /rest endpoints require 'active' field (NOT NULL constraint in database)
  // /api/v1 endpoints treat 'active' as read-only
  if (useRestEndpoint) {
    cleaned.active = workflowData.active !== undefined ? workflowData.active : false;
  }
  
  // Add optional but commonly accepted fields
  // Note: Some n8n versions may not accept all of these in POST requests
  // Test with minimal fields first if you encounter "additional properties" errors
  if (workflowData.staticData !== undefined && workflowData.staticData !== null) {
    cleaned.staticData = workflowData.staticData;
  }
  // pinData is often not accepted in POST - only in PUT for existing workflows
  // if (workflowData.pinData !== undefined) cleaned.pinData = workflowData.pinData;
  
  // CRITICAL: Read-only fields that must NEVER be included in POST/PUT request bodies:
  // - 'id': Read-only, generated by n8n. Only used in URL paths (GET /workflows/{id}, PUT /workflows/{id})
  // - 'active': Read-only in /api/v1 POST, but REQUIRED in /rest POST (NOT NULL constraint)
  // - 'tags': Read-only in POST. Must be managed via separate tag endpoints
  // - 'createdAt', 'updatedAt', 'isArchived': All read-only
  // - 'description': May not be accepted in some n8n versions (test without it first)
  //
  // Workflow JSON files may contain custom IDs (like "TestRunnerHelper001") or database IDs,
  // but these should NEVER be sent in POST/PUT request bodies
  // We'll search by name to find the database ID if we need to update an existing workflow
  
  // Exclude all other fields to avoid "additional properties" error
  return cleaned;
}

/**
 * Import/update a workflow in n8n
 *
 * @param workflowData - The workflow data to import
 * @param config - API configuration (baseURL, apiKey, sessionCookie) - REQUIRED
 * @param forceCreate - If true, always create new workflow instead of updating existing
 * @param existingWorkflowId - Optional known database ID to update
 * @param allBackupWorkflows - All workflows from backup for reference resolution
 * @param mcpCredentialMappings - Optional MCP credential mappings for container mode
 *                               (rewrites STDIO credentials to SSE transport)
 * @throws Error if config is not provided
 */
export async function importWorkflow(
  workflowData: Workflow,
  config: N8nApiConfig,
  forceCreate: boolean = false,
  existingWorkflowId?: string,
  allBackupWorkflows?: Workflow[],
  mcpCredentialMappings?: McpSseCredentialMapping[]
): Promise<Workflow> {
  if (!config || !config.baseURL) {
    throw new Error(
      'n8n API config with baseURL is required.\n' +
      'Use getRunningPodConnection() from pod-connection.ts to get config for a running pod.'
    );
  }

  const client = createApiClient(config);

  try {
    // Convert Execute Workflow node references to use current n8n IDs
    // This ensures references match the actual workflow IDs in the database
    // Pass all backup workflows so references can be resolved even if target workflows
    // haven't been imported yet (they'll be matched by name from backup files)
    const { convertWorkflowReferencesToNames, rewriteMcpCredentialsToSse } = await import('./workflow-reference-converter');
    let workflowWithNameReferences = await convertWorkflowReferencesToNames(workflowData, allBackupWorkflows, config);

    // Rewrite MCP credentials from STDIO to SSE if mappings are provided
    // This allows workflows designed for local STDIO MCP to work in containers
    if (mcpCredentialMappings && mcpCredentialMappings.length > 0 && workflowWithNameReferences.nodes) {
      logger.info(`🔄 Applying MCP credential rewriting for ${mcpCredentialMappings.length} mapping(s)`);
      workflowWithNameReferences = {
        ...workflowWithNameReferences,
        nodes: rewriteMcpCredentialsToSse(workflowWithNameReferences.nodes as any[], mcpCredentialMappings),
      };
    }
    
    // Determine if we're using /rest endpoints (session cookie only) or /api/v1 (API key)
    const apiKey = config.apiKey;
    const sessionCookie = config.sessionCookie;
    const useRestEndpoint = !apiKey && !!sessionCookie;
    
    // Clean workflow data before sending to API
    const cleanedData = cleanWorkflowForApi(workflowWithNameReferences, useRestEndpoint);
    
    // Check if workflow exists by searching by name (unless forceCreate is true)
    // We can't use the 'id' from workflowData because:
    // 1. It might be a custom ID (like "TestRunnerHelper001") which is not a database ID
    // 2. Even if it's a database ID, we shouldn't use it in request bodies
    // 3. We need to find the actual database ID (UUID or NanoID) by searching by name
    let existingWorkflow: Workflow | null = null;
    
    // If an existing workflow ID was provided, verify it exists before using it
    // This prevents 404 errors when the workflow was deleted or doesn't exist
    if (existingWorkflowId && isValidDatabaseId(existingWorkflowId)) {
      try {
        // Verify the workflow exists by fetching it
        const workflow = await getWorkflow(existingWorkflowId, config);
        if (workflow && workflow.id) {
          existingWorkflow = workflow;
          logger.debug(`Verified existing workflow ID: ${existingWorkflowId}`);
        }
      } catch (error) {
        // If fetch fails (e.g., workflow was deleted), log and fall through to name-based lookup
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          logger.warn(`Provided workflow ID ${existingWorkflowId} not found (may have been deleted), will try name-based lookup or create new`);
          // Clear existingWorkflowId so we don't try to use it
          existingWorkflowId = undefined;
        } else {
          logger.debug(`Failed to verify workflow ID ${existingWorkflowId}: ${error instanceof Error ? error.message : String(error)}`);
        }
        // Don't use the invalid ID - let name-based lookup or creation handle it
        // existingWorkflow remains null, so we'll fall through to name-based lookup
      }
    }
    
    // If no existing workflow found yet, search by name
    // Also verify the found workflow actually exists (not deleted)
    if (!existingWorkflow && !forceCreate && workflowData.name) {
      try {
        const workflows = await exportWorkflows(config);
        const byName = workflows.find(w => w.name === workflowData.name);
        if (byName && byName.id && isValidDatabaseId(byName.id)) {
          // Verify the workflow actually exists before using it
          try {
            const verified = await getWorkflow(byName.id, config);
            if (verified && verified.id) {
              existingWorkflow = verified;
            }
          } catch (verifyError) {
            // Workflow was deleted - skip it and create new
            if (axios.isAxiosError(verifyError) && verifyError.response?.status === 404) {
              logger.warn(`Workflow "${workflowData.name}" (ID: ${byName.id}) found in export but doesn't exist (deleted), will create new`);
            }
          }
        }
      } catch {
        // If search fails, proceed to create new workflow
        // This is fine - workflow might not exist yet
      }
    }

    let response;
    if (!forceCreate && existingWorkflow && isValidDatabaseId(existingWorkflow.id)) {
      // Update existing workflow - use the database ID (UUID or NanoID) in URL path
      const workflowId = existingWorkflow.id;
      // For PUT, the id goes in the URL path, NOT in the request body
      // cleanedData already doesn't include id (we removed it in cleanWorkflowForApi)
      try {
        response = await client.put<Workflow>(`/workflows/${workflowId}`, cleanedData);
      } catch (putError) {
        // If PUT fails with 404, the workflow might have been deleted
        // Fall back to creating a new workflow
        if (axios.isAxiosError(putError) && putError.response?.status === 404) {
          logger.warn(`Workflow ${workflowId} not found (may have been deleted), creating new workflow instead`);
          try {
            response = await client.post<Workflow>('/workflows', cleanedData);
          } catch (postError) {
            // If POST also fails, throw the original PUT error
            throw putError;
          }
        } else {
          throw putError;
        }
      }
    } else {
      // Create new workflow - POST never accepts id in request body (it's read-only)
      // cleanedData already doesn't include id (we removed it in cleanWorkflowForApi)
      
      // Debug: log what we're sending
      logger.debug(`Creating workflow "${workflowData.name}" with fields: ${Object.keys(cleanedData).join(', ')}`);
      if (process.env.DEBUG) {
        const dataPreview = JSON.stringify(cleanedData, null, 2).substring(0, 1000);
        logger.debug(`Creating workflow with data: ${dataPreview}`);
      }
      
      // Try POST to /workflows endpoint
      try {
        logger.debug(`POST /workflows to ${config.baseURL}/api/v1/workflows`);
      response = await client.post<Workflow>('/workflows', cleanedData);
        logger.debug(`POST successful: status=${response.status}, workflow ID: ${response.data?.id || 'none'}`);
      } catch (postError) {
        // If POST fails, log more details
        if (axios.isAxiosError(postError)) {
          logger.debug(`POST /workflows failed: status=${postError.response?.status}, url=${config.baseURL}/api/v1/workflows`);
          logger.debug(`Request data keys: ${Object.keys(cleanedData).join(', ')}`);
          logger.debug(`Response: ${JSON.stringify(postError.response?.data).substring(0, 500)}`);
          logger.debug(`Response headers: ${JSON.stringify(postError.response?.headers)}`);
        }
        throw postError;
      }
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
      
      // Log the full response for debugging
      logger.debug(`Import workflow failed: status=${response.status}, url=${config.baseURL}/api/v1/workflows`);
      logger.debug(`Response headers:`, response.headers);
      logger.debug(`Response data:`, response.data);
      
      throw new Error(
        `Failed to import workflow: ${response.status} ${errorMessage}${errorDetails ? `\nDetails: ${errorDetails}` : ''}`
      );
    }

    // Log successful import for debugging
    // /rest endpoints wrap response in { data: {...} }, /api/v1 returns directly
    const importedWorkflow = useRestEndpoint && response.data && 'data' in response.data 
      ? (response.data as any).data 
      : response.data;
    
    logger.info(`Successfully imported workflow: ${importedWorkflow?.name || 'unknown'} (ID: ${importedWorkflow?.id || 'unknown'})`);
    if (!importedWorkflow?.id) {
      logger.warn(`Response missing ID field. Full response: ${JSON.stringify(response.data).substring(0, 500)}`);
    }

    return importedWorkflow;
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
      const errorData = error.response?.data;
      logger.error(`API Error Response:`, errorData);
      throw new Error(`Failed to import workflow "${workflowData.name || workflowData.id}": ${message}`);
    }
    throw error;
  }
}

/**
 * Import workflow from file path
 *
 * @param filePath - Path to the workflow JSON file
 * @param config - API configuration (baseURL, apiKey, sessionCookie)
 * @param mcpCredentialMappings - Optional MCP credential mappings for container mode
 *                               (rewrites STDIO credentials to SSE transport)
 */
export async function importWorkflowFromFile(
  filePath: string,
  config: N8nApiConfig,
  mcpCredentialMappings?: McpSseCredentialMapping[]
): Promise<Workflow> {
  if (!config || !config.baseURL) {
    throw new Error(
      'n8n API config with baseURL is required.\n' +
      'Use getRunningPodConnection() from pod-connection.ts to get config for a running pod.'
    );
  }

  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    // Validate JSON before parsing
    if (!content.trim()) {
      throw new Error(`Workflow file is empty: ${filePath}`);
    }
    const workflowData = JSON.parse(content) as Workflow;
    // Pass MCP credential mappings for container mode credential rewriting
    return importWorkflow(workflowData, config, false, undefined, undefined, mcpCredentialMappings);
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
  config: N8nApiConfig
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
  inputData: unknown | undefined,
  config: N8nApiConfig
): Promise<N8nExecutionResponse> {
  // THINKING OUTSIDE THE BOX: Use the EXACT same approach as the working CLI test code!
  // The original test.ts uses runN8nCapture directly and it works - let's do the same
  const { runN8nCapture } = await import('./n8n');
  const { parseExecutionOutput } = await import('./test-helpers');
  const timeout = config?.timeout || 120000;

  try {
    // Use the EXACT same approach as working test.ts - direct runN8nCapture call
    // Add --rawOutput flag to ensure we get JSON output
    // NOTE: For workflows with manual triggers, we MUST use webhook execution!
    const args = ['execute', `--id=${workflowId}`, '--rawOutput'];
    
    // For workflows with executeWorkflowTrigger, pass data using --input flag (not --data)
    if (inputData) {
      args.push(`--input=${JSON.stringify(inputData)}`);
    }
    
    logger.info(`Executing workflow with args: ${args.join(' ')}`);
    logger.info(`Workflow ID: ${workflowId}, Input data: ${inputData ? JSON.stringify(inputData).substring(0, 200) : 'none'}`);
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
    
    logger.info(`Captured output: code=${code}, stdout=${stdout.length}, stderr=${stderr.length}, filtered=${combinedOutput.length}`);
    logger.info(`Raw stdout (first 1000 chars): ${stdout.substring(0, 1000)}`);
    logger.info(`Raw stderr (first 1000 chars): ${stderr.substring(0, 1000)}`);
    if (combinedOutput.trim()) {
      logger.info(`Output preview: ${combinedOutput.substring(0, 500)}`);
    } else {
      logger.warn(`⚠️  NO OUTPUT from workflow execution! Exit code: ${code}`);
      logger.info(`Full stdout: ${stdout}`);
      logger.info(`Full stderr: ${stderr}`);
    }
    
    if (code === 124) {
      throw new Error(`Workflow execution timed out after ${timeout}ms`);
    }
    
    // Even if exit code is 0, check if we have output
    // Sometimes successful executions produce output, sometimes they don't
    if (!combinedOutput.trim()) {
      // OUTSIDE THE BOX: Maybe successful executions don't output JSON by default?
      // Try querying the executions API to get the result!
      logger.info(`No CLI output, trying to get execution from API...`);
      logger.info(`Workflow ID provided: ${workflowId}`);
      const client = createApiClient(config);
      
      try {
        // Get the workflow to find its database ID
        // workflowId might be a custom ID, so we need to resolve it
        let resolvedWorkflowId = workflowId;
        try {
          const workflow = await getWorkflow(workflowId, config);
          resolvedWorkflowId = workflow.id;
          logger.debug(`Resolved workflow ID: ${workflowId} -> ${resolvedWorkflowId}`);
        } catch (getWorkflowError) {
          logger.debug(`getWorkflow failed, trying name lookup: ${getWorkflowError instanceof Error ? getWorkflowError.message : String(getWorkflowError)}`);
          // If getWorkflow fails, try to resolve by name or use as-is
          try {
            const workflows = await exportWorkflows(config);
            const byName = workflows.find(w => w.name === workflowId);
            if (byName?.id) {
              resolvedWorkflowId = byName.id;
              logger.debug(`Resolved by name: ${workflowId} -> ${resolvedWorkflowId}`);
            } else {
              logger.debug(`No workflow found with name: ${workflowId}`);
            }
          } catch (exportError) {
            logger.debug(`exportWorkflows failed: ${exportError instanceof Error ? exportError.message : String(exportError)}`);
            // Use workflowId as-is
          }
        }
        
        // Wait longer for execution to be saved to database (executions might take time to persist)
        logger.debug(`Waiting 2 seconds for execution to be saved to database...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Get most recent execution
        logger.debug(`Querying executions API for workflow: ${resolvedWorkflowId}`);
        const execResponse = await client.get('/executions', {
          params: { workflowId: resolvedWorkflowId, limit: 1 },
        });
        
        logger.info(`Executions API response status: ${execResponse.status}`);
        logger.info(`Executions API response data type: ${typeof execResponse.data}, isArray: ${Array.isArray(execResponse.data)}`);
        logger.info(`Executions API response keys: ${Object.keys(execResponse.data || {}).join(', ')}`);
        
        if (execResponse.status === 200) {
          // Handle paginated response format: { data: [...], nextCursor: "..." }
          let executions: unknown[] = [];
          if (Array.isArray(execResponse.data)) {
            executions = execResponse.data;
            logger.info(`✓ Response is array with ${executions.length} executions`);
          } else if (execResponse.data && typeof execResponse.data === 'object') {
            // Try different possible response structures
            if ('data' in execResponse.data && Array.isArray(execResponse.data.data)) {
              executions = execResponse.data.data;
              logger.info(`✓ Response has data array with ${executions.length} executions`);
            } else if ('executions' in execResponse.data && Array.isArray(execResponse.data.executions)) {
              executions = execResponse.data.executions;
              logger.info(`✓ Response has executions array with ${executions.length} executions`);
            } else if ('results' in execResponse.data && Array.isArray(execResponse.data.results)) {
              executions = execResponse.data.results;
              logger.info(`✓ Response has results array with ${executions.length} executions`);
            }
          }
          
          logger.info(`Found ${executions.length} execution(s) in response`);
          if (executions.length === 0 && execResponse.data && typeof execResponse.data === 'object') {
            logger.warn(`⚠️  NO EXECUTIONS FOUND!`);
            logger.info(`Full response structure: ${JSON.stringify(Object.keys(execResponse.data)).substring(0, 500)}`);
            logger.info(`Response data.data type: ${typeof (execResponse.data as any).data}, isArray: ${Array.isArray((execResponse.data as any).data)}`);
            logger.info(`Full response (first 2000 chars): ${JSON.stringify(execResponse.data).substring(0, 2000)}`);
            if ((execResponse.data as any).data) {
              logger.info(`data.data length: ${Array.isArray((execResponse.data as any).data) ? (execResponse.data as any).data.length : 'not an array'}`);
            }
          }
          
          if (executions.length > 0) {
            const exec = executions[0] as { id: string; status?: string; finished?: boolean };
            logger.info(`Fetching execution details for: ${exec.id}, status: ${exec.status}, finished: ${exec.finished}`);
            const detailResponse = await client.get(`/executions/${exec.id}`);
            if (detailResponse.status === 200) {
              logger.info(`✓ Found execution via API: ${exec.id}`);
              logger.info(`Execution data keys: ${Object.keys(detailResponse.data || {}).join(', ')}`);
              logger.info(`Execution status: ${(detailResponse.data as any).status}, finished: ${(detailResponse.data as any).finished}`);
              return detailResponse.data as N8nExecutionResponse;
            } else {
              logger.warn(`Failed to get execution details: status ${detailResponse.status}`);
            }
          } else {
            logger.warn(`No executions found for workflow ${resolvedWorkflowId}. Response structure: ${JSON.stringify(Object.keys(execResponse.data || {})).substring(0, 200)}`);
          }
        } else {
          logger.debug(`Executions API returned non-200 status: ${execResponse.status}`);
        }
      } catch (apiError) {
        logger.debug(`API fallback failed: ${apiError instanceof Error ? apiError.message : String(apiError)}`);
        if (apiError instanceof Error && apiError.stack) {
          logger.debug(`API error stack: ${apiError.stack.substring(0, 500)}`);
        }
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
 *
 * @throws Error if config is not provided
 */
export async function getWorkflow(
  workflowId: string,
  config: N8nApiConfig
): Promise<Workflow> {
  if (!config || !config.baseURL) {
    throw new Error(
      'n8n API config with baseURL is required.\n' +
      'Use getRunningPodConnection() from pod-connection.ts to get config for a running pod.'
    );
  }

  const client = createApiClient(config);

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
 *
 * n8n requires workflows to be archived before deletion.
 * This function automatically archives the workflow first, then deletes it.
 *
 * @throws Error if config is not provided
 */
export async function deleteWorkflow(
  workflowId: string,
  config: N8nApiConfig
): Promise<void> {
  if (!config || !config.baseURL) {
    throw new Error(
      'n8n API config with baseURL is required.\n' +
      'Use getRunningPodConnection() from pod-connection.ts to get config for a running pod.'
    );
  }

  const client = createApiClient(config);

  try {
    logger.debug(`Attempting to delete workflow ${workflowId}`);

    // Step 1: Archive the workflow first (required by n8n)
    // Use POST /workflows/{id}/archive endpoint
    try {
      const archiveResponse = await client.post(`/workflows/${workflowId}/archive`, {});

      if (archiveResponse.status === 200) {
        logger.debug(`Archived workflow ${workflowId} before deletion`);
      } else if (archiveResponse.status === 404) {
        // Workflow doesn't exist - treat as already deleted
        logger.debug(`Workflow ${workflowId} not found (may already be deleted) - treating as success`);
        return;
      } else {
        logger.debug(`Archive response for ${workflowId}: status=${archiveResponse.status}`);
      }
    } catch (archiveError) {
      if (axios.isAxiosError(archiveError)) {
        if (archiveError.response?.status === 404) {
          // Workflow doesn't exist - treat as already deleted
          logger.debug(`Workflow ${workflowId} not found during archive - treating as success`);
          return;
        }
        // Log but continue - maybe the delete will work anyway
        logger.debug(`Archive failed for ${workflowId}: ${archiveError.response?.status} ${archiveError.response?.data?.message || archiveError.message}`);
      }
    }

    // Step 2: Delete the workflow
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

