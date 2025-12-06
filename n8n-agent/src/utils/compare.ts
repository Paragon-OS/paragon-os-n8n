import { isEqual } from "lodash";
import type { WorkflowObject } from "../types/index";
import { runN8nCapture } from "./n8n";

/**
 * Deep equality comparison using lodash.isEqual
 * Re-exports lodash.isEqual for consistency with existing code
 */
export const deepEqual = isEqual;

export async function exportCurrentWorkflowsForCompare(): Promise<Map<string, WorkflowObject>> {
  const { code, stdout, stderr } = await runN8nCapture(["export:workflow", "--pretty", "--all"]);

  if (code !== 0) {
    console.error("n8n export:workflow failed while preparing selective restore with code", code);
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
    throw new Error("Failed to export current workflows for comparison.");
  }

  if (!stdout.trim()) {
    // No workflows currently exist on the instance; treat all backup workflows as new.
    return new Map();
  }

  let workflows: unknown;

  try {
    workflows = JSON.parse(stdout);
  } catch (err) {
    console.error("Failed to parse JSON from n8n export:workflow during selective restore:", err);
    throw new Error("Failed to parse current workflows for comparison.");
  }

  if (!Array.isArray(workflows)) {
    console.error("Unexpected export format from n8n during selective restore: expected an array of workflows.");
    throw new Error("Unexpected export format from n8n during selective restore.");
  }

  const map = new Map<string, WorkflowObject>();

  for (const wf of workflows as WorkflowObject[]) {
    if (!wf || typeof wf !== "object") continue;
    const id = typeof wf.id === "string" ? wf.id : undefined;
    if (!id) continue;
    map.set(id, wf);
  }

  return map;
}

