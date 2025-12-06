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

    const { code: exitCode, stdout, stderr } = await runN8nCapture([
      'execute',
      `--id=${TEST_RUNNER_ID}`,
      '--rawOutput' // Use raw output for cleaner JSON parsing
    ]);

    const filteredStderr = filterVersionWarnings(stderr);
    if (verbose && filteredStderr.trim()) {
      logger.warn(filteredStderr);
    }

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

    if (exitCode !== 0) {
      return {
        testCase,
        success: false,
        error: `Test failed with exit code: ${exitCode}${stderr ? ` - ${stderr}` : ''}`,
        output: filteredStdout.trim() || undefined
      };
    }

    let executionJson;
    try {
      executionJson = parseExecutionOutput(filteredStdout);
    } catch (parseError) {
      return {
        testCase,
        success: false,
        error: `Failed to parse execution output: ${
          parseError instanceof Error
            ? parseError.message
            : String(parseError)
        }`,
      };
    }

    const { success, output, error, errorDetails } = extractWorkflowResults(executionJson);

    if (success) {
      if (verbose) {
        displayTestResults(output, workflow);
        console.log(chalk.green('✅ Test completed successfully'));
      }
      return { testCase, success: true, output };
    } else {
      if (verbose) {
        const errorBox = boxen(
          chalk.bold("Error:") + " " + (error || 'Unknown error'),
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
      }
      return { testCase, success: false, error: error || 'Unknown error' };
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

