import { spawn } from "child_process";
import path from "path";
import fs from "fs";

type Command = "backup" | "restore" | "tree";

interface ParsedArgs {
  command: Command;
  flags: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const [, , commandArg, ...rest] = argv;

  if (commandArg !== "backup" && commandArg !== "restore" && commandArg !== "tree") {
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
      "  ts-node src/n8n-workflows-cli.ts tree [--all] [extra n8n flags]",
      "",
      "Examples:",
      "  Backup all workflows (pretty, separate files) into ./workflows:",
      "    ts-node src/n8n-workflows-cli.ts backup",
      "  Backup to a custom directory:",
      "    ts-node src/n8n-workflows-cli.ts backup --output ./backups/latest",
      "  Restore from ./workflows:",
      "    ts-node src/n8n-workflows-cli.ts restore",
      "  Restore from a custom directory:",
      "    ts-node src/n8n-workflows-cli.ts restore --input ./backups/latest",
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

  const usedNames = new Map<string, number>();

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

    const wf: { id?: unknown; name?: unknown } = parsed as {
      id?: unknown;
      name?: unknown;
    };
    const rawId = typeof wf.id === "string" ? wf.id : undefined;
    const rawName = typeof wf.name === "string" ? wf.name : "unnamed-workflow";
    const baseName = sanitizeWorkflowName(rawName);

    const existingCount = usedNames.get(baseName) ?? 0;
    const nextCount = existingCount + 1;
    usedNames.set(baseName, nextCount);

    const finalBase =
      nextCount === 1 ? baseName : `${baseName} (${nextCount})`;

    const newFilename = `${finalBase}.json`;
    const newFullPath = path.join(outputDir, newFilename);

    if (newFullPath === fullPath) {
      // Already has the desired name.
      continue;
    }

    // If a file with the target name already exists (e.g., from a previous run),
    // skip renaming this one to avoid overwriting data.
    try {
      await fs.promises.access(newFullPath, fs.constants.F_OK);

      // If a file with the target name already exists, replace it only when the
      // workflow ID matches; otherwise, keep the existing file and skip this one.
      try {
        const existingContent = await fs.promises.readFile(newFullPath, "utf8");
        const existingParsed = JSON.parse(existingContent) as { id?: unknown };
        const existingId =
          existingParsed && typeof existingParsed.id === "string"
            ? existingParsed.id
            : undefined;

        if (rawId && existingId && rawId === existingId) {
          // Same workflow ID – replace the old file with the newly exported one.
          await fs.promises.unlink(newFullPath);
        } else {
          console.warn(
            `Warning: Target filename "${newFullPath}" already exists with a different workflow. Skipping rename of "${fullPath}".`
          );
          continue;
        }
      } catch (err) {
        console.warn(
          `Warning: Target filename "${newFullPath}" already exists but could not be inspected. Skipping rename of "${fullPath}".`,
          err
        );
        continue;
      }
    } catch {
      // File does not exist, safe to rename.
    }

    try {
      await fs.promises.rename(fullPath, newFullPath);
    } catch (err) {
      console.warn(
        `Warning: Failed to rename workflow file "${fullPath}" to "${newFullPath}":`,
        err
      );
      continue;
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

    // For directory-based restore we use --separate.
    // Equivalent to: n8n import:workflow --separate --input=./workflows/
    // Note: import relies on the workflow `id` inside each JSON, so filenames
    // can safely be human-friendly (e.g. `<Workflow Name>.json`).
    const args = ["import:workflow", "--separate", `--input=${inputDir}`];

    const passthroughFlags = flags.filter(
      (f) => !["--input"].includes(f) && !["backup", "restore"].includes(f)
    );

    const exitCode = await runN8n([...args, ...passthroughFlags]);
    process.exit(exitCode);
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

main().catch((err) => {
  console.error("Error running n8n workflows CLI:", err);
  process.exit(1);
});


