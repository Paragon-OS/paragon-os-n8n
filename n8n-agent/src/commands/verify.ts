import fs from "fs";
import path from "path";
import boxen from "boxen";
import chalk from "chalk";
import { getWorkflow, exportWorkflows } from "../utils/n8n-api";
import { collectJsonFilesRecursive } from "../utils/file";
import { logger } from "../utils/logger";
import type { WorkflowObject } from "../types/index";
import type { ExecuteWorkflowTriggerNode } from "../types/n8n";
import { isExecuteWorkflowTriggerNode } from "../types/n8n";
import type { Workflow } from "../utils/n8n-api";

/**
 * Verify that workflow trigger inputs in the database match the JSON files.
 * 
 * Usage:
 *   npm run n8n:verify
 *   npm run n8n:verify -- --workflow TelegramContextScout
 */

interface TriggerInput {
  name: string;
  type?: string;
  required?: boolean;
}

interface VerificationResult {
  workflowId: string;
  workflowName: string;
  status: "ok" | "mismatch" | "error" | "not_found";
  jsonInputs: TriggerInput[];
  dbInputs: TriggerInput[];
  differences: string[];
}

function extractTriggerInputs(workflow: WorkflowObject): TriggerInput[] {
  if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
    return [];
  }

  // Find executeWorkflowTrigger nodes
  const triggerNodes = workflow.nodes.filter(
    (node): node is ExecuteWorkflowTriggerNode =>
      isExecuteWorkflowTriggerNode(node as ExecuteWorkflowTriggerNode)
  );

  const inputs: TriggerInput[] = [];

  for (const node of triggerNodes) {
    const values = node.parameters?.workflowInputs?.values;
    if (Array.isArray(values)) {
      for (const value of values) {
        if (typeof value === "object" && value !== null && "name" in value) {
          const valueObj = value as { name: string; type?: string; required?: boolean };
          inputs.push({
            name: valueObj.name,
            type: valueObj.type,
            required: valueObj.required,
          });
        } else if (typeof value === "string") {
          inputs.push({ name: value });
        }
      }
    }
  }

  return inputs;
}

function compareInputs(
  jsonInputs: TriggerInput[],
  dbInputs: TriggerInput[]
): string[] {
  const differences: string[] = [];
  const jsonNames = new Set(jsonInputs.map((i) => i.name));
  const dbNames = new Set(dbInputs.map((i) => i.name));

  // Check for extra inputs in database
  for (const dbInput of dbInputs) {
    if (!jsonNames.has(dbInput.name)) {
      differences.push(
        `Database has extra input: "${dbInput.name}" (not in JSON file)`
      );
    }
  }

  // Check for missing inputs in database
  for (const jsonInput of jsonInputs) {
    if (!dbNames.has(jsonInput.name)) {
      differences.push(
        `JSON file has input "${jsonInput.name}" but database doesn't`
      );
    }
  }

  return differences;
}

async function verifyWorkflow(
  filePath: string,
  workflowId?: string
): Promise<VerificationResult> {
  const workflowName = path.basename(filePath, ".json");
  const fileContent = await fs.promises.readFile(filePath, "utf8");
  const jsonWorkflow = JSON.parse(fileContent) as WorkflowObject;
  const jsonInputs = extractTriggerInputs(jsonWorkflow);

  const wfId = workflowId || jsonWorkflow.id;
  if (!wfId) {
    return {
      workflowId: "unknown",
      workflowName,
      status: "error",
      jsonInputs,
      dbInputs: [],
      differences: ["No workflow ID found in JSON file"],
    };
  }

  // Get workflow from n8n database using REST API
  let dbWorkflow: Workflow;
  try {
    // Check if wfId looks like a valid database ID (UUID or NanoID)
    const isValidDatabaseId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wfId) ||
                               /^[A-Za-z0-9_-]{10,21}$/.test(wfId);
    
    if (isValidDatabaseId) {
      // Try to get workflow by ID first
      try {
        dbWorkflow = await getWorkflow(wfId);
      } catch (getError) {
        // If getWorkflow fails, fall through to name search
        logger.debug(`Failed to get workflow by ID "${wfId}", trying to find by name...`);
        const allWorkflows = await exportWorkflows();
        const found = allWorkflows.find((w) => w.id === wfId);
        
        if (found) {
          dbWorkflow = found;
        } else {
          // Try to find by workflow name from JSON file
          const foundByName = allWorkflows.find((w) => w.name === workflowName);
          if (foundByName) {
            dbWorkflow = foundByName;
          } else {
            throw new Error(`Workflow not found: ${wfId}`);
          }
        }
      }
    } else {
      // Custom ID or name - search by name
      logger.debug(`Looking up workflow by name: "${wfId}" or "${workflowName}"`);
      const allWorkflows = await exportWorkflows();
      const found = allWorkflows.find(
        (w) => w.id === wfId || w.name === wfId || w.name === workflowName
      );
      
      if (!found) {
        throw new Error(`Workflow not found: ${wfId}`);
      }
      
      dbWorkflow = found;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      workflowId: wfId,
      workflowName,
      status: "error",
      jsonInputs,
      dbInputs: [],
      differences: [
        `Failed to get workflow from database: ${errorMessage}`,
      ],
    };
  }
  
  // Convert Workflow to WorkflowObject format for compatibility
  // WorkflowObject is a superset of Workflow, so we can cast it directly
  const dbWorkflowObject: WorkflowObject = dbWorkflow as unknown as WorkflowObject;

  const dbInputs = extractTriggerInputs(dbWorkflowObject);
  const differences = compareInputs(jsonInputs, dbInputs);

  return {
    workflowId: wfId,
    workflowName,
    status: differences.length === 0 ? "ok" : "mismatch",
    jsonInputs,
    dbInputs,
    differences,
  };
}

