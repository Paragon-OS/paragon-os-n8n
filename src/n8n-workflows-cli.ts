import { spawn } from "child_process";
import path from "path";
import fs from "fs";

type Command = "backup" | "restore" | "tree" | "organize";

interface ParsedArgs {
  command: Command;
  flags: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const [, , commandArg, ...rest] = argv;

  if (
    commandArg !== "backup" &&
    commandArg !== "restore" &&
    commandArg !== "tree" &&
    commandArg !== "organize"
  ) {
    printUsage();
    process.exit(1);
  }

  return {
    command: commandArg,
    flags: rest,
  };
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  ts-node src/n8n-workflows-cli.ts backup [--output <dir>] [--all]",
      "  ts-node src/n8n-workflows-cli.ts restore [--input <dir>]",
      "  ts-node src/n8n-workflows-cli.ts organize [--input <dir>]",
      "  ts-node src/n8n-workflows-cli.ts tree [--all] [extra n8n flags]",
      "",
      "Examples:",
      "  Backup all workflows (pretty, separate files) into ./workflows (excluding archived workflows):",
      "    ts-node src/n8n-workflows-cli.ts backup",
      "  Backup to a custom directory:",
      "    ts-node src/n8n-workflows-cli.ts backup --output ./backups/latest",
      "  Restore from ./workflows:",
      "    ts-node src/n8n-workflows-cli.ts restore",
      "  Restore from a custom directory:",
      "    ts-node src/n8n-workflows-cli.ts restore --input ./backups/latest",
      "",
      "  Organize workflows in ./workflows/ into tag-based subdirectories based on filenames:",
      "    ts-node src/n8n-workflows-cli.ts organize",
      "  Organize a different directory:",
      "    ts-node src/n8n-workflows-cli.ts organize --input ./backups/latest",
      "",
      "  Print logical n8n workflow folders and workflows (uses local n8n CLI):",
      "    ts-node src/n8n-workflows-cli.ts tree --all",
      "    ts-node src/n8n-workflows-cli.ts tree --all --active",
    ].join("\n")
  );
}

function resolveDir(flagName: "--output" | "--input", argv: string[], fallback: string): string {
  const index = argv.indexOf(flagName);

  if (index !== -1 && argv[index + 1]) {
    return path.resolve(argv[index + 1]);
  }

  return path.resolve(fallback);
}

/**
 * Extract an optional leading [TAG] prefix from a workflow name.
 *
 * Examples:
 *   "[LAB] Demo workflow" -> { tag: "LAB", baseName: "Demo workflow" }
 *   "No tag here"         -> { tag: undefined, baseName: "No tag here" }
 */
function parseTagFromName(name: string): { tag?: string; baseName: string } {
  const trimmed = name.trim();
  if (!trimmed) {
    return { baseName: "" };
  }

  const tagMatch = /^\[(?<tag>[^\]]+)\]\s*(.*)$/.exec(trimmed);
  if (!tagMatch) {
    return { baseName: trimmed };
  }

  const groups = tagMatch.groups as { tag?: string } | undefined;
  const tag = groups?.tag?.trim() || undefined;
  const baseName = (tagMatch[2] ?? "").trim();

  return {
    tag,
    baseName: baseName || trimmed,
  };
}

