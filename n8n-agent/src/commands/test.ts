import * as fs from "fs";
import * as path from "path";
import boxen from "boxen";
import chalk from "chalk";
import { runN8nCapture, runN8nQuiet } from "../utils/n8n";
import { collectJsonFilesRecursive } from "../utils/file";

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
 * Extract workflow results from n8n execution output
 */
function extractWorkflowResults(executionJson: any): { success: boolean; output?: any; error?: string; errorDetails?: any } {
  try {
    const runData = executionJson?.data?.resultData?.runData;
    if (!runData) {
      return { success: false, error: 'No execution data found' };
    }

    // Find the workflow execution node (starts with "Run: ")
    const workflowNodeName = Object.keys(runData).find(name => name.startsWith('Run: '));
    if (!workflowNodeName) {
      // Check for errors in other nodes
      const errorNodes = Object.entries(runData).filter(([_, data]: [string, any]) => 
        Array.isArray(data) && data.some((exec: any) => exec.executionStatus === 'error')
      );
      if (errorNodes.length > 0) {
        const [nodeName, nodeData] = errorNodes[0];
        const errorExec = (nodeData as any[]).find((exec: any) => exec.executionStatus === 'error');
        return { 
          success: false, 
          error: `Error in ${nodeName}: ${errorExec?.error?.message || 'Unknown error'}`,
          errorDetails: errorExec?.error
        };
      }
      return { success: false, error: 'Workflow execution node not found' };
    }

    const workflowNodeData = runData[workflowNodeName];
    if (!workflowNodeData || workflowNodeData.length === 0) {
      return { success: false, error: 'Workflow execution data is empty' };
    }

    const execution = workflowNodeData[0];
    
    // Check for execution errors
    if (execution.executionStatus !== 'success') {
      const errorMessage = execution.error?.message || execution.error || 'Workflow execution failed';
      return { 
        success: false, 
        error: errorMessage,
        errorDetails: execution.error
      };
    }

    // Extract output from the workflow execution
    const outputData = execution.data?.main;
    if (!outputData || outputData.length === 0 || outputData[0].length === 0) {
      return { success: true, output: null };
    }

    // Return the first item's JSON (workflow output)
    const output = outputData[0][0]?.json;
    return { success: true, output };
    
  } catch (error) {
    return { success: false, error: `Failed to parse execution result: ${error instanceof Error ? error.message : String(error)}` };
  }
}

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
function displayTestResults(output: any, workflowName: string): void {
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
  npm run n8n:test -- --workflow <name> --test <case>
  npm run n8n:test -- --list

Options:
  --workflow, -w   Workflow name to test
  --test, -t       Test case ID
  --list, -l       List all available test cases

Examples:
  npm run n8n:test -- -w TelegramContextScout -t contact-rag
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

export async function executeTest(options: TestOptions): Promise<void> {
  const { workflow, test: testCase, list } = options;
  
  // List mode
  if (list) {
    printAvailableTests();
    process.exit(0);
  }
  
  // Validate inputs
  if (!workflow || !testCase) {
    printUsage();
    process.exit(1);
  }
  
  // Validate workflow exists
  if (!TEST_CASES[workflow]) {
    console.error(chalk.red(`❌ Unknown workflow: ${workflow}`));
    console.log(chalk.gray(`Available workflows: ${Object.keys(TEST_CASES).join(', ')}`));
    process.exit(1);
  }
  
  // Validate test case exists
  const testData = TEST_CASES[workflow][testCase];
  if (!testData) {
    console.error(chalk.red(`❌ Unknown test case: ${testCase}`));
    console.log(chalk.gray(`Available tests for ${workflow}: ${Object.keys(TEST_CASES[workflow]).join(', ')}`));
    process.exit(1);
  }
  
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

  const workflowsDir = path.resolve(__dirname, '../../workflows');
  
  // Auto-import the workflow being tested to ensure it's up-to-date
  console.log(chalk.yellow(`🔄 Auto-syncing workflow "${workflow}" to n8n...`));
  const allWorkflowFiles = await collectJsonFilesRecursive(workflowsDir);
  let workflowFile: string | undefined;
  
  // Try to find workflow by ID first, then by name match
  for (const filePath of allWorkflowFiles) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const workflowJson = JSON.parse(content) as { id?: string; name?: string };
      const basename = path.basename(filePath, '.json');
      
      // Match by ID (most reliable)
      if (workflowJson.id === workflow) {
        workflowFile = filePath;
        break;
      }
      
      // Match by exact name
      if (workflowJson.name === workflow) {
        workflowFile = filePath;
        break;
      }
      
      // Match by basename (fallback for workflows without proper name/ID)
      if (basename === workflow || basename.replace(/\[.*?\]\s*/, '') === workflow) {
        workflowFile = filePath;
        break;
      }
    } catch {
      // Skip files that can't be parsed
      continue;
    }
  }
  
  if (workflowFile) {
    try {
      await runN8nQuiet(['import:workflow', `--input=${workflowFile}`]);
      console.log(chalk.green(`✅ Workflow "${workflow}" synced successfully\n`));
    } catch (error) {
      console.warn(chalk.yellow(`⚠️  Warning: Failed to auto-sync workflow "${workflow}": ${error}`));
      console.warn(chalk.yellow(`   Continuing with test anyway...\n`));
    }
  } else {
    console.warn(chalk.yellow(`⚠️  Warning: Workflow file for "${workflow}" not found in ${workflowsDir}`));
    console.warn(chalk.yellow(`   Make sure the workflow is imported to n8n before running tests.\n`));
  }

  // Read the Test Runner workflow
  const testRunnerPath = path.join(workflowsDir, TEST_RUNNER_FILE);
  
  if (!fs.existsSync(testRunnerPath)) {
    console.error(chalk.red(`❌ Test Runner workflow not found: ${testRunnerPath}`));
    console.log(chalk.gray(`   Run: npm run n8n:workflows:upsync to import it first`));
    process.exit(1);
  }
  
  const originalContent = fs.readFileSync(testRunnerPath, 'utf-8');
  const testRunnerJson = JSON.parse(originalContent);
  
  // Find and update the Test Config node
  const configNode = testRunnerJson.nodes.find((n: any) => n.name === TEST_CONFIG_NODE);
  if (!configNode) {
    console.error(chalk.red(`❌ Test Config node not found in Test Runner workflow`));
    process.exit(1);
  }
  
  // Save original config
  const originalJsonOutput = configNode.parameters.jsonOutput;
  
  // Update config with test parameters and test data
  // Properly stringify the entire config object to handle empty strings and special characters
  const configObject = {
    workflow,
    testCase,
    testData
  };
  const configJson = JSON.stringify(configObject, null, 2);
  configNode.parameters.jsonOutput = `=${configJson}`;
  
  // Write modified workflow to temp file
  const tempPath = path.join(workflowsDir, `.test-runner-temp.json`);
  fs.writeFileSync(tempPath, JSON.stringify(testRunnerJson, null, 2));
  
  console.log(chalk.blue(`📝 Configured Test Runner with test: ${workflow}/${testCase}`));
  console.log(chalk.blue(`📤 Importing to n8n...`));
  
  try {
    // Import the modified Test Runner workflow (quiet to suppress webhook warnings)
    await runN8nQuiet(['import:workflow', `--input=${tempPath}`]);
    
    console.log(chalk.blue(`▶️  Executing Test Runner...`));
    console.log('');
    
    // Execute the Test Runner workflow and capture output
    const { code: exitCode, stdout, stderr } = await runN8nCapture([
      'execute',
      `--id=${TEST_RUNNER_ID}`
    ]);
    
    // Filter version warnings from stderr
    const filteredStderr = filterVersionWarnings(stderr);
    if (filteredStderr.trim()) {
      console.error(filteredStderr);
    }
    
    // Filter version warnings from stdout before parsing
    const filteredStdout = filterVersionWarnings(stdout);
    
    // Check if execution failed
    if (exitCode !== 0) {
      console.error(chalk.red(`\n❌ Test failed with exit code: ${exitCode}`));
      if (filteredStdout.trim()) {
        console.error(chalk.red('Output:'), filteredStdout);
      }
      process.exit(exitCode);
    }
    
    // Parse execution result - n8n outputs JSON after "Execution was successful:" and "===================================="
    let executionJson: any;
    try {
      // Find JSON block after the separator line
      const lines = filteredStdout.split('\n');
      const separatorIndex = lines.findIndex(line => line.trim().startsWith('==='));
      if (separatorIndex >= 0 && separatorIndex < lines.length - 1) {
        const jsonLines = lines.slice(separatorIndex + 1).join('\n');
        executionJson = JSON.parse(jsonLines.trim());
      } else {
        // Fallback: try to find JSON object in filtered output
        const jsonMatch = filteredStdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          executionJson = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in execution output');
        }
      }
    } catch (parseError) {
      console.error(chalk.red('❌ Failed to parse execution output'));
      console.error(chalk.red('Error:'), parseError);
      console.error(chalk.red('Raw stdout:'), stdout);
      process.exit(1);
    }
    
    // Extract and display workflow results
    const { success, output, error, errorDetails } = extractWorkflowResults(executionJson);
    
    if (success) {
      displayTestResults(output, workflow);
      console.log(chalk.green('✅ Test completed successfully'));
    } else {
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
        console.error(chalk.red('Error Details:'));
        console.error(JSON.stringify(errorDetails, null, 2));
        console.error('');
      }
      process.exit(1);
    }
    
    // Restore original Test Runner configuration (quiet - no output)
    configNode.parameters.jsonOutput = originalJsonOutput;
    fs.writeFileSync(tempPath, JSON.stringify(testRunnerJson, null, 2));
    await runN8nQuiet(['import:workflow', `--input=${tempPath}`]);
    
    // Cleanup temp file
    fs.unlinkSync(tempPath);
    
    process.exit(0);
    
  } catch (error) {
    // Cleanup on error
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }
}

