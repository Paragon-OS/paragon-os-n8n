import { runN8nCapture } from "../utils/n8n";
import type { ExportedWorkflow } from "../types/index";

export async function executeTree(remainingArgs: string[] = []): Promise<void> {
  // We intentionally do NOT set stdio: "inherit" here so we can parse JSON.
  // If the user does not pass any explicit selection flags, default to --all.
  const hasSelectionFlag = remainingArgs.some((f) =>
    ["--all", "--id", "--active", "--inactive"].some((sel) => f === sel || f.startsWith(`${sel}=`))
  );

  const baseArgs = ["export:workflow", "--pretty"];
  const selectionArgs = hasSelectionFlag ? [] : ["--all"];

  const { code, stdout, stderr } = await runN8nCapture([...baseArgs, ...selectionArgs, ...remainingArgs]);

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

