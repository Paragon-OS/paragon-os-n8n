import { isEqual } from "lodash";
import type { WorkflowObject } from "../types/index";
import { exportWorkflows } from "./n8n-api";
import { logger } from "./logger";
import type { Workflow } from "./n8n-api";

/**
 * Deep equality comparison using lodash.isEqual
 * Re-exports lodash.isEqual for consistency with existing code
 */
export const deepEqual = isEqual;

export async function exportCurrentWorkflowsForCompare(): Promise<Map<string, WorkflowObject>> {
  let workflows: Workflow[];

  try {
    workflows = await exportWorkflows();
  } catch (err) {
    logger.error("Failed to export workflows from n8n API while preparing selective restore", err);
    throw new Error("Failed to export current workflows for comparison.");
  }

  if (workflows.length === 0) {
    // No workflows currently exist on the instance; treat all backup workflows as new.
    return new Map();
  }

  const map = new Map<string, WorkflowObject>();

  for (const wf of workflows) {
    if (!wf || typeof wf !== "object") continue;
    const id = typeof wf.id === "string" ? wf.id : undefined;
    if (!id) continue;
    
    // Convert Workflow to WorkflowObject format for compatibility
    // WorkflowObject is a superset of Workflow, so we can cast it directly
    const workflowObject: WorkflowObject = wf as unknown as WorkflowObject;
    
    map.set(id, workflowObject);
  }

  return map;
}

