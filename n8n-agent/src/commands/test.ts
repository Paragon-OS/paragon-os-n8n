import * as fs from "fs";
import * as path from "path";
import { runN8n, runN8nQuiet } from "../utils/n8n";
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

function printUsage(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                     n8n Test Runner CLI                          ║
╚══════════════════════════════════════════════════════════════════╝

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
`);
}

function printAvailableTests(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    Available Test Cases                          ║
╚══════════════════════════════════════════════════════════════════╝
`);
  
  for (const [workflow, tests] of Object.entries(TEST_CASES)) {
    console.log(`📦 ${workflow}`);
    for (const testId of Object.keys(tests)) {
      console.log(`   • ${testId}`);
    }
    console.log('');
  }
}

function parseArgs(args: string[]): { workflow?: string; testCase?: string; list?: boolean } {
  const result: { workflow?: string; testCase?: string; list?: boolean } = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--list' || arg === '-l') {
      result.list = true;
    } else if (arg === '--workflow' || arg === '-w') {
      result.workflow = args[++i];
    } else if (arg === '--test' || arg === '-t') {
      result.testCase = args[++i];
    }
  }
  
  return result;
}

export async function executeTest(flags: string[]): Promise<void> {
  const { workflow, testCase, list } = parseArgs(flags);
  
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
    console.error(`❌ Unknown workflow: ${workflow}`);
    console.log(`Available workflows: ${Object.keys(TEST_CASES).join(', ')}`);
    process.exit(1);
  }
  
  // Validate test case exists
  const testData = TEST_CASES[workflow][testCase];
  if (!testData) {
    console.error(`❌ Unknown test case: ${testCase}`);
    console.log(`Available tests for ${workflow}: ${Object.keys(TEST_CASES[workflow]).join(', ')}`);
    process.exit(1);
  }
  
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                     Running Test                                 ║
╠══════════════════════════════════════════════════════════════════╣
║  Workflow: ${workflow.padEnd(50)}║
║  Test:     ${testCase.padEnd(50)}║
╚══════════════════════════════════════════════════════════════════╝
`);
  console.log(`📥 Test Input:`);
  console.log(JSON.stringify(testData, null, 2));
  console.log('');

  const workflowsDir = path.resolve(__dirname, '../../workflows');
  
  // Auto-import the workflow being tested to ensure it's up-to-date
  console.log(`🔄 Auto-syncing workflow "${workflow}" to n8n...`);
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
      console.log(`✅ Workflow "${workflow}" synced successfully\n`);
    } catch (error) {
      console.warn(`⚠️  Warning: Failed to auto-sync workflow "${workflow}": ${error}`);
      console.warn(`   Continuing with test anyway...\n`);
    }
  } else {
    console.warn(`⚠️  Warning: Workflow file for "${workflow}" not found in ${workflowsDir}`);
    console.warn(`   Make sure the workflow is imported to n8n before running tests.\n`);
  }

  // Read the Test Runner workflow
  const testRunnerPath = path.join(workflowsDir, TEST_RUNNER_FILE);
  
  if (!fs.existsSync(testRunnerPath)) {
    console.error(`❌ Test Runner workflow not found: ${testRunnerPath}`);
    console.log(`   Run: npm run n8n:workflows:upsync to import it first`);
    process.exit(1);
  }
  
  const originalContent = fs.readFileSync(testRunnerPath, 'utf-8');
  const testRunnerJson = JSON.parse(originalContent);
  
  // Find and update the Test Config node
  const configNode = testRunnerJson.nodes.find((n: any) => n.name === TEST_CONFIG_NODE);
  if (!configNode) {
    console.error(`❌ Test Config node not found in Test Runner workflow`);
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
  
  console.log(`📝 Configured Test Runner with test: ${workflow}/${testCase}`);
  console.log(`📤 Importing to n8n...`);
  
  try {
    // Import the modified Test Runner workflow (quiet to suppress webhook warnings)
    await runN8nQuiet(['import:workflow', `--input=${tempPath}`]);
    
    console.log(`▶️  Executing Test Runner...`);
    console.log('');
    
    // Execute the Test Runner workflow (has Manual Trigger, so it works!)
    const exitCode = await runN8n([
      'execute',
      `--id=${TEST_RUNNER_ID}`
    ]);
    
    if (exitCode === 0) {
      console.log('\n✅ Test completed successfully');
    } else {
      console.error('\n❌ Test failed with exit code:', exitCode);
    }
    
    // Restore original Test Runner configuration (quiet)
    console.log(`\n🔄 Restoring Test Runner to default config...`);
    configNode.parameters.jsonOutput = originalJsonOutput;
    fs.writeFileSync(tempPath, JSON.stringify(testRunnerJson, null, 2));
    await runN8nQuiet(['import:workflow', `--input=${tempPath}`]);
    
    // Cleanup temp file
    fs.unlinkSync(tempPath);
    
    process.exit(exitCode);
    
  } catch (error) {
    // Cleanup on error
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }
}

