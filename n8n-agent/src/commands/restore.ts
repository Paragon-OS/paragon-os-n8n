import fs from "fs";
import { resolveDir } from "../utils/args";
import { runN8nQuiet } from "../utils/n8n";
import { collectJsonFilesRecursive } from "../utils/file";
import { normalizeWorkflowForCompare } from "../utils/workflow";
import { deepEqual, exportCurrentWorkflowsForCompare } from "../utils/compare";
import type { BackupWorkflowForRestore, WorkflowObject } from "../types/index";

export async function executeRestore(flags: string[]): Promise<void> {
  const inputDir = resolveDir("--input", flags, "./workflows");

  const passthroughFlags = flags.filter(
    (f) => !["--input"].includes(f) && !["backup", "restore"].includes(f)
  );

  const jsonFiles = await collectJsonFilesRecursive(inputDir);

  if (jsonFiles.length === 0) {
    console.log(`No workflow JSON files found under "${inputDir}".`);
    process.exit(0);
  }

  let currentWorkflows: Map<string, WorkflowObject>;
  try {
    currentWorkflows = await exportCurrentWorkflowsForCompare();
  } catch (err) {
    console.error(String(err));
    process.exit(1);
    return;
  }

  const backups: BackupWorkflowForRestore[] = [];

  for (const filePath of jsonFiles) {
    let content: string;
    try {
      content = await fs.promises.readFile(filePath, "utf8");
    } catch (err) {
      console.warn(`Warning: Failed to read workflow file "${filePath}" during restore:`, err);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.warn(`Warning: Skipping non-JSON file "${filePath}" during restore:`, err);
      continue;
    }

    if (!parsed || typeof parsed !== "object") {
      console.warn(`Warning: Skipping unexpected workflow format in "${filePath}" during restore.`);
      continue;
    }

    const wf = parsed as WorkflowObject;
    const id = typeof wf.id === "string" ? wf.id : undefined;
    const name = typeof wf.name === "string" ? wf.name : "(unnamed workflow)";

    backups.push({ filePath, workflow: wf, id, name });
  }

  if (backups.length === 0) {
    console.log(`No valid workflow JSON files found under "${inputDir}" after parsing.`);
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

  console.log(
    [
      `Found ${backups.length} workflow JSON file(s) in backup.`,
      `Unchanged on server (skipped): ${unchangedCount}.`,
      `New or changed (to import): ${toImport.length} (including ${newCount} without existing live workflows).`,
    ].join(" ")
  );

  if (toImport.length === 0) {
    console.log("All workflows in the backup already match the current n8n instance. Nothing to restore.");
    process.exit(0);
  }

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
    console.log(
      `Importing workflow from "${backup.filePath}"` +
        (backup.id ? ` (id: ${backup.id}, name: ${backup.name})` : ` (name: ${backup.name})`)
    );
    const exitCode = await runN8nQuiet(args);

    if (exitCode !== 0) {
      console.error(`n8n import:workflow failed for "${backup.filePath}" with code`, exitCode);
      process.exit(exitCode);
    }
  }

  process.exit(0);
}

