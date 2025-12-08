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
  type N8nExecutionResponse 
} from "./n8n-api";
import { collectJsonFilesRecursive } from "./file";
import { logger } from "./logger";
import { 
  findWorkflowFile, 
  parseExecutionOutput, 
  extractWorkflowResults,
  type WorkflowFile 
} from "./test-helpers";

// Test Runner workflow configuration
const TEST_RUNNER_FILE = 'HELPERS/[HELPERS] Test Runner.json';
const TEST_RUNNER_ID = 'TestRunnerHelper001';
const TEST_CONFIG_NODE = '⚙️ Test Config';

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
  const tempPath = path.join(workflowsDir, `.test-runner-temp.json`);

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
 */
export async function syncWorkflow(
  workflowName: string,
  workflowsDir?: string
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
      await importWorkflowFromFile(workflowFile);
      logger.debug(`Workflow "${workflowName}" synced successfully`);
    } catch (error) {
      logger.warn(`Warning: Failed to auto-sync workflow "${workflowName}"`, error, { workflow: workflowName });
      throw new Error(`Failed to sync workflow "${workflowName}": ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    logger.warn(`Warning: Workflow file for "${workflowName}" not found`, { workflow: workflowName, workflowsDir: workflowsPath });
    throw new Error(`Workflow file for "${workflowName}" not found`);
  }
}

/**
 * Execute a single workflow test case
 */
export async function executeWorkflowTest(
  workflowName: string,
  testCase: string,
  testData: Record<string, unknown>,
  workflowsDir?: string
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
  
  const context = await initTestContext(workflowsPath);

  try {
    // Auto-import the workflow being tested
    const workflowFile = findWorkflowFile(workflowName, context.workflowFiles);

    if (workflowFile) {
      try {
        await importWorkflowFromFile(workflowFile);
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

    // Import modified Test Runner using API
    try {
      await importWorkflowFromFile(context.tempPath);
      logger.debug(`Test Runner workflow imported successfully`);
    } catch (error) {
      return {
        testCase,
        success: false,
        error: `Failed to import test runner workflow: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Execute Test Runner using the custom ID from the JSON file
    // The CLI --id flag expects the custom ID from the workflow JSON (TestRunnerHelper001),
    // not the database UUID returned by the API
    // We need to read the custom ID from the temp file since that's what we just imported
    let testRunnerCustomId: string = TEST_RUNNER_ID; // Fallback to constant
    try {
      const testRunnerContent = JSON.parse(fs.readFileSync(context.tempPath, 'utf-8'));
      if (testRunnerContent.id) {
        testRunnerCustomId = testRunnerContent.id;
      }
    } catch {
      // Use fallback ID
    }

    let executionResult: N8nExecutionResponse;
    try {
      // Use the custom ID from the JSON file (this is what CLI expects)
      executionResult = await executeWorkflow(testRunnerCustomId, undefined, { timeout: 2 * 60 * 1000 });
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
      await importWorkflowFromFile(context.testRunnerPath);
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

