import fs from "fs";
import path from "path";
import { resolveDir, confirm } from "../cli";
import { collectJsonFilesRecursive } from "../utils/file";
import { normalizeWorkflowForCompare } from "../utils/workflow";
import { deepEqual, exportCurrentWorkflowsForCompare } from "../utils/compare";
import { logger } from "../utils/logger";
import { importWorkflow, exportWorkflows } from "../utils/n8n-api";
import type { BackupWorkflowForRestore, WorkflowObject } from "../types/index";

interface RestoreOptions {
  input?: string;
  yes?: boolean;
}

export async function executeRestore(options: RestoreOptions, remainingArgs: string[] = []): Promise<void> {
  const inputDir = resolveDir(options.input, "./workflows");

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
  const deletedWorkflowIds = new Set<string>();

  for (const backup of backups) {
    if (!backup.id) {
      // No ID means we cannot correlate with a live workflow; always import.
      toImport.push(backup);
      newCount++;
      continue;
    }

    const live = currentWorkflows.get(backup.id);
    if (!live) {
      // Workflow was deleted from n8n - need to remove ID before importing
      deletedWorkflowIds.add(backup.id);
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

  logger.info(
    `Found ${backups.length} workflow JSON file(s) in backup. Unchanged on server (skipped): ${unchangedCount}. New or changed (to import): ${toImport.length} (including ${newCount} without existing live workflows).`,
    {
      total: backups.length,
      unchanged: unchangedCount,
      toImport: toImport.length,
      new: newCount
    }
  );

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
   * Import all workflows using API (unified approach).
   * References are automatically converted to name-based during import, so no ID mapping needed.
   */
  const isDeleted = (id: string | undefined) => id ? deletedWorkflowIds.has(id) : false;

  // Fetch all current workflows once to check for existing workflows by name
  // This prevents duplicates when restoring multiple times
  let currentWorkflowsForNameCheck: any[] = [];
  try {
    currentWorkflowsForNameCheck = await exportWorkflows();
    logger.debug(`Fetched ${currentWorkflowsForNameCheck.length} existing workflows for name-based duplicate prevention`);
  } catch (err) {
    logger.warn("Failed to fetch existing workflows for duplicate check, proceeding anyway", err);
  }

  for (const backup of toImport) {
    const oldId = backup.id;
    const isDeletedWorkflow = isDeleted(oldId);

    // Check if workflow with same name already exists (to prevent duplicates)
    // This is especially important for "deleted" workflows that might have been
    // restored in a previous run
    // If there are multiple workflows with the same name, use the most recently updated one
    const existingWorkflowsByName = backup.name
      ? currentWorkflowsForNameCheck.filter(w => w.name === backup.name)
      : [];
    
    // If multiple workflows with same name, prefer the most recently updated one
    const existingWorkflowByName = existingWorkflowsByName.length > 0
      ? existingWorkflowsByName.sort((a, b) => {
          const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return bTime - aTime; // Most recent first
        })[0]
      : null;
    
    const willUpdate = existingWorkflowByName !== null;
    const willCreate = isDeletedWorkflow && !existingWorkflowByName;
    
    if (existingWorkflowsByName.length > 1) {
      logger.warn(`Found ${existingWorkflowsByName.length} workflows with name "${backup.name}", using most recently updated one (ID: ${existingWorkflowByName?.id})`);
    }

    logger.info(
      `Importing workflow "${backup.name}"${oldId ? ` (old ID: ${oldId})` : " (new workflow)"}${willCreate ? " [creating new]" : willUpdate ? " [updating existing]" : ""}`,
      {
        filePath: backup.filePath,
        workflowId: oldId,
        workflowName: backup.name,
        isDeleted: isDeletedWorkflow,
        willUpdate,
        willCreate
      }
    );

    try {
      // Prepare workflow for import
      const workflowForImport = { ...backup.workflow };
      
      // For deleted workflows, remove ID so importWorkflow can search by name
      // importWorkflow will check if a workflow with the same name exists
      // If it exists, it will update it; if not, it will create a new one
      // This prevents duplicates when restoring multiple times
      if (isDeletedWorkflow) {
        delete workflowForImport.id;
      }

      // If we found an existing workflow by name, pass its ID to importWorkflow
      // This ensures we update the correct workflow and avoids issues with duplicates
      // or race conditions where importWorkflow's own lookup might find a different workflow
      const existingWorkflowId = existingWorkflowByName?.id;
      
      // Only force create if no workflow with this name exists
      // Otherwise, importWorkflow will update the existing one (using the ID we found)
      const shouldForceCreate = isDeletedWorkflow && !existingWorkflowByName;

      // Import workflow via API (handles schema cleaning, creates or updates as needed)
      // References are automatically converted to name-based during import
      // Pass the existing workflow ID if we found one to ensure we update the correct workflow
      const importedWorkflow = await importWorkflow(
        workflowForImport as any,
        undefined,
        shouldForceCreate, // Only force create if truly new (no existing workflow by name)
        existingWorkflowId // Pass the ID we found to avoid duplicate lookup issues
      );

      logger.info(`✓ Successfully imported "${backup.name}"${importedWorkflow.id ? ` (ID: ${importedWorkflow.id})` : ""}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to import workflow "${backup.name}": ${errorMessage}`, error instanceof Error ? error : undefined, {
        filePath: backup.filePath,
        originalId: oldId,
        workflowName: backup.name,
      });
      process.exit(1);
    }
  }

  /**
   * Reference fixing is no longer needed!
   * 
   * Workflow references are now automatically converted to name-based references
   * during import (in importWorkflow function). This means:
   * - References use workflow names instead of IDs
   * - Names are stable and never change
   * - No need for complex reference fixing logic
   * 
   * The convertWorkflowReferencesToNames function handles this conversion
   * automatically when workflows are imported.
   */
  logger.debug("Workflow references are automatically converted to name-based during import - no post-processing needed");

  process.exit(0);
}

