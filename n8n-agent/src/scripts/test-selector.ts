#!/usr/bin/env ts-node

// eslint-disable-next-line @typescript-eslint/no-require-imports
const prompts = require('prompts');
import { execa } from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface TestFile {
  path: string;
  name: string;
  testCases: TestCase[];
}

interface TestCase {
  name: string;
  testCase: string;
}

/**
 * Parse test file to extract test cases from test.each() arrays
 */
function parseTestFile(filePath: string): TestFile {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath, '.test.ts');
  
  // Extract describe block name
  const describeMatch = content.match(/describe\(['"]([^'"]+)['"]/);
  const describeName = describeMatch ? describeMatch[1] : fileName;
  
  // Extract test.each() array
  const testEachMatch = content.match(/test\.each\(\[([\s\S]*?)\]\)/);
  const testCases: TestCase[] = [];
  
  if (testEachMatch) {
    const testArrayContent = testEachMatch[1];
    // Match each test case object
    const testCaseRegex = /\{\s*testCase:\s*['"]([^'"]+)['"]/g;
    let match;
    
    while ((match = testCaseRegex.exec(testArrayContent)) !== null) {
      testCases.push({
        name: match[1],
        testCase: match[1],
      });
    }
  }
  
  return {
    path: filePath,
    name: describeName,
    testCases,
  };
}

/**
 * Find all test files
 */
function findTestFiles(testDir: string = 'src/tests/workflows'): TestFile[] {
  const testFiles: TestFile[] = [];
  const fullPath = path.join(process.cwd(), testDir);
  
  if (!fs.existsSync(fullPath)) {
    console.error(chalk.red(`Test directory not found: ${fullPath}`));
    process.exit(1);
  }
  
  const files = fs.readdirSync(fullPath);
  
  for (const file of files) {
    if (file.endsWith('.test.ts')) {
      const filePath = path.join(fullPath, file);
      try {
        const testFile = parseTestFile(filePath);
        testFiles.push(testFile);
      } catch (error) {
        console.warn(chalk.yellow(`Warning: Could not parse ${file}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
  }
  
  return testFiles.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Run selected tests
 */
async function runTests(selection: string[]): Promise<void> {
  if (selection.length === 0) {
    console.log(chalk.yellow('No tests selected. Exiting.'));
    return;
  }
  
  console.log(chalk.blue('\nRunning selected tests...\n'));
  
  // Build vitest command
  const args = ['run', ...selection];
  
  try {
    const { stdout, stderr } = await execa('npm', ['run', 'test', '--', ...args], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
  } catch (error) {
    // execa with stdio: 'inherit' will show output directly
    // Exit with the same code as the test command
    process.exit(error instanceof Error && 'exitCode' in error ? (error as any).exitCode : 1);
  }
}

/**
 * Main interactive selector
 */
async function main() {
  console.log(chalk.cyan.bold('\n🧪 Interactive Test Selector\n'));
  
  const testFiles = findTestFiles();
  
  if (testFiles.length === 0) {
    console.error(chalk.red('No test files found!'));
    process.exit(1);
  }
  
  // Build options for the selector
  const options: Array<{ title: string; value: string; description?: string; disabled?: boolean }> = [
    { title: chalk.bold('📁 Run All Tests'), value: '__all__', description: 'Run all test files (selecting this ignores other selections)' },
    { title: chalk.gray('─────────────────'), value: '__separator__', disabled: true },
  ];
  
  // Add test files
  for (const testFile of testFiles) {
    const testCount = testFile.testCases.length;
    const description = testCount > 0 
      ? `${testCount} test case${testCount > 1 ? 's' : ''}`
      : 'No test cases found';
    
    options.push({
      title: `📄 ${testFile.name}`,
      value: testFile.path,
      description: description,
    });
  }
  
  // Add individual test cases if any file has test cases
  const hasTestCases = testFiles.some(tf => tf.testCases.length > 0);
  
  if (hasTestCases) {
    options.push({ title: chalk.gray('─────────────────'), value: '__separator2__', disabled: true });
    options.push({ 
      title: chalk.bold('🔍 Select Individual Test Cases'), 
      value: '__individual__',
      description: 'Choose specific test cases to run'
    });
  }
  
  // First selection: file or all (multi-select enabled)
  let selections: string[];
  try {
    const result = await prompts({
      type: 'multiselect',
      name: 'selections',
      message: 'Select tests to run (space to select, enter to confirm):',
      choices: options,
      instructions: false,
    });
    
    if (!result || !result.selections || result.selections.length === 0) {
      console.log(chalk.yellow('\nNo tests selected. Exiting.'));
      process.exit(0);
    }
    
    selections = result.selections;
  } catch (error) {
    // Handle Ctrl+C gracefully
    console.log(chalk.yellow('\n\nCancelled.'));
    process.exit(0);
  }
  
  let testArgs: string[] = [];
  
  // Handle multiple selections
  if (selections.includes('__all__')) {
    // Run all tests (ignore other selections if "all" is selected)
    testArgs = ['src/tests/workflows/'];
  } else if (selections.includes('__individual__')) {
    // Show individual test case selector
    const testCaseOptions: Array<{ title: string; value: string; description?: string; disabled?: boolean }> = [];
    
    for (const testFile of testFiles) {
      if (testFile.testCases.length > 0) {
        testCaseOptions.push({ 
          title: chalk.gray(`─── ${testFile.name} ───`), 
          value: `__header_${testFile.name}__`, 
          disabled: true 
        });
        
        for (const testCase of testFile.testCases) {
          testCaseOptions.push({
            title: `  ✓ ${testCase.name}`,
            value: `${testFile.path}::${testCase.testCase}`,
            description: `From ${testFile.name}`,
          });
        }
      }
    }
    
    let testCases: string[];
    try {
      const result = await prompts({
        type: 'multiselect',
        name: 'testCases',
        message: 'Select test cases (space to select, enter to confirm):',
        choices: testCaseOptions,
        instructions: false,
      });
      
      if (!result || !result.testCases || result.testCases.length === 0) {
        console.log(chalk.yellow('\nNo test cases selected. Exiting.'));
        process.exit(0);
      }
      
      testCases = result.testCases;
    } catch (error) {
      // Handle Ctrl+C gracefully
      console.log(chalk.yellow('\n\nCancelled.'));
      process.exit(0);
    }
    
    // Group by file and build test args
    const fileGroups = new Map<string, string[]>();
    
    for (const testCase of testCases as string[]) {
      if (testCase.startsWith('__header_')) continue;
      
      const [filePath, testName] = testCase.split('::');
      if (!fileGroups.has(filePath)) {
        fileGroups.set(filePath, []);
      }
      fileGroups.get(filePath)!.push(testName);
    }
    
    // Build vitest args: file -t "test1|test2|test3"
    // Group by file to run each file's tests together
    const entries = Array.from(fileGroups.entries());
    for (const [filePath, testNames] of entries) {
      // Escape special regex characters in test names
      const escapedNames = testNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const testPattern = escapedNames.join('|');
      testArgs.push(filePath, '-t', testPattern);
    }
  } else {
    // Multiple files selected (or single file)
    // Filter out separators and invalid values
    const validSelections = selections.filter(
      (s: string) => s && !s.startsWith('__separator') && s !== '__individual__'
    );
    
    if (validSelections.length === 0) {
      console.log(chalk.yellow('\nNo valid test files selected. Exiting.'));
      process.exit(0);
    }
    
    testArgs = validSelections;
  }
  
  // Run the tests
  await runTests(testArgs);
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  });
}

