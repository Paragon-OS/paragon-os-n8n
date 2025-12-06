import path from "path";
import fs from "fs";
import { resolveDir, getPassthroughArgs, confirm } from "../cli";
import { runN8n } from "../utils/n8n";
import { collectJsonFilesRecursive, removeEmptyDirectoriesUnder } from "../utils/file";
import { parseTagFromName, sanitizeWorkflowName } from "../utils/workflow";
import { logger } from "../utils/logger";
import type { WorkflowFile } from "../types/index";

interface BackupOptions {
  output?: string;
  yes?: boolean;
}

async function renameExportedWorkflowsToNames(
  outputDir: string,
  tempDir?: string
): Promise<void> {
  const normalizedOutputDir = path.resolve(outputDir);

  let jsonPaths: string[];
  try {
    jsonPaths = await collectJsonFilesRecursive(normalizedOutputDir);
    
    // If there's a temp directory with old files, include those too
    if (tempDir) {
      const tempPaths = await collectJsonFilesRecursive(tempDir);
      jsonPaths.push(...tempPaths);
    }
  } catch (err) {
    logger.warn("Failed to collect workflow JSON files", { outputDir: normalizedOutputDir }, err);
    return;
  }

  if (jsonPaths.length === 0) {
    return;
  }

  const workflowFiles: WorkflowFile[] = [];

  for (const fullPath of jsonPaths) {
    const file = path.basename(fullPath);
    const parentDir = path.dirname(fullPath);
    // Files from the current run are those in the root output directory.
    // Files in the temp directory are from previous backups and should not be
    // considered as from the current run.
    const isInTempDir = tempDir && fullPath.startsWith(path.resolve(tempDir) + path.sep);
    const fromCurrentRun = !isInTempDir && path.resolve(parentDir) === normalizedOutputDir;

    let content: string;
    try {
      content = await fs.promises.readFile(fullPath, "utf8");
    } catch (err) {
      logger.warn("Failed to read workflow file", { filePath: fullPath }, err);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      logger.warn("Skipping non-JSON file", { filePath: fullPath }, err);
      continue;
    }

    if (!parsed || typeof parsed !== "object") {
      logger.warn("Skipping unexpected workflow format", { filePath: fullPath });
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
        await fs.promises.unlink(fullPath);
      } catch (err) {
        logger.warn("Failed to remove archived workflow file", { filePath: fullPath }, err);
      }
      continue;
    }

    const id = typeof wf.id === "string" ? wf.id : undefined;
    const rawName = typeof wf.name === "string" ? wf.name : "unnamed-workflow";

    const { tag, baseName: taglessName } = parseTagFromName(rawName);
    const baseName = sanitizeWorkflowName(taglessName || rawName);
    const fileBaseName = sanitizeWorkflowName(rawName);

    workflowFiles.push({
      file,
      fullPath,
      id,
      name: rawName,
      baseName,
      fileBaseName,
      tag,
      fromCurrentRun,
    });
  }

  // Group files by workflow ID so we end up with exactly one file per workflow ID.
  const filesById = new Map<
    string,
    {
      baseName: string;
      files: WorkflowFile[];
    }
  >();

  for (const wfFile of workflowFiles) {
    if (!wfFile.id) {
      // If a workflow file has no ID, leave it as-is.
      continue;
    }

    const existing = filesById.get(wfFile.id);
    if (!existing) {
      filesById.set(wfFile.id, { baseName: wfFile.baseName, files: [wfFile] });
    } else {
      existing.files.push(wfFile);
    }
  }

  // Assign stable, unique filenames based on sanitized names and numeric suffixes.
  const usedNames = new Map<string, number>();
  type Target = {
    id: string;
    baseName: string;
    targetFilename: string;
    files: WorkflowFile[];
  };

  const targets: Target[] = [];

  const sortedIds = Array.from(filesById.entries()).sort(([idA, a], [idB, b]) => {
    const nameCompare = a.baseName.localeCompare(b.baseName);
    if (nameCompare !== 0) return nameCompare;
    return idA.localeCompare(idB);
  });

  for (const [id, group] of sortedIds) {
    const baseName = group.baseName;

    // Use the tag and fileBaseName of the first file in the group as the
    // canonical source for the target directory and filename.
    const sample = group.files[0];
    const tag = sample.tag;
    const fileBaseName = sample.fileBaseName || baseName || "unnamed-workflow";

    const usedKey = `${tag ?? ""}/${fileBaseName}`;
    const existingCount = usedNames.get(usedKey) ?? 0;
    const nextCount = existingCount + 1;
    usedNames.set(usedKey, nextCount);

    const finalBase = nextCount === 1 ? fileBaseName : `${fileBaseName} (${nextCount})`;
    const targetFilename = `${finalBase}.json`;

    targets.push({
      id,
      baseName,
      targetFilename,
      files: group.files,
    });
  }

  // For each workflow ID:
  // - Pick one canonical file to keep (prefer a file that already has the target filename).
  // - Delete any other files for the same ID.
  // - Rename the canonical file to the target filename if needed.
  for (const target of targets) {
    const sample = target.files[0];
    const tag = sample.tag;
    const targetDir = tag ? path.join(normalizedOutputDir, tag) : normalizedOutputDir;
    const targetFullPath = path.join(targetDir, target.targetFilename);

    try {
      await fs.promises.mkdir(path.dirname(targetFullPath), { recursive: true });
    } catch (err) {
      logger.warn("Failed to ensure directory", { targetPath: targetFullPath }, err);
      continue;
    }

    // Always prefer a file from the current backup run when choosing a canonical
    // representative for this workflow ID. This ensures that when a workflow's
    // [TAG] or name has changed, we keep the most recent export (which lives at
    // the root of the backup directory) and treat older copies under previous
    // tag subdirectories as duplicates to delete. This also ensures that the
    // backup always overwrites existing files with fresh exports from n8n.
    const fromCurrentRunCandidates = target.files.filter((f) => f.fromCurrentRun);

    let canonical: WorkflowFile;
    if (fromCurrentRunCandidates.length > 0) {
      // Use a stable order when multiple current-run candidates exist.
      canonical = fromCurrentRunCandidates.sort((a, b) =>
        a.fullPath.localeCompare(b.fullPath)
      )[0];
    } else {
      // Fall back to a stable deterministic selection among all files.
      // This case only happens when no files were exported in the current run
      // (e.g., when the workflow already exists and n8n skipped it).
      canonical = [...target.files].sort((a, b) => a.fullPath.localeCompare(b.fullPath))[0];
    }

    // Delete all non-canonical files for this workflow ID.
    for (const wfFile of target.files) {
      if (wfFile.fullPath === canonical.fullPath) {
        continue;
      }

      try {
        // Check if file still exists before trying to delete it (it may have
        // already been moved/renamed by a previous operation)
        try {
          await fs.promises.access(wfFile.fullPath);
        } catch {
          // File doesn't exist, skip it
          continue;
        }
        
        await fs.promises.unlink(wfFile.fullPath);
      } catch (err) {
        logger.warn("Failed to remove duplicate workflow file", {
          filePath: wfFile.fullPath,
          workflowId: target.id
        }, err);
      }
    }

    // Rename canonical file if needed.
    if (canonical.fullPath !== targetFullPath) {
      try {
        // If a different file somehow already exists at the target path, remove it.
        try {
          const stat = await fs.promises.stat(targetFullPath);
          if (stat.isFile()) {
            await fs.promises.unlink(targetFullPath);
          }
        } catch {
          // Does not exist; nothing to remove.
        }

        await fs.promises.rename(canonical.fullPath, targetFullPath);
      } catch (err) {
        logger.warn("Failed to rename workflow file", {
          from: canonical.fullPath,
          to: targetFullPath
        }, err);
      }
    }
  }

  // After renaming/deleting files, remove any now-empty directories beneath the
  // backup root (excluding the root itself).
  try {
    await removeEmptyDirectoriesUnder(normalizedOutputDir);
  } catch (err) {
    logger.warn("Failed to remove empty directories", { outputDir: normalizedOutputDir }, err);
  }
}

