/**
 * Reusable workflow test runner utilities for Vitest tests
 * Wraps n8n execution logic without CLI-specific concerns
 */

import * as fs from "fs";
import * as path from "path";
import { 
  importWorkflowFromFile, 
  executeWorkflow, 
  formatExecutionResult,
  getWorkflow,
  type N8nExecutionResponse,
  type N8nApiConfig
} from "./n8n-api";
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
 * @returns N8nApiConfig (or undefined if config was undefined)
 */
function normalizeConfig(config?: N8nApiConfig | N8nInstance): N8nApiConfig | undefined {
  if (!config) {
    return undefined;
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
 * Execute a single workflow test case
 * 
 * Automatically syncs the workflow to n8n before execution.
 * 
 * @param workflowName - Name of the workflow to test
 * @param testCase - Test case identifier
 * @param testData - Test data to pass to the workflow
 * @param workflowsDir - Optional workflows directory path
 * @param config - Either N8nApiConfig or N8nInstance (for convenience with container reuse pattern)
 * @returns Test result with success status, output, or error details
 * 
 * @example
 * ```typescript
 * // With N8nInstance (recommended for container reuse pattern)
 * const result = await executeWorkflowTest('MyWorkflow', 'test-case', testData, undefined, instance);
 * 
 * // With N8nApiConfig (legacy)
 * const result = await executeWorkflowTest('MyWorkflow', 'test-case', testData, undefined, { baseURL: '...', apiKey: '...' });
 * ```
 */
export async function executeWorkflowTest(
  workflowName: string,
  testCase: string,
  testData: Record<string, unknown>,
  workflowsDir?: string,
  config?: N8nApiConfig | N8nInstance
): Promise<WorkflowTestResult> {
  const workflowsPath = workflowsDir || resolveWorkflowsDir();
  
  // Verify workflows directory exists
  if (!fs.existsSync(workflowsPath)) {
    return {
      testCase,
      success: false,
      error: `Workflows directory not found: ${workflowsPath}. Current working directory: ${process.cwd()}`,
    };
  }
  
  // Normalize config (convert N8nInstance to N8nApiConfig if needed)
  const apiConfig = normalizeConfig(config);
  
  const context = await initTestContext(workflowsPath);

  try {
    // Auto-import dependency workflows first (if needed)
    // Discord/Telegram Context Scout depends on Generic Context Scout Core
    if (workflowName === 'DiscordContextScout' || workflowName === 'TelegramContextScout') {
      const coreWorkflowFile = findWorkflowFile('Generic Context Scout Core', context.workflowFiles);
      if (coreWorkflowFile) {
        try {
          await importWorkflowFromFile(coreWorkflowFile, apiConfig);
          logger.debug(`Dependency workflow "Generic Context Scout Core" synced successfully`);
        } catch (error) {
          logger.warn(`Warning: Failed to auto-sync dependency workflow "Generic Context Scout Core"`, error);
          // Continue anyway - might already be imported
        }
      }
    }

    // Auto-import the workflow being tested
    const workflowFile = findWorkflowFile(workflowName, context.workflowFiles);

    if (workflowFile) {
      try {
        await importWorkflowFromFile(workflowFile, apiConfig);
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

    // Import modified Test Runner using API and get the actual database ID
    let testRunnerDatabaseId: string;
    try {
      const importedWorkflow = await importWorkflowFromFile(context.tempPath, apiConfig);
      // After import, we get the actual database ID (not the custom ID from JSON)
      if (!importedWorkflow.id) {
        throw new Error('Imported workflow did not return an ID');
      }
      testRunnerDatabaseId = importedWorkflow.id;
      logger.debug(`Test Runner workflow imported successfully with database ID: ${testRunnerDatabaseId}`);
    } catch (error) {
      return {
        testCase,
        success: false,
        error: `Failed to import test runner workflow: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    let executionResult: N8nExecutionResponse;
    try {
      // Use the database ID returned from import (this is what n8n CLI --id expects after restore)
      // The custom ID (TestRunnerHelper001) won't work after workflows are restored with new IDs
      const executionConfig: N8nApiConfig = {
        ...apiConfig,
        timeout: apiConfig?.timeout || 2 * 60 * 1000, // 2 minutes default
      };
      executionResult = await executeWorkflow(testRunnerDatabaseId, undefined, executionConfig);
    } catch (error) {
      // Handle timeout or execution errors
      if (error instanceof Error && error.message.includes('timed out')) {
        return {
          testCase,
          success: false,
          error: `Test timed out after 2 minutes. The workflow may be stuck or taking too long to execute.`,
        };
      }
      return {
        testCase,
        success: false,
        error: `Failed to execute workflow: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Format execution result to match expected format
    const executionJson = formatExecutionResult(executionResult);
    
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
    // Restore original Test Runner configuration by importing the original file
    try {
      // Restore from the original test runner file path using API
      await importWorkflowFromFile(context.testRunnerPath, apiConfig);
    } catch {
      // Ignore cleanup errors - Test Runner will be restored on next test or can be manually restored
      logger.debug('Failed to restore Test Runner configuration during cleanup');
    }
    
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

