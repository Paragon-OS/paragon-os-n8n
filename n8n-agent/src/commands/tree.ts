import { exportWorkflows } from "../utils/n8n-api";
import { logger } from "../utils/logger";
import { getRunningPodConnection, buildApiConfigFromPod } from "../utils/pod-connection";
import type { ExportedWorkflow } from "../types/index";
import type { Workflow } from "../utils/n8n-api";

export async function executeTree(remainingArgs: string[] = []): Promise<void> {
  // Parse filtering options from remaining args
  let filterById: string | undefined;
  let filterActive: boolean | undefined;

  for (const arg of remainingArgs) {
    if (arg.startsWith("--id=")) {
      filterById = arg.substring(5);
    } else if (arg === "--active") {
      filterActive = true;
    } else if (arg === "--inactive") {
      filterActive = false;
    }
    // Note: --all flag is ignored (we always fetch all workflows via API)
  }

  // Connect to running pod
  logger.info("Connecting to n8n pod...");
  let apiConfig;
  try {
    const podConnection = await getRunningPodConnection();
    apiConfig = buildApiConfigFromPod(podConnection);
    logger.info(`Connected to pod: ${podConnection.podName}`);
  } catch (err) {
    logger.error("Failed to connect to n8n pod", err);
    process.exit(1);
    return;
  }

  let workflows: Workflow[];

  try {
    workflows = await exportWorkflows(apiConfig);
  } catch (err) {
    logger.error("Failed to export workflows from n8n API", err);
    process.exit(1);
    return;
  }

  if (workflows.length === 0) {
    logger.info("No workflows found in n8n instance.");
    process.exit(0);
    return;
  }

  // Apply filters
  let filteredWorkflows = workflows;
  
  if (filterById) {
    filteredWorkflows = filteredWorkflows.filter((wf) => 
      wf.id === filterById || wf.name?.includes(filterById)
    );
  }
  
  if (filterActive !== undefined) {
    filteredWorkflows = filteredWorkflows.filter((wf) => wf.active === filterActive);
  }

  if (filteredWorkflows.length === 0) {
    logger.info("No workflows match the specified filters.");
    process.exit(0);
    return;
  }

  // Map Workflow[] to ExportedWorkflow[] format
  const typedWorkflows: ExportedWorkflow[] = filteredWorkflows.map((wf) => ({
    id: wf.id,
    name: wf.name,
    folderId: (wf as { folderId?: string | null }).folderId ?? null,
  }));

  // Build folder-to-workflows map. We don't resolve folder names here because
  // the REST API does not include folder metadata by default; we treat
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

