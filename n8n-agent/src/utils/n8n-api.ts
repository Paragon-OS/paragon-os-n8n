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

export interface ExecutionResult {
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
 * Import/update a workflow in n8n
 */
export async function importWorkflow(
  workflowData: Workflow,
  config?: N8nApiConfig
): Promise<Workflow> {
  const client = config ? createApiClient(config) : getDefaultClient();

  try {
    // Check if workflow exists (by ID or name)
    let existingWorkflow: Workflow | null = null;
    if (workflowData.id) {
      try {
        const getResponse = await client.get<Workflow>(`/workflows/${workflowData.id}`);
        if (getResponse.status === 200) {
          existingWorkflow = getResponse.data;
        }
      } catch {
        // Workflow doesn't exist, will create new
      }
    }

    let response;
    if (existingWorkflow) {
      // Update existing workflow
      response = await client.put<Workflow>(`/workflows/${workflowData.id}`, workflowData);
    } else {
      // Create new workflow
      response = await client.post<Workflow>('/workflows', workflowData);
    }

    if (response.status === 401) {
      throw new Error(
        `Authentication required. Please set N8N_API_KEY or N8N_SESSION_COOKIE environment variable. ` +
        `To get an API key: Settings > API in n8n UI. ` +
        `To get session cookie: Log in to n8n UI and copy the session cookie from browser dev tools.`
      );
    }
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Failed to import workflow: ${response.status} ${response.statusText}`);
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
 * Execute a workflow by ID
 */
export async function executeWorkflow(
  workflowId: string,
  inputData?: unknown,
  config?: N8nApiConfig
): Promise<ExecutionResult> {
  const client = config ? createApiClient(config) : getDefaultClient();
  const timeout = config?.timeout || 120000;

  try {
    const payload: { data?: unknown } = {};
    if (inputData !== undefined) {
      payload.data = inputData;
    }

    // n8n execute endpoint expects POST with optional data
    const response = await client.post<ExecutionResult>(
      `/workflows/${workflowId}/execute`,
      Object.keys(payload).length > 0 ? payload : undefined,
      {
        timeout, // Allow longer timeout for execution
      }
    );

    if (response.status === 401) {
      throw new Error(
        `Authentication required. Please set N8N_API_KEY or N8N_SESSION_COOKIE environment variable. ` +
        `To get an API key: Settings > API in n8n UI. ` +
        `To get session cookie: Log in to n8n UI and copy the session cookie from browser dev tools.`
      );
    }
    if (response.status !== 200) {
      const errorMessage = 
        (response.data as { message?: string }).message || 
        response.statusText ||
        `HTTP ${response.status}`;
      throw new Error(`Workflow execution failed: ${errorMessage}`);
    }

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        throw new Error(`Workflow execution timed out after ${timeout}ms`);
      }
      const message = error.response?.data?.message || error.message;
      throw new Error(`Failed to execute workflow ${workflowId}: ${message}`);
    }
    throw error;
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
 */
export function formatExecutionResult(execution: ExecutionResult): unknown {
  // Return in the same format as CLI output for backward compatibility
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

