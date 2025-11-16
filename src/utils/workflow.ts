import type { WorkflowObject } from "../types/index";

/**
 * Extract an optional leading [TAG] prefix from a workflow name.
 *
 * Examples:
 *   "[LAB] Demo workflow" -> { tag: "LAB", baseName: "Demo workflow" }
 *   "No tag here"         -> { tag: undefined, baseName: "No tag here" }
 */
export function parseTagFromName(name: string): { tag?: string; baseName: string } {
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

export function sanitizeWorkflowName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "unnamed-workflow";
  }

  // Replace characters that are typically unsafe in filenames on common filesystems.
  const unsafePattern = /[\/\\:\*\?"<>\|]/g;
  const sanitized = trimmed.replace(unsafePattern, "_");

  return sanitized || "unnamed-workflow";
}

/**
 * Return a copy of a workflow object with volatile metadata fields removed so
 * that we can compare backups to the current n8n instance in a stable way.
 *
 * We intentionally keep semantic fields like `active`, nodes, connections,
 * settings, etc. and only strip obviously time/version-related properties.
 */
export function normalizeWorkflowForCompare(input: WorkflowObject | undefined): unknown {
  if (!input || typeof input !== "object") {
    return input;
  }

  const volatileRootFields = new Set<string>([
    "updatedAt",
    "createdAt",
    "versionId",
    "meta",
  ]);

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (volatileRootFields.has(key)) {
      continue;
    }
    result[key] = value;
  }

  return result;
}

