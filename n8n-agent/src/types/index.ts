export type Command = "backup" | "restore" | "tree" | "organize" | "test" | "verify";

export interface ParsedArgs {
  command: Command;
  flags: string[];
}

export type WorkflowObject = {
  id?: string;
  name?: string;
  [key: string]: unknown;
};

export type WorkflowFile = {
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
  /**
   * True if this file was created in the most recent backup run, i.e. it is a
   * JSON file located directly under the backup root directory (not in a
   * nested/tag subdirectory).
   */
  fromCurrentRun: boolean;
};

export type BackupWorkflowForRestore = {
  filePath: string;
  workflow: WorkflowObject;
  id?: string;
  name: string;
};

export type ExportedWorkflow = {
  id?: string;
  name?: string;
  folderId?: string | null;
  [key: string]: unknown;
};

// Re-export n8n types
export type {
  N8nNode,
  ExecuteWorkflowTriggerNode,
  N8nWorkflow,
  N8nExecutionError,
  N8nExecutionJson,
  N8nFullExecutionJson,
  N8nRawOutputArray,
  N8nRawOutputObject,
} from './n8n';

export {
  isN8nExecutionJson,
  isN8nFullExecutionJson,
  isN8nRawOutputArray,
  isN8nRawOutputObject,
  isExecuteWorkflowTriggerNode,
} from './n8n';

