import path from "path";
import fs from "fs";
import { resolveDir, confirm } from "../cli";
import { exportWorkflows } from "../utils/n8n-api";
import { collectJsonFilesRecursive, removeEmptyDirectoriesUnder } from "../utils/file";
import { parseTagFromName, sanitizeWorkflowName } from "../utils/workflow";
import { logger } from "../utils/logger";
import { syncWorkflowReferences, removeDuplicateWorkflowFiles } from "../utils/workflow-id-sync";
import type { Workflow } from "../utils/n8n-api";

interface BackupOptions {
  output?: string;
  yes?: boolean;
}

/**
 * Simplified workflow renaming function
 * 
 * Renames workflow files from ID-based names to human-readable names
 * in a single directory, without comparing to old files.
 * 
 * @param dir - Directory containing workflow JSON files (named by ID)
 */
async function renameWorkflowsByName(dir: string): Promise<void> {
  const normalizedDir = path.resolve(dir);
  
  let jsonPaths: string[];
  try {
    jsonPaths = await collectJsonFilesRecursive(normalizedDir);
  } catch (err) {
    logger.warn("Failed to collect workflow JSON files", { dir: normalizedDir }, err);
    return;
  }

  if (jsonPaths.length === 0) {
    return;
  }

  // Parse all workflows and group by ID
  const workflows: Array<{
    id: string;
    name: string;
    tag: string | undefined;
    baseName: string;
    filePath: string;
  }> = [];

  for (const filePath of jsonPaths) {
    let content: string;
    try {
      content = await fs.promises.readFile(filePath, "utf8");
    } catch (err) {
      logger.warn("Failed to read workflow file", { filePath }, err);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      logger.warn("Skipping non-JSON file", { filePath }, err);
      continue;
    }

    if (!parsed || typeof parsed !== "object") {
      logger.warn("Skipping unexpected workflow format", { filePath });
      continue;
    }

    const wf: { id?: unknown; name?: unknown; isArchived?: unknown } = parsed as {
      id?: unknown;
      name?: unknown;
      isArchived?: unknown;
    };

    const isArchived =
      typeof wf.isArchived === "boolean" ? wf.isArchived : wf.isArchived === "true";

    if (isArchived) {
      try {
        await fs.promises.unlink(filePath);
      } catch (err) {
        logger.warn("Failed to remove archived workflow file", { filePath }, err);
      }
      continue;
    }

    const id = typeof wf.id === "string" ? wf.id : undefined;
    const rawName = typeof wf.name === "string" ? wf.name : "unnamed-workflow";

    if (!id) {
      logger.warn("Skipping workflow without ID", { name: rawName, filePath });
      continue;
    }

    const { tag, baseName: taglessName } = parseTagFromName(rawName);
    const baseName = sanitizeWorkflowName(taglessName || rawName);

    workflows.push({
      id,
      name: rawName,
      tag,
      baseName,
      filePath,
    });
  }

  // Sort workflows by name for stable ordering
  workflows.sort((a, b) => {
    const nameCompare = a.baseName.localeCompare(b.baseName);
    if (nameCompare !== 0) return nameCompare;
    return a.id.localeCompare(b.id);
  });

  // Track used names to handle duplicates
  const nameCounter = new Map<string, number>();

  // Rename each workflow file
  for (const workflow of workflows) {
    const key = `${workflow.tag || ""}/${workflow.baseName}`;
    const count = (nameCounter.get(key) || 0) + 1;
    nameCounter.set(key, count);

    const finalName = count === 1 
      ? `${workflow.baseName}.json`
      : `${workflow.baseName} (${count}).json`;

    const targetDir = workflow.tag 
      ? path.join(normalizedDir, workflow.tag)
      : normalizedDir;
    const targetPath = path.join(targetDir, finalName);

    // Skip if already at target location
    if (workflow.filePath === targetPath) {
      continue;
    }

    try {
      // Ensure target directory exists
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

      // If target already exists, remove it
      try {
        await fs.promises.access(targetPath);
        await fs.promises.unlink(targetPath);
      } catch {
        // Target doesn't exist, that's fine
      }

      // Rename file
      await fs.promises.rename(workflow.filePath, targetPath);
    } catch (err) {
      logger.warn("Failed to rename workflow file", {
        from: workflow.filePath,
        to: targetPath,
        workflowId: workflow.id,
      }, err);
    }
  }

  // Clean up empty directories
  await removeEmptyDirectoriesUnder(normalizedDir);
}