function runN8n(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("n8n", args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

function sanitizeWorkflowName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "unnamed-workflow";
  }

  // Replace characters that are typically unsafe in filenames on common filesystems.
  const unsafePattern = /[\/\\:\*\?"<>\|]/g;
  const sanitized = trimmed.replace(unsafePattern, "_");

  return sanitized || "unnamed-workflow";
}

async function renameExportedWorkflowsToNames(outputDir: string): Promise<void> {
  let entries: string[];

  try {
    entries = await fs.promises.readdir(outputDir);
  } catch (err) {
    console.warn(`Warning: Failed to read export directory "${outputDir}":`, err);
    return;
  }

  const jsonFiles = entries.filter((file) => file.toLowerCase().endsWith(".json"));

  type WorkflowFile = {
    file: string;
    fullPath: string;
    id: string | undefined;
    name: string;
    /**
     * Workflow name with any leading [TAG] removed and sanitized for filesystem use.
     */
    baseName: string;
    /**
     * Sanitized full workflow name (including tag if present), used for filenames.
     */
    fileBaseName: string;
    /**
     * Optional tag extracted from the workflow name.
     */
    tag?: string;
  };

  const workflowFiles: WorkflowFile[] = [];

  for (const file of jsonFiles) {
    const fullPath = path.join(outputDir, file);

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
    const targetDir = tag ? path.join(outputDir, tag) : outputDir;
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
      canonical = target.files[0];
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
}

function runN8nCapture(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("n8n", args, {
      stdio: ["inherit", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function collectJsonFilesRecursive(dir: string): Promise<string[]> {
  let entries: fs.Dirent[];

  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`Warning: Failed to read directory "${dir}":`, err);
    return [];
  }

  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectJsonFilesRecursive(fullPath);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      results.push(fullPath);
    }
  }

  return results;
}

async function main() {
  const { command, flags } = parseArgs(process.argv);

  if (command === "backup") {
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

  if (command === "restore") {
    const inputDir = resolveDir("--input", flags, "./workflows");

    const passthroughFlags = flags.filter(
      (f) => !["--input"].includes(f) && !["backup", "restore"].includes(f)
    );

    const jsonFiles = await collectJsonFilesRecursive(inputDir);

    if (jsonFiles.length === 0) {
      console.log(`No workflow JSON files found under "${inputDir}".`);
      process.exit(0);
    }

    for (const filePath of jsonFiles) {
      const args = ["import:workflow", "--separate", `--input=${filePath}`, ...passthroughFlags];
      const exitCode = await runN8n(args);

      if (exitCode !== 0) {
        console.error(`n8n import:workflow failed for "${filePath}" with code`, exitCode);
        process.exit(exitCode);
      }
    }

    process.exit(0);
  }

  if (command === "organize") {
    const inputDir = resolveDir("--input", flags, "./workflows");
    await organizeWorkflows(inputDir);
    process.exit(0);
  }

  if (command === "tree") {
    // We intentionally do NOT set stdio: "inherit" here so we can parse JSON.
    // If the user does not pass any explicit selection flags, default to --all.
    const hasSelectionFlag = flags.some((f) =>
      ["--all", "--id", "--active", "--inactive"].some((sel) => f === sel || f.startsWith(`${sel}=`))
    );

    const passthroughFlags = flags.filter((f) => !["backup", "restore", "tree"].includes(f));

    const baseArgs = ["export:workflow", "--pretty"];
    const selectionArgs = hasSelectionFlag ? [] : ["--all"];

    const { code, stdout, stderr } = await runN8nCapture([...baseArgs, ...selectionArgs, ...passthroughFlags]);

    if (code !== 0) {
      console.error("n8n export:workflow failed with code", code);
      if (stderr.trim()) {
        console.error(stderr.trim());
      }
      process.exit(code);
    }

    if (!stdout.trim()) {
      console.log("No workflows returned by n8n export:workflow.");
      process.exit(0);
    }

    let workflows: unknown;

    try {
      workflows = JSON.parse(stdout);
    } catch (err) {
      console.error("Failed to parse JSON from n8n export:workflow:", err);
      process.exit(1);
    }

    if (!Array.isArray(workflows)) {
      console.error("Unexpected export format from n8n: expected an array of workflows.");
      process.exit(1);
    }

    type ExportedWorkflow = {
      id?: string;
      name?: string;
      folderId?: string | null;
      // Allow additional fields without typing them strictly.
      [key: string]: unknown;
    };

    const typedWorkflows: ExportedWorkflow[] = workflows as ExportedWorkflow[];

    // Build folder-to-workflows map. We don't resolve folder names here because
    // n8n export:workflow does not include folder metadata by default; we treat
    // each distinct folderId as a logical folder key and group workflows by it.
    const folderMap = new Map<string, ExportedWorkflow[]>();
    const uncategorized: ExportedWorkflow[] = [];

    for (const wf of typedWorkflows) {
      const folderId = wf.folderId;
      if (!folderId) {
        uncategorized.push(wf);
        continue;
      }

      if (!folderMap.has(folderId)) {
        folderMap.set(folderId, []);
      }
      folderMap.get(folderId)!.push(wf);
    }

    // Sort folder IDs and workflow names for stable output.
    const sortedFolderIds = Array.from(folderMap.keys()).sort((a, b) => a.localeCompare(b));

    const sortWorkflowsByName = (a: ExportedWorkflow, b: ExportedWorkflow) => {
      const nameA = a.name ?? "";
      const nameB = b.name ?? "";
      return nameA.localeCompare(nameB);
    };

    console.log("n8n workflow folder structure (by folderId):");
    console.log("");

    // Print folders with a simple tree-like structure.
    sortedFolderIds.forEach((folderId, idx) => {
      const isLastFolder = idx === sortedFolderIds.length - 1 && uncategorized.length === 0;
      const workflowsInFolder = folderMap.get(folderId) ?? [];
      workflowsInFolder.sort(sortWorkflowsByName);

      console.log(`${isLastFolder ? "└" : "├"}─ Folder ${folderId}/`);

      workflowsInFolder.forEach((wf, wfIdx) => {
        const isLastWorkflow = wfIdx === workflowsInFolder.length - 1;
        const prefix = isLastWorkflow ? "   └─" : "   ├─";
        console.log(`${prefix} ${wf.name ?? "(unnamed workflow)"}`);
      });

      if (!isLastFolder) {
        console.log("");
      }
    });

    if (uncategorized.length > 0) {
      uncategorized.sort(sortWorkflowsByName);

      if (sortedFolderIds.length > 0) {
        console.log("");
      }

      console.log(`${sortedFolderIds.length > 0 ? "└" : "├"}─ Uncategorized/`);
      uncategorized.forEach((wf, wfIdx) => {
        const isLastWorkflow = wfIdx === uncategorized.length - 1;
        const prefix = isLastWorkflow ? "   └─" : "   ├─";
        console.log(`${prefix} ${wf.name ?? "(unnamed workflow)"}`);
      });
    }

    process.exit(0);
  }
}

async function organizeWorkflows(baseDir: string): Promise<void> {
  let entries: string[];

  try {
    entries = await fs.promises.readdir(baseDir);
  } catch (err) {
    console.error(`Failed to read workflows directory "${baseDir}":`, err);
    process.exit(1);
  }

  const jsonFiles = entries.filter((file) => file.toLowerCase().endsWith(".json"));

  for (const file of jsonFiles) {
    const fullPath = path.join(baseDir, file);
    const nameWithoutExt = file.replace(/\.json$/i, "");
    const { tag } = parseTagFromName(nameWithoutExt);

    if (!tag) {
      continue;
    }

    const targetDir = path.join(baseDir, tag);

    try {
      await fs.promises.mkdir(targetDir, { recursive: true });
    } catch (err) {
      console.warn(`Warning: Failed to create directory "${targetDir}":`, err);
      continue;
    }

    const targetPath = path.join(targetDir, file);

    if (targetPath === fullPath) {
      continue;
    }

    try {
      // If a file already exists at the target path, skip to avoid overwriting.
      const existingStat = await fs.promises
        .stat(targetPath)
        .catch(() => undefined as unknown as fs.Stats | undefined);

      if (existingStat && existingStat.isFile()) {
        console.warn(
          `Warning: Skipping move of "${fullPath}" to "${targetPath}" because the target file already exists.`
        );
        continue;
      }
    } catch {
      // Ignore stat errors; we'll attempt to move below.
    }

    try {
      await fs.promises.rename(fullPath, targetPath);
      console.log(`Moved "${fullPath}" -> "${targetPath}"`);
    } catch (err) {
      console.warn(`Warning: Failed to move "${fullPath}" to "${targetPath}":`, err);
    }
  }
}

main().catch((err) => {
  console.error("Error running n8n workflows CLI:", err);
  process.exit(1);
});


