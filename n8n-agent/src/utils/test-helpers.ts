/**
 * Utilities for parsing and processing n8n test execution results
 * 
 * Also provides reusable container lifecycle helpers for test suites
 * using the container reuse pattern (faster than per-test containers).
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
import {
  checkPodmanAvailable,
  startN8nInstance,
  stopN8nInstance,
  type N8nInstance,
  type N8nPodmanConfig,
} from './n8n-podman';
import {
  resetN8nState,
  verifyN8nHealth,
} from './backup-restore-test';
export type { N8nInstance }
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
 * Normalize workflow name for comparison (remove spaces, case-insensitive)
 */
function normalizeWorkflowName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '').replace(/\[.*?\]/g, '');
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
  const normalizedIdentifier = normalizeWorkflowName(workflowIdentifier);

  for (const file of workflowFiles) {
    // Match by ID (most reliable)
    if (file.content.id === workflowIdentifier) {
      return file.path;
    }

    // Match by exact name
    if (file.content.name === workflowIdentifier) {
      return file.path;
    }

    // Match by normalized name (handles spaces, case differences)
    if (file.content.name && normalizeWorkflowName(file.content.name) === normalizedIdentifier) {
      return file.path;
    }

    // Match by basename (fallback for workflows without proper name/ID)
    const basenameWithoutTag = file.basename.replace(/\[.*?\]\s*/, '');
    if (file.basename === workflowIdentifier || basenameWithoutTag === workflowIdentifier) {
      return file.path;
    }

    // Match by normalized basename
    if (normalizeWorkflowName(basenameWithoutTag) === normalizedIdentifier) {
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
      error: `Failed to parse execution result: ${error instanceof Error ? error.message : String(error)
        }`,
    };
  }
}

// ============================================================================
// Standard Test Timeouts
// ============================================================================

/**
 * Standard test timeouts for consistency across test suites
 * 
 * Use these constants instead of hardcoding timeout values to ensure
 * consistency and make it easier to adjust timeouts globally.
 * 
 * @example
 * ```typescript
 * import { TEST_TIMEOUTS } from '../../utils/test-helpers';
 * 
 * it('should test something', async () => {
 *   // test code
 * }, TEST_TIMEOUTS.WORKFLOW);
 * ```
 */
export const TEST_TIMEOUTS = {
  /** 3 minutes - for simple, fast tests */
  SIMPLE: 3 * 60 * 1000,

  /** 5 minutes - for credential setup and basic integration tests */
  CREDENTIALS: 5 * 60 * 1000,

  /** 10 minutes - for workflow tests and complex integration tests */
  WORKFLOW: 10 * 60 * 1000,

  /** 10 minutes - alias for WORKFLOW (for integration tests) */
  INTEGRATION: 10 * 60 * 1000,
} as const;

// ============================================================================
// Container Lifecycle Helpers for Test Suites
// ============================================================================

/**
 * Setup function for tests that need a shared n8n instance
 * Use in beforeAll/afterAll/beforeEach for container reuse pattern
 * 
 * This pattern is 65-77% faster than starting containers per test:
 * - Container starts once in beforeAll (~20-30s)
 * - State resets in beforeEach (~1-2s)
 * - Container stops once in afterAll
 * 
 * @param config - Optional podman configuration (timeout, port, etc.)
 * @returns Configured n8n instance ready for testing
 * @throws Error if podman is not available
 * 
 * @example
 * ```typescript
 * import { setupTestInstance, cleanupTestInstance, resetTestInstance, TEST_TIMEOUTS } from '../../utils/test-helpers';
 * 
 * describe('My Test Suite', () => {
 *   let instance: N8nInstance | null = null;
 * 
 *   beforeAll(async () => {
 *     instance = await setupTestInstance();
 *   }, TEST_TIMEOUTS.WORKFLOW);
 * 
 *   afterAll(async () => {
 *     await cleanupTestInstance(instance);
 *     instance = null;
 *   }, TEST_TIMEOUTS.WORKFLOW);
 * 
 *   beforeEach(async () => {
 *     await resetTestInstance(instance);
 *   }, TEST_TIMEOUTS.WORKFLOW);
 * 
 *   it('should test something', async () => {
 *     // Use instance.baseUrl, instance.apiKey, etc.
 *   });
 * });
 * ```
 */