interface VerifyOptions {
  workflow?: string;
}

export async function executeVerify(options: VerifyOptions): Promise<void> {
  const workflowsDir = path.resolve(__dirname, "../../workflows");
  const specificWorkflow = options.workflow;

  let jsonFiles: string[];
  if (specificWorkflow) {
    // Find specific workflow file
    const allFiles = await collectJsonFilesRecursive(workflowsDir);
    jsonFiles = allFiles.filter((f) =>
      path.basename(f, ".json").includes(specificWorkflow)
    );
    if (jsonFiles.length === 0) {
      logger.error(`❌ Workflow "${specificWorkflow}" not found`, undefined, { workflow: specificWorkflow, workflowsDir });
      process.exit(1);
    }
  } else {
    jsonFiles = await collectJsonFilesRecursive(workflowsDir);
  }

  if (jsonFiles.length === 0) {
    logger.warn(`No workflow JSON files found under "${workflowsDir}".`);
    process.exit(0);
  }

  const headerBox = boxen(
    `Checking ${chalk.bold(jsonFiles.length.toString())} workflow(s)...`,
    {
      title: "Workflow Trigger Input Verification",
      titleAlignment: "center",
      padding: 1,
      borderColor: "blue",
      borderStyle: "round",
    }
  );
  console.log(headerBox);
  console.log('');

  const results: VerificationResult[] = [];

  for (const filePath of jsonFiles) {
    const workflow = JSON.parse(
      await fs.promises.readFile(filePath, "utf8")
    ) as WorkflowObject;
    const result = await verifyWorkflow(filePath, workflow.id);
    results.push(result);
  }

  // Print results
  let okCount = 0;
  let mismatchCount = 0;
  let errorCount = 0;

  for (const result of results) {
    if (result.status === "ok") {
      okCount++;
      console.log(chalk.green(`✅ ${result.workflowName} (${result.workflowId})`));
      console.log(chalk.gray(`   JSON inputs: ${result.jsonInputs.map((i) => i.name).join(", ") || "none"}`));
    } else if (result.status === "mismatch") {
      mismatchCount++;
      console.log(chalk.red(`\n❌ ${result.workflowName} (${result.workflowId})`));
      console.log(chalk.gray(`   JSON inputs: ${result.jsonInputs.map((i) => i.name).join(", ") || "none"}`));
      console.log(chalk.gray(`   DB inputs:   ${result.dbInputs.map((i) => i.name).join(", ") || "none"}`));
      for (const diff of result.differences) {
        console.log(chalk.yellow(`   ${diff}`));
      }
    } else {
      errorCount++;
      console.log(chalk.yellow(`\n⚠️  ${result.workflowName} (${result.workflowId})`));
      for (const diff of result.differences) {
        console.log(chalk.red(`   ${diff}`));
      }
    }
  }

  const summaryText = `Summary:\n` +
    `  ${chalk.green("✅ OK:")}        ${okCount}\n` +
    `  ${chalk.red("❌ Mismatch:")}  ${mismatchCount}\n` +
    `  ${chalk.yellow("⚠️  Errors:")}   ${errorCount}`;
  
  const summaryBox = boxen(summaryText, {
    padding: 1,
    borderColor: mismatchCount > 0 || errorCount > 0 ? "red" : "green",
    borderStyle: "round",
  });
  console.log("\n" + summaryBox + "\n");

  if (mismatchCount > 0) {
    logger.warn(`⚠️  Found ${mismatchCount} workflow(s) with mismatched trigger inputs.`, { mismatchCount });
    logger.info(`   Recommendation: Delete and re-import affected workflows.\n`);
    process.exit(1);
  }

  if (errorCount > 0) {
    logger.warn(`⚠️  Found ${errorCount} workflow(s) with errors during verification.\n`, { errorCount });
    process.exit(1);
  }

  logger.info(`✅ All workflows verified successfully!\n`);
  process.exit(0);
}

