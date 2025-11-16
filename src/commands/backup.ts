import path from "path";
import fs from "fs";
import { resolveDir } from "../utils/args";
import { runN8n } from "../utils/n8n";
import { collectJsonFilesRecursive, removeEmptyDirectoriesUnder } from "../utils/file";
import { parseTagFromName, sanitizeWorkflowName } from "../utils/workflow";
import type { WorkflowFile } from "../types/index";

async function renameExportedWorkflowsToNames(outputDir: string): Promise<void> {
  const normalizedOutputDir = path.resolve(outputDir);

  let jsonPaths: string[];
  try {
    jsonPaths = await collectJsonFilesRecursive(normalizedOutputDir);
  } catch (err) {
    console.warn(
      `Warning: Failed to collect workflow JSON files under "${normalizedOutputDir}":`,
      err
    );
    return;
  }

  if (jsonPaths.length === 0) {
    return;
  }

  const workflowFiles: WorkflowFile[] = [];

  for (const fullPath of jsonPaths) {
    const file = path.basename(fullPath);
    const parentDir = path.dirname(fullPath);
    const fromCurrentRun = path.resolve(parentDir) === normalizedOutputDir;

    let content: string;
    try {
      content = await fs.promises.readFile(fullPath, "utf8");
    } catch (err) {
      console.warn(`Warning: Failed to read workflow file "${fullPath}":`, err);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.warn(`Warning: Skipping non-JSON file "${fullPath}":`, err);
      continue;
    }

    if (!parsed || typeof parsed !== "object") {
      console.warn(`Warning: Skipping unexpected workflow format in "${fullPath}".`);
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
        console.warn(`Warning: Failed to remove archived workflow file "${fullPath}":`, err);
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
      console.warn(`Warning: Failed to ensure directory for "${targetFullPath}":`, err);
      continue;
    }

    // Prefer an existing file that already matches the target filename.
    let canonical = target.files.find((f) => f.fullPath === targetFullPath);
    if (!canonical) {
      // Prefer a file from the current backup run when choosing a canonical
      // representative for this workflow ID. This ensures that when a
      // workflow's [TAG] or name has changed, we keep the most recent export
      // (which lives at the root of the backup directory) and treat older
      // copies under previous tag subdirectories as duplicates to delete.
      const fromCurrentRunCandidates = target.files.filter((f) => f.fromCurrentRun);

      if (fromCurrentRunCandidates.length > 0) {
        // Use a stable order when multiple current-run candidates exist.
        canonical = fromCurrentRunCandidates.sort((a, b) =>
          a.fullPath.localeCompare(b.fullPath)
        )[0];
      } else {
        // Fall back to a stable deterministic selection among all files.
        canonical = [...target.files].sort((a, b) => a.fullPath.localeCompare(b.fullPath))[0];
      }
    }

    // Delete all non-canonical files for this workflow ID.
    for (const wfFile of target.files) {
      if (wfFile.fullPath === canonical.fullPath) {
        continue;
      }

      try {
        await fs.promises.unlink(wfFile.fullPath);
      } catch (err) {
        console.warn(
          `Warning: Failed to remove duplicate workflow file "${wfFile.fullPath}" for workflow ID "${target.id}":`,
          err
        );
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
        console.warn(
          `Warning: Failed to rename workflow file "${canonical.fullPath}" to "${targetFullPath}":`,
          err
        );
      }
    }
  }

  // After renaming/deleting files, remove any now-empty directories beneath the
  // backup root (excluding the root itself).
  try {
    await removeEmptyDirectoriesUnder(normalizedOutputDir);
  } catch (err) {
    console.warn(
      `Warning: Failed to remove empty directories under "${normalizedOutputDir}":`,
      err
    );
  }
}

export async function executeBackup(flags: string[]): Promise<void> {
  const outputDir = resolveDir("--output", flags, "./workflows");

  // Mirrors: n8n export:workflow --backup --output=./workflows/
  const args = ["export:workflow", "--backup", `--output=${outputDir}`];

  // Allow extra flags like --all to be forwarded.
  const passthroughFlags = flags.filter(
    (f) => !["--output"].includes(f) && !["backup", "restore"].includes(f)
  );

  const exitCode = await runN8n([...args, ...passthroughFlags]);

  if (exitCode === 0) {
    // If export succeeded, rename exported files to use workflow names while
    // keeping restore/import behavior based solely on workflow IDs inside JSON.
    await renameExportedWorkflowsToNames(outputDir);
  }

  process.exit(exitCode);
}

