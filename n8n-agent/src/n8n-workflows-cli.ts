import { Command } from "commander";
import { getRemainingArgs } from "./cli";
import { executeBackup } from "./commands/backup";
import { executeRestore } from "./commands/restore";
import { executeTree } from "./commands/tree";
import { executeOrganize } from "./commands/organize";
import { executeTest } from "./commands/test";
import { executeVerify } from "./commands/verify";

const program = new Command();

program
  .name("n8n-workflows-cli")
  .description("CLI tool for managing n8n workflows")
  .version("1.0.0");

program
  .command("backup")
  .description("Export workflows from n8n instance to JSON files")
  .option("-o, --output <dir>", "Output directory for workflow files", "./workflows")
  .option("-y, --yes", "Skip confirmation prompt")
  .allowUnknownOption(true) // Allow n8n-specific flags to pass through
  .action(async (options, command) => {
    const remainingArgs = getRemainingArgs(command);
    await executeBackup(options, remainingArgs);
  });

program
  .command("restore")
  .description("Import workflows from JSON files to n8n instance")
  .option("-i, --input <dir>", "Input directory containing workflow JSON files", "./workflows")
  .option("-y, --yes", "Skip confirmation prompt")
  .allowUnknownOption(true)
  .action(async (options, command) => {
    const remainingArgs = getRemainingArgs(command);
    await executeRestore(options, remainingArgs);
  });

program
  .command("organize")
  .description("Organize workflow JSON files into tag-based subdirectories")
  .option("-i, --input <dir>", "Input directory to organize", "./workflows")
  .action(async (options) => {
    await executeOrganize(options);
  });

program
  .command("tree")
  .description("Print logical folder structure of workflows from n8n")
  .allowUnknownOption(true) // Allow n8n-specific flags like --all, --active, etc.
  .action(async (options, command) => {
    // For tree, all remaining args after command are passthrough
    const remainingArgs = getRemainingArgs(command);
    await executeTree(remainingArgs);
  });

program
  .command("test")
  .description("Run test cases against workflows")
  .option("-w, --workflow <name>", "Workflow name to test")
  .option("-t, --test <case>", "Test case ID")
  .option("-l, --list", "List all available test cases")
  .action(async (options) => {
    await executeTest(options);
  });

program
  .command("verify")
  .description("Verify workflow trigger inputs match database")
  .option("-w, --workflow <name>", "Specific workflow to verify")
  .action(async (options) => {
    await executeVerify(options);
  });

// Parse arguments
program.parse();
