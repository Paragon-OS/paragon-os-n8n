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
   * Helper function to check if an ID looks like a custom ID (not a database ID)
   */
  function isValidCustomId(id: string): boolean {
    // Database IDs are either UUIDs or NanoIDs (10-21 alphanumeric chars)
    // Custom IDs are usually longer strings with mixed case, no dashes
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const nanoIdPattern = /^[A-Za-z0-9_-]{10,21}$/;
    
    // If it's not a UUID or NanoID, it's likely a custom ID
    return !uuidPattern.test(id) && !nanoIdPattern.test(id);
  }

  /**
   * Import all workflows using API (unified approach).
   * This ensures consistent schema handling and allows us to track ID mappings during import.
   */
  const idMapping = new Map<string, string>(); // old ID -> new ID
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
      // Pass the existing workflow ID if we found one to ensure we update the correct workflow
      const importedWorkflow = await importWorkflow(
        workflowForImport as any,
        undefined,
        shouldForceCreate, // Only force create if truly new (no existing workflow by name)
        existingWorkflowId // Pass the ID we found to avoid duplicate lookup issues
      );

      // Build ID mapping: old ID -> new ID
      // Always create mapping if we have both old and new IDs, even if they're the same
      // (this helps with reference updates even when workflow wasn't recreated)
      if (oldId && importedWorkflow.id) {
        if (oldId !== importedWorkflow.id) {
          idMapping.set(oldId, importedWorkflow.id);
          logger.debug(`Mapped workflow ID: ${oldId} -> ${importedWorkflow.id} (${backup.name})`);
        } else {
          // Even if IDs match, create mapping for reference updates
          idMapping.set(oldId, importedWorkflow.id);
          logger.debug(`Mapped workflow ID (same): ${oldId} -> ${importedWorkflow.id} (${backup.name})`);
        }
      }

      // Also map custom IDs (like "TelegramContextScout") to new database ID
      if (oldId && isValidCustomId(oldId) && importedWorkflow.id) {
        idMapping.set(oldId, importedWorkflow.id);
        logger.debug(`Mapped custom ID: ${oldId} -> ${importedWorkflow.id} (${backup.name})`);
      }

      logger.info(`✓ Successfully imported "${backup.name}"${importedWorkflow.id ? ` (new ID: ${importedWorkflow.id})` : ""}`);
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
   * After import: fix workflow references that still point to old IDs.
   * We now have accurate ID mappings from the import process, so we can fix references reliably.
   */
  try {
    if (idMapping.size === 0) {
      logger.debug("No ID mappings to process - skipping reference updates");
    } else {
      logger.info(`\nUpdating workflow references (${idMapping.size} ID mappings)...`);
      
      // Get all current workflows (including newly imported ones)
      const currentWorkflows = await exportWorkflows();

      for (const workflow of currentWorkflows) {
        if (!workflow?.nodes || !Array.isArray(workflow.nodes)) continue;

        let updated = false;
        const updatedNodes = workflow.nodes.map((node: any) => {
          // Handle both Execute Workflow and Tool Workflow nodes
          const isWorkflowNode = 
            node?.type === "n8n-nodes-base.executeWorkflow" ||
            node?.type === "@n8n/n8n-nodes-langchain.toolWorkflow";
          
          if (!isWorkflowNode) {
            return node;
          }

          const params = node.parameters || {};
          const wfParam = params.workflowId;
          let oldRef: string | undefined;
          let newNode = node;

          if (wfParam && typeof wfParam === "object" && "value" in wfParam) {
            oldRef = wfParam.value as string;
            let newId: string | undefined;
            let matchingWorkflow: any = undefined;
            let needsUpdate = false;

            // Try direct ID mapping first (most reliable - from our import process)
            if (oldRef && idMapping.has(oldRef)) {
              newId = idMapping.get(oldRef)!;
              matchingWorkflow = currentWorkflows.find(w => w.id === newId);
              needsUpdate = true;
            } 
            // Fallback: Try name-based lookup (for cases where oldRef is a workflow name)
            else if (oldRef) {
              matchingWorkflow = currentWorkflows.find(w => {
                if (!w.name || !oldRef) return false;
                // Exact name match
                if (w.name === oldRef) return true;
                // Name without spaces/tags matches custom ID
                const nameNoSpaces = w.name.replace(/\s+/g, '').replace(/\[.*?\]/g, '');
                if (nameNoSpaces === oldRef || nameNoSpaces.toLowerCase() === oldRef.toLowerCase()) {
                  return true;
                }
                return false;
              });
              if (matchingWorkflow?.id) {
                newId = matchingWorkflow.id;
                // If value is already a name, we still need to update if cachedResultUrl has old ID
                if (matchingWorkflow.name === oldRef) {
                  // Check if cachedResultUrl needs updating
                  if (wfParam.cachedResultUrl && typeof wfParam.cachedResultUrl === "string") {
                    const urlMatch = wfParam.cachedResultUrl.match(/\/workflow\/([^\/]+)/);
                    if (urlMatch && urlMatch[1] && urlMatch[1] !== newId) {
                      needsUpdate = true;
                    }
                  }
                } else {
                  needsUpdate = true; // Value needs to be updated to match name
                }
              }
            }

            // Also check if cachedResultUrl has an old ID that needs updating
            if (!newId && wfParam.cachedResultUrl && typeof wfParam.cachedResultUrl === "string") {
              const urlMatch = wfParam.cachedResultUrl.match(/\/workflow\/([^\/]+)/);
              if (urlMatch && urlMatch[1]) {
                const oldIdFromUrl = urlMatch[1];
                if (idMapping.has(oldIdFromUrl)) {
                  newId = idMapping.get(oldIdFromUrl)!;
                  matchingWorkflow = currentWorkflows.find(w => w.id === newId);
                  needsUpdate = true;
                } else if (oldRef) {
                  // Try to find workflow by name if we have a name in value
                  matchingWorkflow = currentWorkflows.find(w => w.name === oldRef);
                  if (matchingWorkflow?.id) {
                    newId = matchingWorkflow.id;
                    needsUpdate = true;
                  }
                }
              }
            }

            if (newId && matchingWorkflow && needsUpdate) {
              // For mode "list", use workflow name; for mode "id", use database ID
              const currentMode = wfParam.mode || "id";
              const valueToUse = currentMode === "list" && matchingWorkflow.name 
                ? matchingWorkflow.name 
                : newId;
              const modeToUse = currentMode === "list" && matchingWorkflow.name 
                ? "list" 
                : "id";
              
              const newWorkflowId = { 
                ...wfParam, 
                value: valueToUse,
                mode: modeToUse
              };
              // Always update cached result to point to new ID
              newWorkflowId.cachedResultUrl = `/workflow/${newId}`;
              newWorkflowId.cachedResultName = matchingWorkflow.name;
              
              const newParams = { ...params, workflowId: newWorkflowId };
              newNode = { ...node, parameters: newParams };
              updated = true;
            }
          } else if (typeof wfParam === "string") {
            oldRef = wfParam;
            let newId: string | undefined;
            let matchingWorkflow: any = undefined;

            // Try direct ID mapping first (most reliable - from our import process)
            if (idMapping.has(oldRef)) {
              newId = idMapping.get(oldRef)!;
              matchingWorkflow = currentWorkflows.find(w => w.id === newId);
            } else if (oldRef) {
              // Fallback: Try name-based lookup (for cases where oldRef is a workflow name)
              matchingWorkflow = currentWorkflows.find(w => {
                if (!w.name || !oldRef) return false;
                // Exact name match
                if (w.name === oldRef) return true;
                // Name without spaces/tags matches custom ID
                const nameNoSpaces = w.name.replace(/\s+/g, '').replace(/\[.*?\]/g, '');
                if (nameNoSpaces === oldRef || nameNoSpaces.toLowerCase() === oldRef.toLowerCase()) {
                  return true;
                }
                return false;
              });
              if (matchingWorkflow?.id) {
                newId = matchingWorkflow.id;
              }
            }

            if (newId) {
              // For string params, default to "id" mode with database ID
              const newWorkflowId = { value: newId, mode: "id", __rl: true };
              const newParams = { ...params, workflowId: newWorkflowId };
              newNode = { ...node, parameters: newParams };
              updated = true;
            }
          }

          return newNode;
        });

        if (updated) {
          try {
            await importWorkflow({ ...workflow, nodes: updatedNodes } as any, undefined, false);
            logger.info(`✓ Updated workflow references in "${workflow.name || workflow.id}"`);
          } catch (err) {
            logger.warn(
              `Failed to update workflow references in "${workflow.name || workflow.id}"`,
              err instanceof Error ? err : undefined
            );
          }
        }
      }
    }
  } catch (err) {
    logger.warn("Failed to update workflow references after restore", err);
  }

  process.exit(0);
}

