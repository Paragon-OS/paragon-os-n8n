/**
 * Workflow ID Synchronization Utility
 * 
 * Syncs toolWorkflow node references to match actual workflow IDs from n8n.
 * Updates both the value field (ID) and cachedResultUrl to match current n8n state.
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
 * Sync toolWorkflow references in local files to match n8n workflow IDs
 * 
 * Updates the value field to match current workflow IDs from n8n.
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
  if (!silent) {
    logger.info(`📋 Starting workflow reference sync...`, {
      n8nWorkflowCount: n8nWorkflows.length
    });
  }

  // Build name -> ID map from n8n workflows
  const n8nNameToId = new Map<string, string>();
  n8nWorkflows.forEach(wf => {
    n8nNameToId.set(wf.name, wf.id);
  });

  const workflowFiles = getAllWorkflowFiles(workflowsDir);
  
  if (!silent) {
    logger.info(`   Checking ${workflowFiles.length} workflow file(s) for references`);
  }

  const result: SyncResult = {
    fixed: 0,
    notFound: 0,
    details: []
  };

  // Build ID -> ID map for workflow file ID updates (in case workflow file has old ID)
  const n8nNameToWorkflow = new Map<string, Workflow>();
  n8nWorkflows.forEach(wf => {
    n8nNameToWorkflow.set(wf.name, wf);
  });

  for (const filePath of workflowFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const workflow: LocalWorkflow = JSON.parse(content);
      let modified = false;

      // Check if workflow's own ID matches n8n (in case workflow was re-imported with new ID)
      const n8nWorkflow = n8nNameToWorkflow.get(workflow.name);
      if (n8nWorkflow && n8nWorkflow.id !== workflow.id) {
        if (!silent) {
          logger.info(`🔄 Updating workflow file ID: ${workflow.name} (${workflow.id} → ${n8nWorkflow.id})`);
        }
        workflow.id = n8nWorkflow.id;
        modified = true;
      }

      const toolWorkflowNodes = workflow.nodes.filter(n => n.type === '@n8n/n8n-nodes-langchain.toolWorkflow');
      if (!silent && toolWorkflowNodes.length > 0) {
        logger.info(`📄 ${workflow.name}: Found ${toolWorkflowNodes.length} toolWorkflow node(s) to check`);
      }

      for (const node of workflow.nodes) {
        if (node.type === '@n8n/n8n-nodes-langchain.toolWorkflow') {
          const workflowId = node.parameters?.workflowId;

          if (workflowId?.value) {
            // Try multiple strategies to resolve the workflow reference
            let referencedName = workflowId.cachedResultName;
            const currentId = workflowId.value;
            let n8nId: string | undefined;
            let resolutionMethod = '';
            
            if (!silent) {
              logger.info(`🔍 Checking: ${workflow.name} → ${node.name}`, {
                currentValue: currentId,
                cachedName: referencedName || 'none'
              });
            }
            
            // Strategy 1: Try to resolve by cachedResultName (most reliable)
            if (referencedName) {
              n8nId = n8nNameToId.get(referencedName);
              if (n8nId) {
                resolutionMethod = 'by cachedResultName';
                if (!silent) {
                  logger.info(`   ✓ Strategy 1: Found "${referencedName}" → ID: ${n8nId}`);
                }
              } else {
                if (!silent) {
                  logger.info(`   ✗ Strategy 1: "${referencedName}" not in n8n`);
                }
              }
            } else {
              if (!silent) {
                logger.info(`   - Strategy 1: No cachedResultName`);
              }
            }
            
            // Strategy 2: If not found, try to find workflow by current value as ID
            if (!n8nId) {
              const workflowById = n8nWorkflows.find(w => w.id === currentId);
              if (workflowById) {
                n8nId = workflowById.id;
                referencedName = workflowById.name;
                resolutionMethod = 'by ID (value matched)';
                if (!silent) {
                  logger.info(`   ✓ Strategy 2: ID "${currentId}" exists → Name: "${referencedName}"`);
                }
              } else {
                if (!silent) {
                  logger.info(`   ✗ Strategy 2: ID "${currentId}" not found in n8n`);
                }
              }
            }
            
            // Strategy 3: If not found, try to treat value as a workflow name
            if (!n8nId) {
              n8nId = n8nNameToId.get(currentId);
              if (n8nId) {
                referencedName = currentId;
                resolutionMethod = 'by name (value was name)';
                if (!silent) {
                  logger.info(`   ✓ Strategy 3: Name "${currentId}" exists → ID: ${n8nId}`);
                }
              } else {
                if (!silent) {
                  logger.info(`   ✗ Strategy 3: Name "${currentId}" not found in n8n`);
                }
              }
            }
            
            // Strategy 4: If still not found and we have cachedResultName, try fuzzy matching
            // This handles cases where the name might have slight variations
            if (!n8nId && referencedName) {
              const nameToMatch = referencedName; // Type guard for TypeScript
              const fuzzyMatch = n8nWorkflows.find(w => 
                w.name.toLowerCase() === nameToMatch.toLowerCase() ||
                w.name.toLowerCase().includes(nameToMatch.toLowerCase()) ||
                nameToMatch.toLowerCase().includes(w.name.toLowerCase())
              );
              if (fuzzyMatch) {
                n8nId = fuzzyMatch.id;
                referencedName = fuzzyMatch.name;
                resolutionMethod = 'by fuzzy name match';
                if (!silent) {
                  logger.info(`   ✓ Strategy 4: Fuzzy match "${fuzzyMatch.name}" → ID: ${n8nId}`);
                }
              } else {
                if (!silent) {
                  logger.info(`   ✗ Strategy 4: No fuzzy match for "${nameToMatch}"`);
                }
              }
            }

            if (n8nId && referencedName) {
              const needsUpdate = currentId !== n8nId || !workflowId.cachedResultName || !workflowId.cachedResultUrl;
              
              if (needsUpdate) {
                if (!silent) {
                  logger.info(`🔄 FIXING reference: ${workflow.name} → ${node.name} → ${referencedName}`, {
                    oldId: currentId,
                    newId: n8nId,
                    method: resolutionMethod,
                    reason: currentId !== n8nId ? 'ID mismatch' : 
                           !workflowId.cachedResultName ? 'missing cachedResultName' :
                           !workflowId.cachedResultUrl ? 'missing cachedResultUrl' : 'unknown'
                  });
                }

                result.details.push({
                  workflowName: workflow.name,
                  nodeName: node.name,
                  targetName: referencedName,
                  oldId: currentId,
                  newId: n8nId
                });

                // Use ID in value field (n8n resolves by ID when mode is "list")
                workflowId.value = n8nId;
                workflowId.mode = 'list';
                workflowId.cachedResultName = referencedName;
                workflowId.cachedResultUrl = `/workflow/${n8nId}`;
                modified = true;
                result.fixed++;
              } else {
                if (!silent) {
                  logger.info(`   ✓ Already correct (ID: ${n8nId}, Name: ${referencedName})`);
                }
              }
            } else {
              // Couldn't resolve workflow reference - log detailed info
              if (!silent) {
                logger.warn(`⚠️  FAILED to resolve reference: ${workflow.name} → ${node.name}`, {
                  currentValue: currentId,
                  cachedName: referencedName || 'none',
                  availableWorkflows: n8nWorkflows.length,
                  sampleWorkflows: n8nWorkflows.slice(0, 5).map(w => `${w.id} - ${w.name}`).join(', ')
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

