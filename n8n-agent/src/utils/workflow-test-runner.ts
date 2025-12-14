/**
 * Reusable workflow test runner utilities for Vitest tests
 * Wraps n8n execution logic without CLI-specific concerns
 */

import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import {
  importWorkflowFromFile,
  createApiClient,
  type N8nApiConfig
} from "./n8n-api";
import { type McpSseCredentialMapping } from "./workflow-reference-converter";
import { collectJsonFilesRecursive } from "./file";
import { logger } from "./logger";
import { 
  findWorkflowFile, 
  parseExecutionOutput, 
  extractWorkflowResults,
  type WorkflowFile 
} from "./test-helpers";
import type { N8nInstance } from "./n8n-podman";

// Test Runner workflow configuration
const TEST_RUNNER_FILE = 'HELPERS/Test Runner.json';
const TEST_RUNNER_ID = 'TestRunnerHelper001';
const TEST_CONFIG_NODE = '⚙️ Test Config';

/**
 * Build N8nApiConfig from N8nInstance
 * Helper for tests that manage their own containers
 * 
 * @param instance - The n8n instance to convert
 * @returns API configuration object
 */
export function buildApiConfigFromInstance(instance: N8nInstance): N8nApiConfig {
  return {
    baseURL: instance.baseUrl,
    apiKey: instance.apiKey,
    sessionCookie: instance.sessionCookie,
  };
}

/**
 * Normalize config parameter - accepts either N8nApiConfig or N8nInstance
 *
 * @param config - Either N8nApiConfig or N8nInstance
 * @returns N8nApiConfig
 * @throws Error if config is not provided
 */
function normalizeConfig(config: N8nApiConfig | N8nInstance | undefined): N8nApiConfig {
  if (!config) {
    throw new Error('Config is required for workflow test runner');
  }

  // Check if it's an N8nInstance by looking for containerName property
  if ('containerName' in config) {
    return buildApiConfigFromInstance(config as N8nInstance);
  }

  // Otherwise it's already an N8nApiConfig
  return config as N8nApiConfig;
}

/**
 * Resolve workflows directory path.
 * Works in both compiled (CLI) and test (vitest) environments.
 * Tests run from the n8n-agent directory, so we resolve relative to cwd.
 */
function resolveWorkflowsDir(): string {
  // When running tests, process.cwd() should be the n8n-agent directory
  // When running CLI (compiled), __dirname points to dist/utils
  const cwd = process.cwd();
  
  // Check if workflows directory exists in cwd (for vitest/test runs)
  const workflowsInCwd = path.join(cwd, 'workflows');
  if (fs.existsSync(workflowsInCwd)) {
    return workflowsInCwd;
  }
  
  // Fallback: try resolving from __dirname (for compiled CLI code)
  try {
    const fromDirname = path.resolve(__dirname, '../../workflows');
    if (fs.existsSync(fromDirname)) {
      return fromDirname;
    }
  } catch {
    // __dirname might not work in all environments
  }
  
  // Last resort: return the expected path relative to cwd
  // (will fail later if it doesn't exist, but at least we have a path)
  return workflowsInCwd;
}

export interface WorkflowTestResult {
  testCase: string;
  success: boolean;
  output?: unknown;
  error?: string;
  errorDetails?: unknown;
}

interface TestContext {
  workflowsDir: string;
  workflowFiles: WorkflowFile[];
  testRunnerPath: string;
  originalTestRunnerContent: string;
  tempPath: string;
}

/**
 * Initialize test context (shared setup for test runs)
 */
