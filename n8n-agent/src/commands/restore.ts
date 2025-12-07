import fs from "fs";
import { resolveDir, getPassthroughArgs, confirm } from "../cli";
import { runN8nQuiet } from "../utils/n8n";
import { collectJsonFilesRecursive } from "../utils/file";
import { normalizeWorkflowForCompare } from "../utils/workflow";
import { deepEqual, exportCurrentWorkflowsForCompare } from "../utils/compare";
import { logger } from "../utils/logger";
import type { BackupWorkflowForRestore, WorkflowObject } from "../types/index";

interface RestoreOptions {
  input?: string;
  yes?: boolean;
}

export async function executeRestore(options: RestoreOptions, remainingArgs: string[] = []): Promise<void> {
  const inputDir = resolveDir(options.input, "./workflows");

  // Get passthrough flags for n8n (excluding our custom flags)
  const passthroughFlags = getPassthroughArgs(remainingArgs, ["--input"]);

  const jsonFiles = await collectJsonFilesRecursive(inputDir);

  if (jsonFiles.length === 0) {
    logger.info(`No workflow JSON files found under "${inputDir}".`);
    process.exit(0);
  }

  let currentWorkflows: Map<string, WorkflowObject>;
  try {
    currentWorkflows = await exportCurrentWorkflowsForCompare();
  } catch (err) {
    logger.error("Failed to export current workflows for comparison", err);
    process.exit(1);
    return;
  }

  const backups: BackupWorkflowForRestore[] = [];

  for (const filePath of jsonFiles) {
    let content: string;
    try {
      content = await fs.promises.readFile(filePath, "utf8");
    } catch (err) {
      logger.warn("Failed to read workflow file during restore", { filePath }, err);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      logger.warn("Skipping non-JSON file during restore", { filePath }, err);
      continue;
    }

    if (!parsed || typeof parsed !== "object") {
      logger.warn("Skipping unexpected workflow format during restore", { filePath });
      continue;
    }

    const wf = parsed as WorkflowObject;
    const id = typeof wf.id === "string" ? wf.id : undefined;
    const name = typeof wf.name === "string" ? wf.name : "(unnamed workflow)";

    backups.push({ filePath, workflow: wf, id, name });
  }

  if (backups.length === 0) {
    logger.info(`No valid workflow JSON files found under "${inputDir}" after parsing.`);
    process.exit(0);
  }

  const toImport: BackupWorkflowForRestore[] = [];
  let unchangedCount = 0;
  let newCount = 0;

  for (const backup of backups) {
    if (!backup.id) {
      // No ID means we cannot correlate with a live workflow; always import.
      toImport.push(backup);
      newCount++;
      continue;
    }

    const live = currentWorkflows.get(backup.id);
    if (!live) {
      toImport.push(backup);
      newCount++;
      continue;
    }

    const backupNormalized = normalizeWorkflowForCompare(backup.workflow);
    const liveNormalized = normalizeWorkflowForCompare(live);

    if (deepEqual(backupNormalized, liveNormalized)) {
      unchangedCount++;
      continue;
    }

    toImport.push(backup);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (logger.info as any)({
    total: backups.length,
    unchanged: unchangedCount,
    toImport: toImport.length,
    new: newCount
  }, `Found ${backups.length} workflow JSON file(s) in backup. Unchanged on server (skipped): ${unchangedCount}. New or changed (to import): ${toImport.length} (including ${newCount} without existing live workflows).`);

  if (toImport.length === 0) {
    logger.info("All workflows in the backup already match the current n8n instance. Nothing to restore.");
    process.exit(0);
  }

  // Ask for confirmation before importing
  logger.info(`\n📥 Ready to import ${toImport.length} workflow(s) to n8n.`);
  const confirmed = await confirm("Do you want to proceed with the restore?", options.yes || false);
  if (!confirmed) {
    logger.info("Restore cancelled.");
    process.exit(0);
  }

  logger.info(""); // Empty line after confirmation

  /**
   * NOTE:
   *   We intentionally do NOT pass "--separate" here.
   *
   *   The n8n CLI expects:
   *     - "--separate" when "--input" points to a directory that contains
   *       multiple workflow JSON files to import in one go.
   *     - NO "--separate" when "--input" points directly to a single
   *       workflow JSON file.
   *
   *   This CLI wraps each workflow JSON file individually (to support
   *   nested/tag-based directory structures created by the backup/organize
   *   commands), so we call "import:workflow" once per file without
   *   "--separate".
   */
  for (const backup of toImport) {
    const args = ["import:workflow", `--input=${backup.filePath}`, ...passthroughFlags];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (logger.info as any)({
      filePath: backup.filePath,
      workflowId: backup.id,
      workflowName: backup.name
    }, `Importing workflow from "${backup.filePath}"${backup.id ? ` (id: ${backup.id}, name: ${backup.name})` : ` (name: ${backup.name})`}`);
    const exitCode = await runN8nQuiet(args);

    if (exitCode !== 0) {
      logger.error(`n8n import:workflow failed for "${backup.filePath}" with code ${exitCode}`, undefined, { filePath: backup.filePath, exitCode });
      process.exit(exitCode);
    }
  }

  process.exit(0);
}