/**
 * Default custom n8n image with paragon-os nodes pre-installed.
 * Build with: npm run docker:build (or ./docker/build-custom-image.sh)
 */
export const DEFAULT_N8N_CUSTOM_IMAGE = 'localhost/n8n-paragon-os:latest';

export async function setupTestInstance(config?: N8nPodmanConfig): Promise<N8nInstance> {
  const podmanAvailable = await checkPodmanAvailable();
  if (!podmanAvailable) {
    throw new Error(
      'Podman is not available. Please install podman to run integration tests.\n' +
      'Install: https://podman.io/getting-started/installation'
    );
  }

  // Use custom image with paragon-os nodes by default for workflow tests
  const useCustomImage = config?.image ?? DEFAULT_N8N_CUSTOM_IMAGE;

  // Auto-mount MCP directories based on environment variables
  const autoVolumes: string[] = [];

  // Mount discord-self-mcp if DISCORD_MCP_ARGS points to a local path
  const discordMcpArgs = process.env.DISCORD_MCP_ARGS;
  if (discordMcpArgs && discordMcpArgs.startsWith('/')) {
    // Extract the directory containing the MCP script
    const mcpDir = discordMcpArgs.substring(0, discordMcpArgs.lastIndexOf('/'));
    if (mcpDir) {
      // Mount the parent directory (e.g., /Users/.../discord-self-mcp) to same path in container
      const parentDir = mcpDir.substring(0, mcpDir.lastIndexOf('/'));
      if (parentDir) {
        autoVolumes.push(`${parentDir}:${parentDir}:ro`);
        console.log(`📁 Auto-mounting MCP directory: ${parentDir}`);
      }
    }
  }

  // Mount telegram-self-mcp if TELEGRAM_MCP_ARGS points to a local path
  const telegramMcpArgs = process.env.TELEGRAM_MCP_ARGS;
  if (telegramMcpArgs && telegramMcpArgs.startsWith('/')) {
    const mcpDir = telegramMcpArgs.substring(0, telegramMcpArgs.lastIndexOf('/'));
    if (mcpDir) {
      const parentDir = mcpDir.substring(0, mcpDir.lastIndexOf('/'));
      if (parentDir && !autoVolumes.some(v => v.startsWith(parentDir))) {
        autoVolumes.push(`${parentDir}:${parentDir}:ro`);
        console.log(`📁 Auto-mounting MCP directory: ${parentDir}`);
      }
    }
  }

  // Merge auto-detected volumes with any user-provided volumes
  const mergedVolumes = [...autoVolumes, ...(config?.volumes || [])];

  console.log(`🚀 Starting shared n8n instance with image: ${useCustomImage}...`);
  const instance = await startN8nInstance({
    timeout: 120000, // 2 minutes for startup
    image: useCustomImage,
    ...config,
    volumes: mergedVolumes.length > 0 ? mergedVolumes : config?.volumes,
  });
  console.log(`✅ Instance ready: ${instance.baseUrl}`);
  return instance;
}

/**
 * Cleanup function for tests using shared n8n instance
 * Use in afterAll to stop and remove the container
 * 
 * @param instance - The n8n instance to cleanup (can be null)
 * 
 * @example
 * ```typescript
 * afterAll(async () => {
 *   await cleanupTestInstance(instance);
 *   instance = null;
 * });
 * ```
 */
export async function cleanupTestInstance(instance: N8nInstance | null): Promise<void> {
  if (instance) {
    console.log('🧹 Cleaning up n8n instance...');
    try {
      await stopN8nInstance(instance);
      console.log('✅ Cleanup complete');
    } catch (error) {
      console.error('Failed to stop instance:', error);
    }
  }
}

