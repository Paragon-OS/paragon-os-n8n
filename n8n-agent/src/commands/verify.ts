import fs from "fs";
import path from "path";
import { runN8nCapture } from "../utils/n8n";
import { collectJsonFilesRecursive } from "../utils/file";
import type { WorkflowObject } from "../types/index";

/**
 * Verify that workflow trigger inputs in the database match the JSON files.
 * Specifically checks for testMode parameter leakage.
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
    (node) => node.type === "n8n-nodes-base.executeWorkflowTrigger"
  );

  const inputs: TriggerInput[] = [];

  for (const node of triggerNodes) {
    const values = (node.parameters as any)?.workflowInputs?.values;
    if (Array.isArray(values)) {
      for (const value of values) {
        if (typeof value === "object" && value.name) {
          inputs.push({
            name: value.name,
            type: value.type,
            required: value.required,
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

  // Check for testMode specifically
  const hasTestModeInDb = dbNames.has("testMode");
  const hasTestModeInJson = jsonNames.has("testMode");

  if (hasTestModeInDb && !hasTestModeInJson) {
    differences.push(
      `⚠️  CRITICAL: Database has "testMode" input but JSON file doesn't!`
    );
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

  // Export workflow from n8n database
  const { code, stdout, stderr } = await runN8nCapture([
    "export:workflow",
    `--id=${wfId}`,
    "--pretty",
  ]);

  if (code !== 0) {
    return {
      workflowId: wfId,
      workflowName,
      status: "error",
      jsonInputs,
      dbInputs: [],
      differences: [
        `Failed to export workflow from database: ${stderr.trim() || "unknown error"}`,
      ],
    };
  }

  if (!stdout.trim()) {
    return {
      workflowId: wfId,
      workflowName,
      status: "not_found",
      jsonInputs,
      dbInputs: [],
      differences: ["Workflow not found in database"],
    };
  }

  let dbWorkflow: WorkflowObject;
  try {
    const parsed = JSON.parse(stdout);
    // n8n export:workflow --id may return an array with one element or a single object
    dbWorkflow = Array.isArray(parsed) ? (parsed[0] as WorkflowObject) : (parsed as WorkflowObject);
  } catch (err) {
    return {
      workflowId: wfId,
      workflowName,
      status: "error",
      jsonInputs,
      dbInputs: [],
      differences: [`Failed to parse database export: ${err}`],
    };
  }

  const dbInputs = extractTriggerInputs(dbWorkflow);
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

export async function executeVerify(flags: string[]): Promise<void> {
  const workflowsDir = path.resolve(__dirname, "../../workflows");
  const workflowFlag = flags.find((f) => f.startsWith("--workflow"));
  const specificWorkflow = workflowFlag?.includes("=") 
    ? workflowFlag.split("=")[1] 
    : workflowFlag ? flags[flags.indexOf(workflowFlag) + 1] : undefined;

  let jsonFiles: string[];
  if (specificWorkflow) {
    // Find specific workflow file
    const allFiles = await collectJsonFilesRecursive(workflowsDir);
    jsonFiles = allFiles.filter((f) =>
      path.basename(f, ".json").includes(specificWorkflow)
    );
    if (jsonFiles.length === 0) {
      console.error(`❌ Workflow "${specificWorkflow}" not found in ${workflowsDir}`);
      process.exit(1);
    }
  } else {
    jsonFiles = await collectJsonFilesRecursive(workflowsDir);
  }

  if (jsonFiles.length === 0) {
    console.log(`No workflow JSON files found under "${workflowsDir}".`);
    process.exit(0);
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║              Workflow Trigger Input Verification                 ║
╚══════════════════════════════════════════════════════════════════╝
`);
  console.log(`Checking ${jsonFiles.length} workflow(s)...\n`);

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
      console.log(`✅ ${result.workflowName} (${result.workflowId})`);
      console.log(`   JSON inputs: ${result.jsonInputs.map((i) => i.name).join(", ") || "none"}`);
    } else if (result.status === "mismatch") {
      mismatchCount++;
      console.log(`\n❌ ${result.workflowName} (${result.workflowId})`);
      console.log(`   JSON inputs: ${result.jsonInputs.map((i) => i.name).join(", ") || "none"}`);
      console.log(`   DB inputs:   ${result.dbInputs.map((i) => i.name).join(", ") || "none"}`);
      for (const diff of result.differences) {
        console.log(`   ${diff}`);
      }
    } else {
      errorCount++;
      console.log(`\n⚠️  ${result.workflowName} (${result.workflowId})`);
      for (const diff of result.differences) {
        console.log(`   ${diff}`);
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Summary:`);
  console.log(`  ✅ OK:        ${okCount}`);
  console.log(`  ❌ Mismatch:  ${mismatchCount}`);
  console.log(`  ⚠️  Errors:   ${errorCount}`);
  console.log(`${"=".repeat(60)}\n`);

  if (mismatchCount > 0) {
    console.log(`⚠️  Found ${mismatchCount} workflow(s) with mismatched trigger inputs.`);
    console.log(`   This may cause testMode parameter leakage in toolWorkflow nodes.`);
    console.log(`   Recommendation: Delete and re-import affected workflows.\n`);
    process.exit(1);
  }

  if (errorCount > 0) {
    console.log(`⚠️  Found ${errorCount} workflow(s) with errors during verification.\n`);
    process.exit(1);
  }

  console.log(`✅ All workflows verified successfully!\n`);
  process.exit(0);
}

