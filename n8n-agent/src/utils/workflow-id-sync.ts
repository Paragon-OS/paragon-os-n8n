/**
 * Workflow Reference Synchronization Utility
 * 
 * Syncs toolWorkflow node references to use name-based references instead of ID-based.
 * This makes references stable across imports/exports since names don't change but IDs do.
 * Also updates cachedResultUrl to match current n8n workflow IDs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import type { Workflow } from './n8n-api';

interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  parameters?: {
    workflowId?: {
      __rl?: boolean;
      value?: string;
      mode?: string;
      cachedResultUrl?: string;
      cachedResultName?: string;
    };
  };
}

interface LocalWorkflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
}

interface SyncResult {
  fixed: number;
  notFound: number;
  details: Array<{
    workflowName: string;
    nodeName: string;
    targetName: string;
    oldId: string;
    newId: string;
  }>;
}

/**
 * Get all workflow JSON files recursively from a directory
 */
function getAllWorkflowFiles(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      getAllWorkflowFiles(filePath, fileList);
    } else if (file.endsWith('.json')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

/**
 * Sync toolWorkflow references in local files to use name-based references
 * 
 * Converts ID-based references to name-based references (stable across imports).
 * Also updates cachedResultUrl to match current n8n workflow IDs.
 * 
 * @param workflowsDir - Directory containing local workflow JSON files
 * @param n8nWorkflows - Array of workflows from n8n API
 * @param silent - If true, suppress log output
 * @returns Object with count of fixed and not found references
 */
export async function syncWorkflowReferences(
  workflowsDir: string,
  n8nWorkflows: Workflow[],
  silent: boolean = false
): Promise<SyncResult> {
  // Build name -> ID map from n8n workflows
  const n8nNameToId = new Map<string, string>();
  n8nWorkflows.forEach(wf => {
    n8nNameToId.set(wf.name, wf.id);
  });

  const workflowFiles = getAllWorkflowFiles(workflowsDir);
  const result: SyncResult = {
    fixed: 0,
    notFound: 0,
    details: []
  };

  for (const filePath of workflowFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const workflow: LocalWorkflow = JSON.parse(content);
      let modified = false;

      for (const node of workflow.nodes) {
        if (node.type === '@n8n/n8n-nodes-langchain.toolWorkflow') {
          const workflowId = node.parameters?.workflowId;

          if (workflowId?.value && workflowId?.cachedResultName) {
            const referencedName = workflowId.cachedResultName;
            const currentId = workflowId.value;
            const n8nId = n8nNameToId.get(referencedName);

            if (n8nId) {
              // Check if we need to update: either ID changed OR value is not the name
              const needsUpdate = currentId !== n8nId || currentId !== referencedName;
              
              if (needsUpdate) {
                if (!silent) {
                  logger.debug('Syncing workflow reference to name-based', {
                    workflow: workflow.name,
                    node: node.name,
                    target: referencedName,
                    oldValue: currentId,
                    newValue: referencedName,
                    n8nId: n8nId
                  });
                }

                result.details.push({
                  workflowName: workflow.name,
                  nodeName: node.name,
                  targetName: referencedName,
                  oldId: currentId,
                  newId: n8nId
                });

                // Use name-based reference (stable across imports/exports)
                workflowId.value = referencedName;
                workflowId.mode = 'list';
                workflowId.cachedResultUrl = `/workflow/${n8nId}`;
                modified = true;
                result.fixed++;
              }
            } else {
              if (!silent) {
                logger.warn('Referenced workflow not found in n8n', {
                  workflow: workflow.name,
                  node: node.name,
                  target: referencedName,
                  currentId
                });
              }
              result.notFound++;
            }
          }
        }
      }

      if (modified) {
        fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2) + '\n', 'utf-8');
      }
    } catch (error) {
      logger.error('Error processing workflow file during sync', { filePath }, error);
    }
  }

  return result;
}

/**
 * Remove duplicate workflow files created by backup (files ending with " (2).json")
 * 
 * @param workflowsDir - Directory containing workflow JSON files
 * @returns Number of duplicate files removed
 */
export function removeDuplicateWorkflowFiles(workflowsDir: string): number {
  const duplicatePattern = / \(\d+\)\.json$/;
  let removedCount = 0;

  function scanAndRemove(dir: string) {
    const entries = fs.readdirSync(dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        scanAndRemove(fullPath);
      } else if (duplicatePattern.test(entry)) {
        try {
          fs.unlinkSync(fullPath);
          removedCount++;
          logger.debug('Removed duplicate workflow file', { file: entry });
        } catch (error) {
          logger.warn('Failed to remove duplicate workflow file', { file: entry }, error);
        }
      }
    }
  }

  scanAndRemove(workflowsDir);
  return removedCount;
}

