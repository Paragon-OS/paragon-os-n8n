/**
 * Reusable workflow test runner utilities for Vitest tests
 * Wraps n8n execution logic without CLI-specific concerns
 */

import * as fs from "fs";
import * as path from "path";
import { runN8nCapture, runN8nQuiet } from "./n8n";
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
 * Filter out version compatibility warnings from output
 */
function filterVersionWarnings(output: string): string {
  const lines = output.split('\n');
  return lines
    .filter(line => !line.includes('Client version') && !line.includes('is incompatible with server version'))
    .filter(line => !line.includes('checkCompatibility=false'))
    .filter(line => !line.includes('Major versions should match'))
    .join('\n');
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
  const workflowsPath = workflowsDir || path.resolve(__dirname, '../../workflows');
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
      await runN8nQuiet(['import:workflow', `--input=${workflowFile}`]);
      logger.debug(`Workflow "${workflowName}" synced successfully`);
    } catch (error) {
      logger.warn(`Warning: Failed to auto-sync workflow "${workflowName}"`, error, { workflow: workflowName });
      throw new Error(`Failed to sync workflow "${workflowName}"`);
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
  const workflowsPath = workflowsDir || path.resolve(__dirname, '../../workflows');
  const context = await initTestContext(workflowsPath);

  try {
    // Auto-import the workflow being tested
    const workflowFile = findWorkflowFile(workflowName, context.workflowFiles);

    if (workflowFile) {
      try {
        await runN8nQuiet(['import:workflow', `--input=${workflowFile}`]);
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
    fs.writeFileSync(context.tempPath, JSON.stringify(testRunnerJson, null, 2));

    // Import modified Test Runner
    await runN8nQuiet(['import:workflow', `--input=${context.tempPath}`]);

    // Execute Test Runner
    const { code: exitCode, stdout, stderr } = await runN8nCapture([
      'execute',
      `--id=${TEST_RUNNER_ID}`
    ]);

    const filteredStderr = filterVersionWarnings(stderr);
    const filteredStdout = filterVersionWarnings(stdout);

    // Handle timeout (exit code 124)
    if (exitCode === 124) {
      return {
        testCase,
        success: false,
        error: `Test timed out after 2 minutes. The workflow may be stuck or taking too long to execute.`,
        output: filteredStdout.trim() || undefined
      };
    }

    // If exit code is non-zero, try to extract error information
    if (exitCode !== 0) {
      let errorDetails = '';
      let errorMessage = '';
      
      if (filteredStdout.trim()) {
        const lines = filteredStdout.split('\n');
        const errorLineIndex = lines.findIndex(line => 
          line.includes('Testing error detection') || 
          line.includes('INTENTIONAL TEST ERROR') ||
          line.includes('Execution was NOT successful')
        );
        
        if (errorLineIndex >= 0) {
          errorMessage = lines[errorLineIndex].trim();
        }
        
        try {
          const executionJson = parseExecutionOutput(filteredStdout);
          const result = extractWorkflowResults(executionJson);
          if (!result.success && result.error) {
            if (!errorMessage) {
              errorMessage = result.error;
            } else if (result.error !== errorMessage) {
              errorMessage = `${errorMessage} (${result.error})`;
            }
            errorDetails = result.errorDetails ? JSON.stringify(result.errorDetails).substring(0, 500) : '';
          }
        } catch (parseError) {
          if (!errorMessage) {
            errorMessage = lines.slice(0, 5).find(l => l.trim() && !l.includes('==='))?.trim() || 
                          `Failed to parse execution output: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
          }
        }
      }
      
      const finalErrorMessage = errorMessage 
        ? errorMessage
        : `Test failed with exit code: ${exitCode}${filteredStderr.trim() ? ` - ${filteredStderr.trim()}` : ''}`;
      
      return {
        testCase,
        success: false,
        error: finalErrorMessage,
        output: filteredStdout.trim() || undefined,
        errorDetails: errorDetails || undefined
      };
    }

    // Exit code is 0, parse the output
    let executionJson;
    try {
      executionJson = parseExecutionOutput(filteredStdout);
    } catch (parseError) {
      if (!filteredStdout.trim()) {
        return {
          testCase,
          success: false,
          error: 'Workflow returned no output (possible error in sub-workflow). Check n8n execution logs for details.',
        };
      }
      
      const errorMatch = filteredStdout.match(/Execution error:[\s\S]*?message["\s:]+([^"}\n]+)/i) ||
                        filteredStdout.match(/Error:[\s\S]*?message["\s:]+([^"}\n]+)/i) ||
                        filteredStdout.match(/INTENTIONAL TEST ERROR[^\n]*/i) ||
                        filteredStdout.match(/Testing error detection[^\n]*/i);
      
      if (errorMatch) {
        return {
          testCase,
          success: false,
          error: errorMatch[1] || errorMatch[0] || 'Workflow execution failed',
        };
      }
      
      return {
        testCase,
        success: false,
        error: `Failed to parse execution output: ${
          parseError instanceof Error
            ? parseError.message
            : String(parseError)
        }${filteredStdout.trim() ? `\nRaw output: ${filteredStdout.substring(0, 200)}` : ''}`,
      };
    }
    
    // Check for empty output
    if (
      executionJson === null ||
      (Array.isArray(executionJson) && executionJson.length === 0) ||
      (typeof executionJson === 'object' && !Array.isArray(executionJson) && Object.keys(executionJson).length === 0)
    ) {
      return {
        testCase,
        success: false,
        error: 'Workflow returned empty output (possible error in sub-workflow). Check n8n execution logs for details.',
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
      // Restore from the original test runner file path
      await runN8nQuiet(['import:workflow', `--input=${context.testRunnerPath}`]);
    } catch {
      // Ignore cleanup errors - Test Runner will be restored on next test or can be manually restored
      logger.debug('Failed to restore Test Runner configuration during cleanup');
    }
    
    // Cleanup temp file
    if (fs.existsSync(context.tempPath)) {
      fs.unlinkSync(context.tempPath);
    }
  }
}