export async function executeBackup(options: BackupOptions, remainingArgs: string[] = []): Promise<void> {
  const outputDir = resolveDir(options.output, "./workflows");
  const normalizedOutputDir = path.resolve(outputDir);
  const parentDir = path.dirname(normalizedOutputDir);
  const tempDir = path.join(parentDir, ".backup-temp");
  const oldBackupDir = `${normalizedOutputDir}.old`;

  logger.info(`📦 Backup target: ${normalizedOutputDir}`);
  logger.info("   This will export all workflows from n8n to the backup directory.\n");

  if (!options.yes) {
    const shouldContinue = await confirm("Do you want to proceed with the backup?");
    if (!shouldContinue) {
      logger.info("Backup cancelled.");
      process.exit(0);
    }
  }

  logger.info("");

  // Step 1: Fetch workflows from n8n
  let workflows: Workflow[];
  try {
    logger.info("Fetching workflows from n8n...");
    workflows = await exportWorkflows();
    logger.info(`Fetched ${workflows.length} workflow(s) from n8n.`);
  } catch (err) {
    logger.error("Failed to export workflows from n8n API", err);
    process.exit(1);
    return;
  }

  // Step 2: Write ALL workflows to temp directory
  try {
    // Clean up any existing temp directory
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Doesn't exist, that's fine
    }

    await fs.promises.mkdir(tempDir, { recursive: true });

    let exportedCount = 0;
    for (const workflow of workflows) {
      // Skip archived workflows
      if ((workflow as { isArchived?: boolean }).isArchived === true) {
        continue;
      }

      // Use workflow ID as filename
      if (!workflow.id) {
        logger.warn(`Skipping workflow "${workflow.name}" - no ID found`);
        continue;
      }

      const filename = `${workflow.id}.json`;
      const filePath = path.join(tempDir, filename);

      try {
        const jsonContent = JSON.stringify(workflow, null, 2) + '\n';
        await fs.promises.writeFile(filePath, jsonContent, "utf8");
        exportedCount++;
      } catch (err) {
        logger.warn(`Failed to write workflow file: ${filePath}`, err);
      }
    }

    logger.info(`Exported ${exportedCount} workflow(s) to temp directory`);
  } catch (err) {
    logger.error("Failed to write workflows to temp directory", err);
    process.exit(1);
    return;
  }

  // Step 3: Rename files to human-readable names (in temp dir)
  logger.info("Renaming workflows to human-readable names...");
  await renameWorkflowsByName(tempDir);

  // Step 4: Sync workflow references
  logger.info("Syncing workflow references...");
  
  // Remove any duplicate files
  const duplicatesRemoved = removeDuplicateWorkflowFiles(tempDir);
  if (duplicatesRemoved > 0) {
    logger.info(`Removed ${duplicatesRemoved} duplicate workflow file(s)`);
  }
  
  // Sync workflow references to match actual n8n IDs
  // This fixes references that point to old IDs (e.g., after workflows were re-imported with new IDs)
  logger.info("Syncing workflow references to match n8n IDs...");
  try {
    // Pass silent=false to show detailed logging
    const syncResult = await syncWorkflowReferences(tempDir, workflows, false);
    
    if (syncResult.fixed > 0) {
      logger.info(`✅ Fixed ${syncResult.fixed} workflow reference(s) to match n8n IDs`);
      if (syncResult.details.length > 0 && syncResult.details.length <= 10) {
        // Show details for small numbers of fixes
        syncResult.details.forEach(detail => {
          logger.info(`   • ${detail.workflowName} → ${detail.nodeName} → ${detail.targetName} (${detail.oldId} → ${detail.newId})`);
        });
      } else if (syncResult.details.length > 10) {
        // Show first few for large numbers
        syncResult.details.slice(0, 5).forEach(detail => {
          logger.info(`   • ${detail.workflowName} → ${detail.nodeName} → ${detail.targetName} (${detail.oldId} → ${detail.newId})`);
        });
        logger.info(`   ... and ${syncResult.details.length - 5} more`);
      }
    }
    
    if (syncResult.notFound > 0) {
      logger.warn(`⚠️  ${syncResult.notFound} referenced workflow(s) not found in n8n (may have been deleted or renamed)`);
    }
    
    if (syncResult.fixed === 0 && syncResult.notFound === 0) {
      logger.info("✓ All workflow references are already in sync with n8n");
    }
  } catch (err) {
    logger.warn("Failed to sync workflow references", err);
  }

  // Step 5: Atomically replace workflows directory
  logger.info("Replacing workflows directory...");
  
  try {
    // Move current workflows to backup (if exists)
    try {
      await fs.promises.access(normalizedOutputDir);
      
      // Clean up any old backup first
      try {
        await fs.promises.rm(oldBackupDir, { recursive: true, force: true });
      } catch {
        // Doesn't exist, that's fine
      }
      
      await fs.promises.rename(normalizedOutputDir, oldBackupDir);
      logger.debug(`Moved existing workflows to ${oldBackupDir}`);
    } catch {
      // Directory doesn't exist, that's fine
    }

    // Move temp to workflows
    await fs.promises.rename(tempDir, normalizedOutputDir);
    logger.info(`✓ Workflows directory updated`);

    // Clean up old backup
    try {
      await fs.promises.rm(oldBackupDir, { recursive: true, force: true });
      logger.debug(`Cleaned up old backup directory`);
    } catch {
      // Doesn't exist or couldn't delete, that's fine
    }
  } catch (err) {
    logger.error("Failed to replace workflows directory", err);
    
    // Try to restore from old backup
    try {
      await fs.promises.access(oldBackupDir);
      await fs.promises.rename(oldBackupDir, normalizedOutputDir);
      logger.info("Restored workflows from backup after error");
    } catch {
      // Couldn't restore
    }
    
    process.exit(1);
    return;
  }

  logger.info("");
  logger.info("✅ Backup completed successfully!");
  logger.info(`   ${workflows.length} workflow(s) backed up to ${normalizedOutputDir}`);

  process.exit(0);
}
