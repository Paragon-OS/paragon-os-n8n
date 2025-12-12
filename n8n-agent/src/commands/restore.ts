import fs from "fs";
import path from "path";
import { resolveDir, confirm } from "../cli";
import { collectJsonFilesRecursive } from "../utils/file";
import { normalizeWorkflowForCompare } from "../utils/workflow";
import { deepEqual, exportCurrentWorkflowsForCompare } from "../utils/compare";
import { logger } from "../utils/logger";
import { importWorkflow, exportWorkflows, checkN8nConnection } from "../utils/n8n-api";
import { syncWorkflowReferences } from "../utils/workflow-id-sync";
import type { BackupWorkflowForRestore, WorkflowObject } from "../types/index";
import type { Workflow } from "../utils/n8n-api";

interface RestoreOptions {
  input?: string;
  yes?: boolean;
}

export async function executeRestore(options: RestoreOptions, remainingArgs: string[] = []): Promise<void> {
  // Check if we're in test mode (don't exit process)
  const isTestMode = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

  const inputDir = resolveDir(options.input, "./workflows");

  const jsonFiles = await collectJsonFilesRecursive(inputDir);

  if (jsonFiles.length === 0) {
    logger.info(`No workflow JSON files found under "${inputDir}".`);
    if (!isTestMode) {
    process.exitCode = 0;
    }
    return;
  }

  // Quick connection check first to fail fast if n8n is not running
  logger.info("Checking n8n connection...");
  try {
    const isConnected = await checkN8nConnection();
    if (!isConnected) {
      logger.error("Cannot connect to n8n. Please ensure n8n is running at the configured URL.");
      logger.error("Check your N8N_BASE_URL environment variable or ensure n8n is started.");
      if (isTestMode) {
        throw new Error("Cannot connect to n8n");
      }
      process.exitCode = 1;
      return;
    }
  } catch (err) {
    logger.error("Failed to check n8n connection", err);
    if (isTestMode) {
      throw err;
    }
    process.exitCode = 1;
    return;
  }

  let currentWorkflows: Map<string, WorkflowObject>;

  try {
    currentWorkflows = await exportCurrentWorkflowsForCompare();
  } catch (err) {
    logger.error("Failed to export current workflows for comparison", err);
    if (isTestMode) {
      throw err;
    }
    process.exitCode = 1;
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
    if (!isTestMode) {
    process.exitCode = 0;
    }
    return;
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
    if (!isTestMode) {
    process.exitCode = 0;
    }
    return;
  }

  // Ask for confirmation before importing
  logger.info(`\n📥 Ready to import ${toImport.length} workflow(s) to n8n.`);

  const confirmed = await confirm("Do you want to proceed with the restore?", options.yes || false);
  if (!confirmed) {
    logger.info("Restore cancelled.");
    if (!isTestMode) {
    process.exitCode = 0;
    }
    return;
  }

  logger.info(""); // Empty line after confirmation

  /**
   * Import workflows using the n8n REST API.
   * References are converted automatically during import.
   */
  const isDeleted = (id: string | undefined) => id ? deletedWorkflowIds.has(id) : false;

  // Fetch all current workflows once to check for existing workflows by name
  // This prevents duplicates when restoring multiple times
  let currentWorkflowsForNameCheck: Workflow[] = [];

  try {
    currentWorkflowsForNameCheck = await exportWorkflows();
    logger.debug(`Fetched ${currentWorkflowsForNameCheck.length} existing workflows for name-based duplicate prevention`);
  } catch (err) {
    logger.warn("Failed to fetch existing workflows for duplicate check, proceeding anyway", err);
  }

  // Prepare all backup workflows for reference resolution
  // This allows the reference converter to resolve references by name even if
  // the target workflow hasn't been imported yet (critical for fixing old IDs)
  // Cast to Workflow[] since WorkflowObject is compatible (has id, name, and all other fields)
  const allBackupWorkflows = backups.map(b => b.workflow) as Workflow[];
  logger.debug(`Prepared ${allBackupWorkflows.length} backup workflows for reference resolution`);

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
          const aTime = (a.updatedAt && typeof a.updatedAt === 'string') ? new Date(a.updatedAt).getTime() : 0;
          const bTime = (b.updatedAt && typeof b.updatedAt === 'string') ? new Date(b.updatedAt).getTime() : 0;
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
      let importedWorkflow: Workflow;

      // Standard API import (may assign new IDs)
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
      // Pass all backup workflows so references can be resolved even if target workflows
      // haven't been imported yet (fixes broken old IDs from VCS upgrade)
      // Pass the existing workflow ID if we found one to ensure we update the correct workflow
      importedWorkflow = await importWorkflow(
        workflowForImport as any,
        undefined,
        shouldForceCreate, // Only force create if truly new (no existing workflow by name)
        existingWorkflowId, // Pass the ID we found to avoid duplicate lookup issues
        allBackupWorkflows // Pass all backup workflows for reference resolution
      );

      logger.info(`✓ Successfully imported "${backup.name}"${importedWorkflow.id ? ` (ID: ${importedWorkflow.id})` : ""}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to import workflow "${backup.name}": ${errorMessage}`, error instanceof Error ? error : undefined, {
        filePath: backup.filePath,
        originalId: oldId,
        workflowName: backup.name,
      });
      if (isTestMode) {
        throw error;
      }
      process.exitCode = 1;
      return;
    }
  }

  /**
   * Post-import: Fix all workflow references using actual n8n IDs
   * After restore (especially after delete-all), n8n assigns new IDs to workflows.
   * We need to update all references to use the actual IDs from n8n, not old IDs.
   * This ensures references like "http://localhost:5678/workflow/OLD_ID" get fixed.
   */
  if (toImport.length > 0) {
    logger.info("");
    logger.info("🔧 Fixing workflow references with actual n8n IDs...");

    try {
      // Fetch all workflows from n8n to get their actual IDs (after import)
      const actualWorkflows = await exportWorkflows();
      logger.debug(`Fetched ${actualWorkflows.length} workflows from n8n for reference fixing`);

      // Import the reference converter
      const { convertWorkflowReferencesToNames } = await import('../utils/workflow-reference-converter');

      // Fix references in each workflow using actual n8n IDs
      let fixedCount = 0;
      for (const workflow of actualWorkflows) {
        try {
          // Convert references using actual n8n workflows (with correct IDs)
          // Use undefined config to use default client (which should have N8N_BASE_URL set)
          const fixedWorkflow = await convertWorkflowReferencesToNames(workflow, actualWorkflows, undefined);

          // Check if any references were changed by comparing JSON
          const originalJson = JSON.stringify(workflow);
          const fixedJson = JSON.stringify(fixedWorkflow);

          if (originalJson !== fixedJson) {
            // References were updated, save the workflow back to n8n
            await importWorkflow(fixedWorkflow, undefined, false, workflow.id);
            fixedCount++;
            logger.debug(`✓ Fixed references in "${workflow.name}"`);
          }
        } catch (error) {
          logger.warn(`Failed to fix references in "${workflow.name}": ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (fixedCount > 0) {
        logger.info(`✅ Fixed workflow references in ${fixedCount} workflow(s) in n8n`);
      } else {
        logger.info("✅ All workflow references are already correct in n8n");
      }

      // Now update local files to match n8n state (with fixed references and IDs)
      logger.info("");
      logger.info("📝 Updating local workflow files to match n8n state...");
      try {
        // Build a map of workflow name -> file path for quick lookup
        const nameToFilePath = new Map<string, string>();
        for (const backup of backups) {
          if (backup.name) {
            nameToFilePath.set(backup.name, backup.filePath);
          }
        }

        // Update local files with fixed workflows from n8n
        let updatedFileCount = 0;
        for (const n8nWorkflow of actualWorkflows) {
          const filePath = nameToFilePath.get(n8nWorkflow.name);
          if (filePath && fs.existsSync(filePath)) {
            try {
              // Write the fixed workflow from n8n back to local file
              const jsonContent = JSON.stringify(n8nWorkflow, null, 2) + '\n';
              fs.writeFileSync(filePath, jsonContent, 'utf-8');
              updatedFileCount++;
              logger.debug(`✓ Updated local file: ${path.relative(inputDir, filePath)}`);
            } catch (error) {
              logger.warn(`Failed to update local file for "${n8nWorkflow.name}": ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }

        logger.info(`✅ Updated ${updatedFileCount} local workflow file(s) with fixed references and IDs`);

        // Also run sync to catch any edge cases
        const syncResult = await syncWorkflowReferences(inputDir, actualWorkflows, true);
        if (syncResult.fixed > 0) {
          logger.info(`✅ Fixed ${syncResult.fixed} additional workflow reference(s) in local files`);
        }
        if (syncResult.notFound > 0) {
          logger.warn(`⚠️  Could not resolve ${syncResult.notFound} workflow reference(s) in local files`);
        }
      } catch (error) {
        logger.warn("Failed to update local workflow files", error);
        logger.warn("Local files may still have old IDs. Run: npm run n8n:workflows:downsync to sync");
      }
    } catch (error) {
      logger.warn("Failed to fix workflow references after import", error);
      logger.warn("You may need to manually update workflow references or run the fix script");
    }
  }

  /**
   * NOTE: We do NOT sync local files after upsync.
   *
   * Local files are the source of truth. During import, references are converted
   * to name-based format in-memory (by importWorkflow), so n8n gets the correct data.
   *
   * If you need to sync local files with n8n state, run: npm run n8n:workflows:downsync
   */
  logger.info("");
  logger.info("✅ Upsync complete! Local files remain unchanged (source of truth).");
  logger.info("To sync local files with n8n state, run: npm run n8n:workflows:downsync");

  if (!isTestMode) {
  process.exitCode = 0;
  }
}