/**
 * Reset n8n instance state between tests
 * Use in beforeEach to reset state without restarting container
 * 
 * This is much faster than container restart (~1-2s vs 20-30s):
 * - Clears all workflows
 * - Keeps credentials intact
 * - Verifies instance health
 * 
 * @param instance - The n8n instance to reset (must not be null)
 * @throws Error if instance is null or reset fails
 * 
 * @example
 * ```typescript
 * beforeEach(async () => {
 *   await resetTestInstance(instance);
 * });
 * ```
 */
export async function resetTestInstance(instance: N8nInstance | null): Promise<void> {
  if (!instance) {
    throw new Error('Instance not initialized - beforeAll may have failed');
  }

  console.log('🔄 Resetting n8n state...');

  const healthy = await verifyN8nHealth(instance);
  if (!healthy) {
    throw new Error(
      'n8n instance is unhealthy. Container may need restart. ' +
      'Try running: npm run test:cleanup'
    );
  }

  await resetN8nState(instance);
  console.log('✅ State reset complete');
}

/**
 * Connect to a local n8n instance instead of starting a container.
 *
 * Set USE_LOCAL_N8N=true in your environment to use this mode.
 * The local n8n instance must already be running and accessible.
 *
 * Required environment variables:
 * - USE_LOCAL_N8N=true (to enable this mode)
 * - N8N_URL or N8N_BASE_URL (default: http://localhost:5678)
 * - N8N_SESSION_COOKIE (required for authentication)
 *
 * @returns N8nInstance pointing to the local n8n
 *
 * @example
 * ```bash
 * # Start n8n locally first
 * cd /path/to/n8n && n8n start
 *
 * # Then run tests with local n8n
 * USE_LOCAL_N8N=true N8N_SESSION_COOKIE="n8n-auth=..." npm test
 * ```
 */
export async function connectToLocalN8n(): Promise<N8nInstance> {
  const baseUrl = process.env.N8N_URL || process.env.N8N_BASE_URL || 'http://localhost:5678';
  const sessionCookie = process.env.N8N_SESSION_COOKIE;
  const apiKey = process.env.N8N_API_KEY;

  if (!sessionCookie && !apiKey) {
    throw new Error(
      'Local n8n authentication required. Set N8N_SESSION_COOKIE or N8N_API_KEY environment variable.\n' +
      'To get a session cookie: login to n8n UI and copy the n8n-auth cookie from browser dev tools.'
    );
  }

  console.log(`🔌 Connecting to local n8n at ${baseUrl}...`);

  // Verify n8n is accessible
  const axios = (await import('axios')).default;
  try {
    await axios.get(`${baseUrl}/healthz`, { timeout: 5000 });
  } catch (error) {
    throw new Error(
      `Cannot connect to local n8n at ${baseUrl}. Make sure n8n is running.\n` +
      `Start it with: n8n start`
    );
  }

  console.log(`✅ Connected to local n8n at ${baseUrl}`);

  return {
    baseUrl,
    containerName: 'local', // Not a container, but field is required
    dataDir: '', // Not applicable for local instance
    port: parseInt(new URL(baseUrl).port || '5678', 10),
    sessionCookie: sessionCookie || '',
    apiKey,
  };
}

/**
 * Smart setup function that uses local n8n if USE_LOCAL_N8N=true,
 * otherwise starts a container.
 *
 * @param config - Optional podman config (ignored for local mode)
 * @returns N8nInstance (either local or containerized)
 */
export async function setupTestInstanceSmart(config?: N8nPodmanConfig): Promise<N8nInstance> {
  if (process.env.USE_LOCAL_N8N === 'true') {
    return connectToLocalN8n();
  }
  return setupTestInstance(config);
}

/**
 * Smart cleanup function that only cleans up containers, not local n8n.
 *
 * @param instance - The n8n instance to cleanup
 */
export async function cleanupTestInstanceSmart(instance: N8nInstance | null): Promise<void> {
  if (!instance) return;

  // Don't cleanup local n8n instances
  if (instance.containerName === 'local') {
    console.log('🔌 Disconnecting from local n8n (no cleanup needed)');
    return;
  }

  return cleanupTestInstance(instance);
}