async function initTestContext(workflowsDir: string): Promise<TestContext> {
  const allWorkflowFiles = await collectJsonFilesRecursive(workflowsDir);

  // Build workflow file objects for matching
  const workflowFiles: WorkflowFile[] = [];
  for (const filePath of allWorkflowFiles) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const workflowJson = JSON.parse(content) as { id?: string; name?: string };
      const basename = path.basename(filePath, '.json');

      workflowFiles.push({
        path: filePath,
        content: workflowJson,
        basename
      });
    } catch {
      continue;
    }
  }

  const testRunnerPath = path.join(workflowsDir, TEST_RUNNER_FILE);

  if (!fs.existsSync(testRunnerPath)) {
    throw new Error(`Test Runner workflow not found: ${testRunnerPath}. Run: npm run n8n:workflows:upsync to import it first`);
  }

  const originalTestRunnerContent = fs.readFileSync(testRunnerPath, 'utf-8');
  // Use unique temp file per test to avoid conflicts when tests run in parallel
  // Include process ID, timestamp, and random string for uniqueness
  const uniqueId = `${process.pid}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const tempPath = path.join(workflowsDir, `.test-runner-temp-${uniqueId}.json`);

  return {
    workflowsDir,
    workflowFiles,
    testRunnerPath,
    originalTestRunnerContent,
    tempPath
  };
}

/**
 * Sync workflow to n8n before running test
 * 
 * NOTE: This is a legacy function for tests without managed containers.
 * For new tests using the container reuse pattern, workflows are synced
 * automatically in executeWorkflowTest(). You typically don't need to call this.
 * 
 * @param workflowName - Name of the workflow to sync
 * @param workflowsDir - Optional workflows directory path
 * @param config - Either N8nApiConfig or N8nInstance (for convenience)
 * 
 * @deprecated Use executeWorkflowTest() which handles sync automatically
 */
export async function syncWorkflow(
  workflowName: string,
  workflowsDir?: string,
  config?: N8nApiConfig | N8nInstance
): Promise<void> {
  const workflowsPath = workflowsDir || resolveWorkflowsDir();
  const allWorkflowFiles = await collectJsonFilesRecursive(workflowsPath);

  const workflowFiles: WorkflowFile[] = [];
  for (const filePath of allWorkflowFiles) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const workflowJson = JSON.parse(content) as { id?: string; name?: string };
      const basename = path.basename(filePath, '.json');

      workflowFiles.push({
        path: filePath,
        content: workflowJson,
        basename
      });
    } catch {
      continue;
    }
  }

  const workflowFile = findWorkflowFile(workflowName, workflowFiles);

  if (workflowFile) {
    try {
      const apiConfig = normalizeConfig(config);
      await importWorkflowFromFile(workflowFile, apiConfig);
      logger.debug(`Workflow "${workflowName}" synced successfully`);
    } catch (error) {
      // Don't fail the test if sync fails - workflow might already be in n8n
      // SQLite errors can occur due to concurrent access, but tests can still run
      logger.warn(`Warning: Failed to auto-sync workflow "${workflowName}"`, error, { workflow: workflowName });
      logger.warn(`Continuing with test - workflow may already be synced in n8n`);
      // Don't throw - allow test to proceed
    }
  } else {
    logger.warn(`Warning: Workflow file for "${workflowName}" not found`, { workflow: workflowName, workflowsDir: workflowsPath });
    // Don't throw - workflow might already be in n8n
    logger.warn(`Continuing with test - workflow may already be in n8n`);
  }
}

/**
 * Options for workflow test execution
 */
export interface ExecuteWorkflowTestOptions {
  /** Optional workflows directory path */
  workflowsDir?: string;
  /** Either N8nApiConfig or N8nInstance */
  config?: N8nApiConfig | N8nInstance;
  /** MCP credential mappings for container mode (rewrites STDIO to SSE) */
  mcpCredentialMappings?: McpSseCredentialMapping[];
}

/**
 * Execute a single workflow test case
 *
 * Automatically syncs the workflow to n8n before execution.
 *
 * @param workflowName - Name of the workflow to test
 * @param testCase - Test case identifier
 * @param testData - Test data to pass to the workflow
 * @param workflowsDir - Optional workflows directory path (legacy, use options.workflowsDir)
 * @param config - Either N8nApiConfig or N8nInstance (legacy, use options.config)
 * @param options - Additional options including MCP credential mappings
 * @returns Test result with success status, output, or error details
 *
 * @example
 * ```typescript
 * // With N8nInstance (recommended for container reuse pattern)
 * const result = await executeWorkflowTest('MyWorkflow', 'test-case', testData, undefined, instance);
 *
 * // With MCP credential mappings (for pod mode)
 * const result = await executeWorkflowTest('MyWorkflow', 'test-case', testData, undefined, instance, {
 *   mcpCredentialMappings: [{ stdioId: 'xxx', sseId: 'yyy', sseName: 'Discord MCP SSE' }]
 * });
 * ```
 */
export async function executeWorkflowTest(
  workflowName: string,
  testCase: string,
  testData: Record<string, unknown>,
  workflowsDir?: string,
  config?: N8nApiConfig | N8nInstance,
  options?: ExecuteWorkflowTestOptions
): Promise<WorkflowTestResult> {
  // Allow options to override workflowsDir and config if provided
  const effectiveWorkflowsDir = options?.workflowsDir ?? workflowsDir;
  const effectiveConfig = options?.config ?? config;
  const mcpCredentialMappings = options?.mcpCredentialMappings;
  const workflowsPath = effectiveWorkflowsDir || resolveWorkflowsDir();

  // Verify workflows directory exists
  if (!fs.existsSync(workflowsPath)) {
    return {
      testCase,
      success: false,
      error: `Workflows directory not found: ${workflowsPath}. Current working directory: ${process.cwd()}`,
    };
  }

  // Normalize config (convert N8nInstance to N8nApiConfig if needed)
  const apiConfig = normalizeConfig(effectiveConfig);

  const context = await initTestContext(workflowsPath);

  try {
    // Fetch existing workflows once to avoid importing duplicates
    // This is much more efficient than checking each workflow individually
    const { exportWorkflows } = await import('./n8n-api');
    let existingWorkflowNames: Set<string> = new Set();
    try {
      const existingWorkflows = await exportWorkflows(apiConfig);
      existingWorkflowNames = new Set(existingWorkflows.map(w => w.name));
      logger.debug(`Found ${existingWorkflowNames.size} existing workflows in n8n`);
    } catch (error) {
      logger.debug('Could not fetch existing workflows, will import all');
    }

    // Auto-import all helper workflows to ensure Test Runner dependencies are met
    // Import order matters due to workflow references between helpers
    const helpersDir = path.join(context.workflowsDir, 'HELPERS');
    if (fs.existsSync(helpersDir)) {
      const helperFiles = await collectJsonFilesRecursive(helpersDir);

      // Sort helper files by dependency order
      // Workflows that are dependencies must be imported before workflows that reference them
      const dependencyOrder = [
        'Global Cache System',      // No dependencies - must be first
        'MCP Data Normalizer',      // No dependencies
        'Test Data',                // No dependencies
        'Dynamic RAG',              // No dependencies (or self-contained)
        'Discord & Telegram Step Executor', // No dependencies
        'Universal Entity Fetcher', // Handles all platform+entity fetch operations
        'Discord Entity Cache Handler', // Depends on Global Cache System + Universal Entity Fetcher
        'Telegram Entity Cache Handler', // Depends on Global Cache System + Universal Entity Fetcher
        'Generic Context Scout Core', // Depends on platform cache handlers, Dynamic RAG
        'Test Runner',              // Depends on Test Data, Dynamic RAG - must be last
      ];

      // Sort files by dependency order
      const sortedHelperFiles = [...helperFiles].sort((a, b) => {
        const aName = path.basename(a, '.json');
        const bName = path.basename(b, '.json');
        const aIndex = dependencyOrder.findIndex(name => aName.includes(name) || name.includes(aName));
        const bIndex = dependencyOrder.findIndex(name => bName.includes(name) || name.includes(bName));
        // If not in the dependency order list, put at the end
        const aOrder = aIndex === -1 ? dependencyOrder.length : aIndex;
        const bOrder = bIndex === -1 ? dependencyOrder.length : bIndex;
        return aOrder - bOrder;
      });

      let importedCount = 0;
      let skippedCount = 0;
      for (const helperFile of sortedHelperFiles) {
        try {
          // Read the workflow name from the file to check if it already exists
          const content = fs.readFileSync(helperFile, 'utf-8');
          const workflowData = JSON.parse(content) as { name?: string };
          const workflowName = workflowData.name;

          // Skip if workflow already exists
          // Also skip Test Runner here - it will be imported with test config later
          if (workflowName && (existingWorkflowNames.has(workflowName) || workflowName.includes('Test Runner'))) {
            skippedCount++;
            continue;
          }

          await importWorkflowFromFile(helperFile, apiConfig, mcpCredentialMappings);
          if (workflowName) {
            existingWorkflowNames.add(workflowName);
          }
          importedCount++;
        } catch (error) {
          logger.warn(`Warning: Failed to auto-sync helper workflow "${path.basename(helperFile)}"`, error);
        }
      }
      logger.debug(`Helper workflows: ${importedCount} imported, ${skippedCount} skipped (already exist)`);
    }

    // Import main workflow dependencies (non-helper workflows that reference each other)
    // These must be imported before workflows that depend on them
    const mainDependencyOrder = [
      'Discord Context Scout',
      'Telegram Context Scout',
      'Discord Smart Agent',
      'Telegram Smart Agent',
      // ParagonOS Manager depends on the above, so it's not listed here
      // (will be imported as the target workflow if needed)
    ];

    for (const depName of mainDependencyOrder) {
      // Skip if this is the workflow being tested (will be imported later)
      if (depName === workflowName) continue;

      // Skip if already exists in n8n
      if (existingWorkflowNames.has(depName)) {
        logger.debug(`Skipping ${depName} (already exists)`);
        continue;
      }

      const depFile = findWorkflowFile(depName, context.workflowFiles);
      if (depFile) {
        try {
          await importWorkflowFromFile(depFile, apiConfig, mcpCredentialMappings);
          existingWorkflowNames.add(depName);
          logger.debug(`Imported main workflow dependency: ${depName}`);
        } catch (error) {
          // Ignore errors for dependencies that might already exist
          logger.debug(`Note: Could not import ${depName} (may already exist)`);
        }
      }
    }

    // Auto-import the workflow being tested (skip if already exists)
    const workflowFile = findWorkflowFile(workflowName, context.workflowFiles);

    if (workflowFile) {
      try {
        // Read the actual workflow name from the file to check if it exists
        const content = fs.readFileSync(workflowFile, 'utf-8');
        const workflowData = JSON.parse(content) as { name?: string };
        const actualWorkflowName = workflowData.name;

        // Skip if already exists in n8n
        if (actualWorkflowName && existingWorkflowNames.has(actualWorkflowName)) {
          logger.debug(`Skipping ${actualWorkflowName} (already exists)`);
        } else {
          await importWorkflowFromFile(workflowFile, apiConfig, mcpCredentialMappings);
          if (actualWorkflowName) {
            existingWorkflowNames.add(actualWorkflowName);
          }
        }
      } catch (error) {
        logger.warn(`Warning: Failed to auto-sync workflow "${workflowName}"`, error, { workflow: workflowName });
        // Continue with test anyway
      }
    }

    // Read the Test Runner workflow
    const testRunnerJson = JSON.parse(
      context.originalTestRunnerContent
    ) as {
      nodes?: Array<{ name?: string; parameters?: Record<string, unknown> }>;
      id?: string;
      [key: string]: unknown;
    };

    // Find and update the Test Config node
    const configNode = testRunnerJson.nodes?.find(
      (n) => n.name === TEST_CONFIG_NODE
    );
    if (!configNode || !configNode.parameters) {
      return {
        testCase,
        success: false,
        error: 'Test Config node not found in Test Runner workflow',
      };
    }

    // Save original config for restoration
    const originalJsonOutput =
      typeof configNode.parameters.jsonOutput === 'string'
        ? configNode.parameters.jsonOutput
        : undefined;

    // Update config with test parameters
    const configObject = { workflow: workflowName, testCase, testData };
    const configJson = JSON.stringify(configObject, null, 2);
    configNode.parameters.jsonOutput = `=${configJson}`;

    // Write modified workflow to temp file
    try {
      const jsonString = JSON.stringify(testRunnerJson, null, 2);
      fs.writeFileSync(context.tempPath, jsonString, 'utf-8');
      
      // Validate the JSON we just wrote
      JSON.parse(jsonString);
    } catch (jsonError) {
      return {
        testCase,
        success: false,
        error: `Failed to serialize test runner workflow: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`,
      };
    }

    // Import and activate Test Runner workflow to enable webhook
    let testRunnerDatabaseId: string;
    try {
      const importedWorkflow = await importWorkflowFromFile(context.tempPath, apiConfig, mcpCredentialMappings);
      if (!importedWorkflow.id) {
        throw new Error('Imported workflow did not return an ID');
      }
      testRunnerDatabaseId = importedWorkflow.id;
      logger.debug(`Test Runner imported with ID: ${testRunnerDatabaseId}`);
      
      // Activate the workflow to enable webhook
      // The /rest endpoint uses PATCH /workflows/{id} with {active: true}
      // The /api/v1 endpoint uses POST /workflows/{id}/activate
      const client = createApiClient(apiConfig);
      const baseURL = client.defaults.baseURL || '';
      if (baseURL.includes('/rest')) {
        // REST API uses PATCH with active: true
        await client.patch(`/workflows/${testRunnerDatabaseId}`, { active: true });
      } else {
        // Public API uses POST /activate
        await client.post(`/workflows/${testRunnerDatabaseId}/activate`);
      }
      logger.debug(`Test Runner activated`);
      
      // Wait for webhook to be registered
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      return {
        testCase,
        success: false,
        error: `Failed to import/activate test runner: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    let executionResult: { code: number; data: unknown; raw: string };
    const startTime = Date.now();
    try {
      // Call the production webhook
      if (!apiConfig.baseURL) {
        throw new Error('baseURL is required in config');
      }
      const baseUrl = apiConfig.baseURL;
      const webhookUrl = `${baseUrl.replace('/rest', '')}/webhook/test-runner`;
      const requestBody = { workflow: workflowName, testCase, testData };

      // Log webhook request details
      logger.info(`🌐 WEBHOOK REQUEST: POST ${webhookUrl}`);
      logger.info(`   Workflow: ${workflowName}, TestCase: ${testCase}`);
      logger.debug(`   Request body: ${JSON.stringify(requestBody).substring(0, 500)}`);

      const webhookResponse = await axios.post(webhookUrl,
        requestBody,
        {
          timeout: apiConfig?.timeout || 2 * 60 * 1000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      const duration = Date.now() - startTime;

      // Log webhook response details
      logger.info(`✅ WEBHOOK RESPONSE: ${webhookResponse.status} (${duration}ms)`);
      logger.debug(`   Response data (first 1000 chars): ${JSON.stringify(webhookResponse.data).substring(0, 1000)}`);

      // Simple response format that formatExecutionResult can handle
      executionResult = {
        code: 0,
        data: webhookResponse.data,
        raw: JSON.stringify(webhookResponse.data)
      };

      // Log execution lifecycle - query n8n execution history for details
      if (config && 'containerName' in config) {
        try {
          const client = createApiClient(apiConfig);
          const execResponse = await client.get('/executions', {
            params: { limit: 1 },
          });

          if (execResponse.status === 200 && execResponse.data) {
            // n8n REST API returns { data: { results: [...] } } structure
            const executions = execResponse.data?.data?.results ||
                               execResponse.data?.results ||
                               (Array.isArray(execResponse.data) ? execResponse.data : []);

            if (executions.length > 0) {
              const latestExec = executions[0] as { id: string; status?: string; workflowId?: string; stoppedAt?: string; startedAt?: string };
              const execDuration = latestExec.stoppedAt && latestExec.startedAt
                ? new Date(latestExec.stoppedAt).getTime() - new Date(latestExec.startedAt).getTime()
                : 0;
              logger.info(`📊 EXECUTION SAVED: ID=${latestExec.id}, status=${latestExec.status}, workflow=${latestExec.workflowId}, duration=${execDuration}ms`);
            }
          }
        } catch (execError) {
          logger.debug(`Could not query execution history: ${execError instanceof Error ? execError.message : String(execError)}`);
        }
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      let errorMsg = `Webhook execution failed: ${error instanceof Error ? error.message : String(error)}`;
      if (axios.isAxiosError(error) && error.response) {
        errorMsg += `\nStatus: ${error.response.status}`;
        errorMsg += `\nResponse: ${JSON.stringify(error.response.data).substring(0, 500)}`;
      }
      logger.error(`❌ WEBHOOK FAILED after ${duration}ms`);
      logger.error(errorMsg);

      // Collect comprehensive diagnostic information
      const errorDetails: Record<string, unknown> = {};

      if (config && 'containerName' in config) {
        const instance = config as N8nInstance;

        // Get comprehensive logs (container stdout + n8n log file)
        try {
          const { getComprehensiveLogs } = await import('./n8n-podman');
          const logs = await getComprehensiveLogs(instance.containerName, 500, 500);
          errorDetails.containerLogs = logs.containerLogs;
          errorDetails.n8nLogs = logs.n8nLogs;
          logger.error(`\n📋 CONTAINER LOGS:\n${logs.containerLogs.substring(0, 3000)}`);
          if (logs.n8nLogs) {
            logger.error(`\n📋 N8N LOG FILE:\n${logs.n8nLogs.substring(0, 3000)}`);
          }
        } catch (logError) {
          logger.warn(`Could not fetch container logs: ${logError instanceof Error ? logError.message : String(logError)}`);
        }

        // Query n8n execution history for detailed error info
        try {
          logger.info(`📋 Querying execution history from n8n API...`);
          const client = createApiClient(apiConfig);
          const execResponse = await client.get('/executions', {
            params: { limit: 5 },
          });

          logger.info(`📋 Executions API response status: ${execResponse.status}`);
          logger.debug(`📋 Executions API raw response: ${JSON.stringify(execResponse.data).substring(0, 500)}`);

          if (execResponse.status === 200 && execResponse.data) {
            // n8n REST API returns { data: { results: [...] } } structure
            // Handle multiple possible response formats
            let executions: unknown[] = [];
            if (Array.isArray(execResponse.data)) {
              executions = execResponse.data;
            } else if (execResponse.data.data?.results) {
              // Most common format: { data: { results: [...] } }
              executions = execResponse.data.data.results;
            } else if (Array.isArray(execResponse.data.data)) {
              executions = execResponse.data.data;
            } else if (execResponse.data.executions) {
              executions = execResponse.data.executions;
            } else if (execResponse.data.results) {
              executions = execResponse.data.results;
            }

            logger.info(`📋 Found ${executions?.length ?? 0} execution(s) in history`);

            if (executions.length > 0) {
              // Get the most recent execution details
              const latestExec = executions[0] as { id: string; status?: string; workflowId?: string };
              logger.info(`📋 Fetching details for execution: ${latestExec.id} (status: ${latestExec.status}, workflowId: ${latestExec.workflowId})`);
              const detailResponse = await client.get(`/executions/${latestExec.id}`);

              if (detailResponse.status === 200) {
                const execData = detailResponse.data as {
                  id: string;
                  status?: string;
                  data?: {
                    resultData?: {
                      error?: unknown;
                      runData?: Record<string, Array<{ error?: unknown; executionStatus?: string }>>
                    }
                  }
                };

                errorDetails.executionId = execData.id;
                errorDetails.executionStatus = execData.status;
                logger.info(`📋 Execution ${execData.id} status: ${execData.status}`);

                // Extract error details from execution
                if (execData.data?.resultData?.error) {
                  errorDetails.executionError = execData.data.resultData.error;
                  logger.error(`\n📋 EXECUTION ERROR:\n${JSON.stringify(execData.data.resultData.error, null, 2)}`);
                }

                // Find nodes that failed
                const runData = execData.data?.resultData?.runData;
                if (runData) {
                  const nodeNames = Object.keys(runData);
                  logger.info(`📋 Nodes executed: ${nodeNames.join(', ')}`);

                  const failedNodes = Object.entries(runData)
                    .filter(([, data]) => data.some(d => d.executionStatus === 'error' || d.error))
                    .map(([nodeName, data]) => ({
                      nodeName,
                      error: data.find(d => d.error)?.error,
                    }));

                  if (failedNodes.length > 0) {
                    errorDetails.failedNodes = failedNodes;
                    logger.error(`\n📋 FAILED NODES:\n${JSON.stringify(failedNodes, null, 2)}`);
                  } else {
                    logger.info(`📋 No nodes reported errors in execution data`);
                  }
                } else {
                  logger.warn(`📋 No runData in execution response`);
                }
              }
            } else {
              logger.warn(`📋 No executions found in n8n history - workflow may not have been saved`);
            }
          }
        } catch (execError) {
          logger.warn(`📋 Could not query execution history: ${execError instanceof Error ? execError.message : String(execError)}`);
        }
      }

      return {
        testCase,
        success: false,
        error: errorMsg,
        errorDetails: Object.keys(errorDetails).length > 0 ? errorDetails : undefined,
      };
    }

    // The webhook response is the direct workflow output
    // formatExecutionResult is for CLI execution output, not webhook responses
    const executionJson = executionResult.data;
    
    // Check for empty output
    if (
      executionJson === null ||
      (Array.isArray(executionJson) && executionJson.length === 0) ||
      (typeof executionJson === 'object' && !Array.isArray(executionJson) && Object.keys(executionJson).length === 0)
    ) {
      // Try to extract more information from the execution JSON
      let additionalInfo = '';
      
      if (typeof executionJson === 'object' && executionJson !== null) {
        const execJson = executionJson as { data?: { resultData?: { runData?: Record<string, unknown> } } };
        if (execJson.data?.resultData?.runData) {
          const nodeNames = Object.keys(execJson.data.resultData.runData);
          if (nodeNames.length > 0) {
            additionalInfo = `\nExecuted nodes: ${nodeNames.join(', ')}`;
          }
        }
      }
      
      const diagnosticInfo = [
        `Workflow: ${workflowName}`,
        `Test case: ${testCase}`,
        additionalInfo,
      ].filter(Boolean).join('\n');
      
      return {
        testCase,
        success: false,
        error: `Workflow returned empty output (possible error in sub-workflow).\n\n${diagnosticInfo}\n\nCheck n8n execution logs for details.`,
      };
    }
    
    logger.debug(`Execution JSON type: ${typeof executionJson}, is array: ${Array.isArray(executionJson)}`);
    logger.debug(`Execution JSON (first 1000 chars): ${JSON.stringify(executionJson).substring(0, 1000)}`);
    
    const { success, output, error, errorDetails } = extractWorkflowResults(executionJson);
    
    if (success) {
      return { testCase, success: true, output };
    } else {
      return { 
        testCase, 
        success: false, 
        error: error || 'Unknown error',
        errorDetails
      };
    }

  } finally {
    // NOTE: We no longer restore the Test Runner after each test.
    // With shared containers, the next test will update it with its own config.
    // This avoids creating duplicate workflows.

    // Cleanup temp file
    try {
      if (fs.existsSync(context.tempPath)) {
        fs.unlinkSync(context.tempPath);
      }
    } catch (cleanupError) {
      // Ignore cleanup errors - file might already be deleted
      logger.debug(`Failed to cleanup temp file: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
  }
}