export async function executeBackup(options: BackupOptions, remainingArgs: string[] = []): Promise<void> {
  const outputDir = resolveDir(options.output, "./workflows");
  const normalizedOutputDir = path.resolve(outputDir);

  // Show what will be backed up and ask for confirmation
  logger.info(`📦 Backup target: ${normalizedOutputDir}`);
  logger.info(`   This will export all workflows from n8n to the backup directory.\n`);

  const confirmed = await confirm("Do you want to proceed with the backup?", options.yes || false);
  if (!confirmed) {
    logger.info("Backup cancelled.");
    process.exit(0);
  }

  logger.info(""); // Empty line after confirmation

  // n8n's export command does not overwrite existing files - it skips them.
  // To ensure we always get fresh exports, temporarily move existing workflow
  // files to a staging area, run the export, then let our renaming logic merge
  // the new exports with any existing files.
  const tempDir = path.join(normalizedOutputDir, ".backup-temp");
  let movedFiles = false;

  try {
    // Collect existing JSON files before export
    const existingJsonPaths = await collectJsonFilesRecursive(normalizedOutputDir);
    
    if (existingJsonPaths.length > 0) {
      // Create temp directory and move existing files there
      await fs.promises.mkdir(tempDir, { recursive: true });
      
      for (const filePath of existingJsonPaths) {
        const relativePath = path.relative(normalizedOutputDir, filePath);
        const tempPath = path.join(tempDir, relativePath);
        
        await fs.promises.mkdir(path.dirname(tempPath), { recursive: true });
        await fs.promises.rename(filePath, tempPath);
      }
      
      movedFiles = true;
    }
  } catch (err) {
    logger.warn("Failed to move existing workflow files to temp directory", { tempDir }, err);
    // Continue anyway - worst case n8n will skip existing files
  }

  // Mirrors: n8n export:workflow --backup --output=./workflows/
  const args = ["export:workflow", "--backup", `--output=${outputDir}`];

  // Allow extra flags like --all to be forwarded to n8n
  const passthroughFlags = getPassthroughArgs(remainingArgs, ["--output"]);

  const exitCode = await runN8n([...args, ...passthroughFlags]);

  if (exitCode === 0) {
    // If export succeeded, rename exported files to use workflow names while
    // keeping restore/import behavior based solely on workflow IDs inside JSON.
    // Pass the temp directory so the renaming logic can process both old and
    // new files together, with new files taking precedence.
    await renameExportedWorkflowsToNames(outputDir, movedFiles ? tempDir : undefined);
    
    // Clean up temp directory after renaming logic has processed everything
    if (movedFiles) {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (err) {
        logger.warn("Failed to clean up temporary directory", { tempDir }, err);
      }
    }
  } else {
    // If export failed, restore files from temp directory
    if (movedFiles) {
      try {
        const tempJsonPaths = await collectJsonFilesRecursive(tempDir);
        
        for (const tempPath of tempJsonPaths) {
          const relativePath = path.relative(tempDir, tempPath);
          const originalPath = path.join(normalizedOutputDir, relativePath);
          
          await fs.promises.mkdir(path.dirname(originalPath), { recursive: true });
          await fs.promises.rename(tempPath, originalPath);
        }
        
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (err) {
        logger.error("Failed to restore files after export failure", err, { tempDir });
      }
    }
  }

  process.exit(exitCode);
}

