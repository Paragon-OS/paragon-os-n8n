import * as fs from "fs";
import * as path from "path";
import boxen from "boxen";
import chalk from "chalk";
import { runN8nCapture, runN8nQuiet } from "../utils/n8n";
import { collectJsonFilesRecursive } from "../utils/file";
import { logger } from "../utils/logger";
import { 
  findWorkflowFile, 
  parseExecutionOutput, 
  extractWorkflowResults,
  type WorkflowFile 
} from "../utils/test-helpers";

/**
 * Run a test case against a workflow using the Test Data helper.
 * 
 * Usage:
 *   npm run n8n:test -- --workflow TelegramContextScout --test contact-rag
 *   npm run n8n:test -- --workflow DynamicRAG --test status
 *   npm run n8n:test -- --list  (show available tests)
 */

// Load test cases from external file (same source as Test Data workflow)
const testCasesPath = path.resolve(__dirname, '../../test-cases.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TEST_CASES: Record<string, Record<string, Record<string, unknown>>> = require(testCasesPath);

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

/**
 * Display test results in a clean format
 */
function displayTestResults(output: unknown, workflowName: string): void {
  const outputText = output === null || output === undefined
    ? "(No output returned)"
    : JSON.stringify(output, null, 2);
  
  const box = boxen(
    chalk.bold("Workflow Output:") + "\n\n" + outputText,
    {
      title: "Test Results",
      titleAlignment: "center",
      padding: 1,
      borderColor: "green",
      borderStyle: "round",
    }
  );
  
  console.log(box);
}

function printUsage(): void {
  const usageText = `
Usage:
  npm run n8n:test -- --workflow <name>              Run all tests for a workflow
  npm run n8n:test -- --workflow <name> --test <id>  Run a specific test
  npm run n8n:test -- --list                         List all available tests

Options:
  --workflow, -w   Workflow name to test
  --test, -t       Test case ID (optional - runs all if omitted)
  --list, -l       List all available test cases

Examples:
  npm run n8n:test -- -w TelegramContextScout           # Run all tests
  npm run n8n:test -- -w TelegramContextScout -t contact-rag  # Run one test
  npm run n8n:test -- -w DynamicRAG -t status
  npm run n8n:test -- --list
`;

  const box = boxen(usageText.trim(), {
    title: "n8n Test Runner CLI",
    titleAlignment: "center",
    padding: 1,
    borderColor: "blue",
    borderStyle: "round",
  });

  console.log(box);
}

function printAvailableTests(): void {
  let testsText = "";
  for (const [workflow, tests] of Object.entries(TEST_CASES)) {
    testsText += chalk.cyan.bold(`📦 ${workflow}\n`);
    for (const testId of Object.keys(tests)) {
      testsText += `   • ${testId}\n`;
    }
    testsText += "\n";
  }
  
  const box = boxen(testsText.trim(), {
    title: "Available Test Cases",
    titleAlignment: "center",
    padding: 1,
    borderColor: "cyan",
    borderStyle: "round",
  });
  
  console.log(box);
}

interface TestOptions {
  workflow?: string;
  test?: string;
  list?: boolean;
}

interface SingleTestResult {
  testCase: string;
  success: boolean;
  output?: unknown;
  error?: string;
}

interface TestContext {
  workflowsDir: string;
  workflowFiles: WorkflowFile[];
  testRunnerPath: string;
  originalTestRunnerContent: string;
  tempPath: string;
}

/**
 * Initialize test context (shared setup for single and batch test runs)
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
    logger.error(`❌ Test Runner workflow not found: ${testRunnerPath}`);
    logger.info(`   Run: npm run n8n:workflows:upsync to import it first`);
    process.exit(1);
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
 * Run a single test case and return the result (without calling process.exit)
 */
async function runSingleTest(
  workflow: string,
  testCase: string,
  testData: Record<string, unknown>,
  context: TestContext,
  verbose: boolean = true
): Promise<SingleTestResult> {
  const { workflowsDir, workflowFiles, tempPath } = context;

  if (verbose) {
    const runningTestBox = boxen(
      `${chalk.bold("Workflow:")} ${workflow}\n${chalk.bold("Test:")}     ${testCase}`,
      {
        title: "Running Test",
        titleAlignment: "center",
        padding: 1,
        borderColor: "yellow",
        borderStyle: "round",
      }
    );
    console.log(runningTestBox);

    console.log(chalk.blue(`📥 Test Input:`));
    console.log(JSON.stringify(testData, null, 2));
    console.log('');
  }

  // Auto-import the workflow being tested
  if (verbose) {
    console.log(chalk.yellow(`🔄 Auto-syncing workflow "${workflow}" to n8n...`));
  }

  const workflowFile = findWorkflowFile(workflow, workflowFiles);

  if (workflowFile) {
    try {
      await runN8nQuiet(['import:workflow', `--input=${workflowFile}`]);
      if (verbose) {
        console.log(chalk.green(`✅ Workflow "${workflow}" synced successfully\n`));
      }
    } catch (error) {
      if (verbose) {
        logger.warn(`⚠️  Warning: Failed to auto-sync workflow "${workflow}"`, error, { workflow });
        logger.warn(`   Continuing with test anyway...\n`);
      }
    }
  } else if (verbose) {
    logger.warn(`⚠️  Warning: Workflow file for "${workflow}" not found`, { workflow, workflowsDir });
    logger.warn(`   Make sure the workflow is imported to n8n before running tests.\n`);
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
  const configObject = { workflow, testCase, testData };
  const configJson = JSON.stringify(configObject, null, 2);
  configNode.parameters.jsonOutput = `=${configJson}`;

  // Write modified workflow to temp file
  fs.writeFileSync(tempPath, JSON.stringify(testRunnerJson, null, 2));

  if (verbose) {
    console.log(chalk.blue(`📝 Configured Test Runner with test: ${workflow}/${testCase}`));
    console.log(chalk.blue(`📤 Importing to n8n...`));
  }

  try {
    await runN8nQuiet(['import:workflow', `--input=${tempPath}`]);

    if (verbose) {
      console.log(chalk.blue(`▶️  Executing Test Runner...`));
      console.log('');
    }

    // Use full execution JSON format (without --rawOutput) for better error detection
    // This provides runData with executionStatus for each node, allowing us to detect
    // sub-workflow errors even when the Test Runner workflow completes successfully
    const { code: exitCode, stdout, stderr } = await runN8nCapture([
      'execute',
      `--id=${TEST_RUNNER_ID}`
      // Removed --rawOutput to get full execution JSON with error details
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
      // Try to parse stdout for error details even if exit code is non-zero
      let errorDetails = '';
      let errorMessage = '';
      
      if (filteredStdout.trim()) {
        // First, try to extract error message from the text before JSON
        // n8n outputs error messages like: "Error message\nExecution error:\n====================================\n{json}"
        const lines = filteredStdout.split('\n');
        const errorLineIndex = lines.findIndex(line => 
          line.includes('Testing error detection') || 
          line.includes('INTENTIONAL TEST ERROR') ||
          line.includes('Execution was NOT successful')
        );
        
        if (errorLineIndex >= 0) {
          // Get the error message line
          errorMessage = lines[errorLineIndex].trim();
        }
        
        // Then try to parse the JSON for more details
        try {
          const executionJson = parseExecutionOutput(filteredStdout);
          const result = extractWorkflowResults(executionJson);
          if (!result.success && result.error) {
            // Use the extracted error if we didn't find one in text, or combine them
            if (!errorMessage) {
              errorMessage = result.error;
            } else if (result.error !== errorMessage) {
              // Combine both if they're different
              errorMessage = `${errorMessage} (${result.error})`;
            }
            errorDetails = result.errorDetails ? JSON.stringify(result.errorDetails).substring(0, 500) : '';
          }
        } catch (parseError) {
          // If JSON parsing fails, try to extract from the text we already found
          if (!errorMessage) {
            // Look for error in the first few lines
            errorMessage = lines.slice(0, 5).find(l => l.trim() && !l.includes('==='))?.trim() || 
                          `Failed to parse execution output: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
          }
        }
      }
      
      const finalErrorMessage = errorMessage 
        ? errorMessage
        : `Test failed with exit code: ${exitCode}${filteredStderr.trim() ? ` - ${filteredStderr.trim()}` : ''}`;
      
      // Always display error, not just when verbose
      const errorBox = boxen(
        chalk.bold("Error:") + " " + finalErrorMessage,
        {
          title: "Test Failed",
          titleAlignment: "center",
          padding: 1,
          borderColor: "red",
          borderStyle: "round",
        }
      );
      console.error(errorBox);
      
      if (errorDetails) {
        logger.error('Error Details:', errorDetails);
      }
      
      return {
        testCase,
        success: false,
        error: finalErrorMessage,
        output: filteredStdout.trim() || undefined
      };
    }

    // Exit code is 0, but we still need to check for errors in the output
    // (sub-workflow errors might not cause non-zero exit code)
    let executionJson;
    try {
      executionJson = parseExecutionOutput(filteredStdout);
    } catch (parseError) {
      // If stdout is empty, this might indicate a silent failure
      if (!filteredStdout.trim()) {
        return {
          testCase,
          success: false,
          error: 'Workflow returned no output (possible error in sub-workflow). Check n8n execution logs for details.',
        };
      }
      
      // Check if stdout contains error messages even if not parseable as JSON
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
    
    // Check for empty output (might indicate failure)
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
    
    // Log execution JSON for debugging - always log if there's an error
    if (!success) {
      const execJson = executionJson as { data?: { resultData?: { runData?: unknown } } };
      logger.warn('Execution JSON structure:', {
        hasData: execJson && 'data' in execJson,
        hasResultData: execJson?.data?.resultData !== undefined,
        hasRunData: execJson?.data?.resultData && 'runData' in (execJson.data.resultData as object),
        keys: execJson ? Object.keys(execJson).slice(0, 10) : [],
        extractedError: error,
        extractedSuccess: success,
      });
      if (execJson && execJson.data?.resultData) {
        logger.warn('ResultData keys:', Object.keys(execJson.data.resultData));
        if ('runData' in execJson.data.resultData) {
          const runData = execJson.data.resultData.runData as Record<string, unknown>;
          logger.warn('RunData node names:', Object.keys(runData));
        }
      }
      logger.warn('Execution JSON (first 2000 chars):', JSON.stringify(executionJson).substring(0, 2000));
    }

    if (success) {
      if (verbose) {
        displayTestResults(output, workflow);
        console.log(chalk.green('✅ Test completed successfully'));
      }
      return { testCase, success: true, output };
    } else {
      // Always display error, even if not verbose
      const errorMsg = error || 'Unknown error';
      const errorBox = boxen(
        chalk.bold("Error:") + " " + errorMsg,
        {
          title: "Test Failed",
          titleAlignment: "center",
          padding: 1,
          borderColor: "red",
          borderStyle: "round",
        }
      );
      console.error(errorBox);

      if (errorDetails) {
        logger.error('Error Details:', errorDetails);
      }
      
      return { testCase, success: false, error: errorMsg };
    }

  } finally {
    // Restore original Test Runner configuration
    if (configNode && configNode.parameters) {
      configNode.parameters.jsonOutput = originalJsonOutput;
      fs.writeFileSync(tempPath, JSON.stringify(testRunnerJson, null, 2));
      await runN8nQuiet(['import:workflow', `--input=${tempPath}`]);
    }
  }
}

/**
 * Run all tests for a workflow and display summary
 */
async function runAllTests(
  workflow: string,
  tests: Record<string, Record<string, unknown>>,
  context: TestContext
): Promise<void> {
  const testCases = Object.entries(tests);
  const totalTests = testCases.length;

  console.log(boxen(
    `${chalk.bold("Workflow:")} ${workflow}\n${chalk.bold("Tests:")}    ${totalTests} test case${totalTests > 1 ? 's' : ''}`,
    {
      title: "Running All Tests",
      titleAlignment: "center",
      padding: 1,
      borderColor: "cyan",
      borderStyle: "round",
    }
  ));
  console.log('');

  const results: SingleTestResult[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const [testCase, testData] = testCases[i];

    console.log(chalk.cyan(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
    console.log(chalk.cyan.bold(`  [${i + 1}/${totalTests}] ${testCase}`));
    console.log(chalk.cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));

    const result = await runSingleTest(workflow, testCase, testData, context, false);
    results.push(result);

    if (result.success) {
      console.log(chalk.green(`  ✅ ${testCase} - PASSED`));
      if (result.output) {
        const outputStr = JSON.stringify(result.output, null, 2);
        const truncated = outputStr.length > 200 ? outputStr.substring(0, 200) + '...' : outputStr;
        console.log(chalk.gray(`     ${truncated.replace(/\n/g, '\n     ')}`));
      }
    } else {
      console.log(chalk.red(`  ❌ ${testCase} - FAILED`));
      if (result.error) {
        console.log(chalk.red(`     ${result.error}`));
      }
    }
  }

  // Display summary
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log('\n');

  let summaryText = '';
  summaryText += `${chalk.bold("Total:")}  ${totalTests} tests\n`;
  summaryText += `${chalk.green.bold("Passed:")} ${passed}\n`;
  summaryText += `${chalk.red.bold("Failed:")} ${failed}`;

  if (failed > 0) {
    summaryText += '\n\n' + chalk.red.bold('Failed Tests:');
    for (const result of results.filter(r => !r.success)) {
      summaryText += `\n  • ${result.testCase}: ${result.error}`;
    }
  }

  const borderColor = failed === 0 ? 'green' : 'red';
  const title = failed === 0 ? '✅ All Tests Passed' : '❌ Some Tests Failed';

  console.log(boxen(summaryText, {
    title,
    titleAlignment: "center",
    padding: 1,
    borderColor,
    borderStyle: "round",
  }));

  // Cleanup temp file
  if (fs.existsSync(context.tempPath)) {
    fs.unlinkSync(context.tempPath);
  }

  process.exit(failed > 0 ? 1 : 0);
}

export async function executeTest(options: TestOptions): Promise<void> {
  const { workflow, test: testCase, list } = options;

  // List mode
  if (list) {
    printAvailableTests();
    process.exit(0);
  }

  // Validate workflow is provided
  if (!workflow) {
    printUsage();
    process.exit(1);
  }

  // Validate workflow exists
  if (!TEST_CASES[workflow]) {
    logger.error(`❌ Unknown workflow: ${workflow}`);
    logger.info(`Available workflows: ${Object.keys(TEST_CASES).join(', ')}`);
    process.exit(1);
  }

  const workflowsDir = path.resolve(__dirname, '../../workflows');
  const context = await initTestContext(workflowsDir);

  // If no test case specified, run all tests for the workflow
  if (!testCase) {
    await runAllTests(workflow, TEST_CASES[workflow], context);
    return;
  }

  // Validate test case exists
  const testData = TEST_CASES[workflow][testCase];
  if (!testData) {
    logger.error(`❌ Unknown test case: ${testCase}`);
    logger.info(`Available tests for ${workflow}: ${Object.keys(TEST_CASES[workflow]).join(', ')}`);
    process.exit(1);
  }

  // Run single test
  const result = await runSingleTest(workflow, testCase, testData, context, true);

  // Cleanup temp file
  if (fs.existsSync(context.tempPath)) {
    fs.unlinkSync(context.tempPath);
  }

  process.exit(result.success ? 0 : 1);
}

