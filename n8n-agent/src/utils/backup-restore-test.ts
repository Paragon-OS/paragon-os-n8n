/**
 * Backup/Restore Integration Test Utilities
 * 
 * Provides utilities for testing backup and restore operations
 * with verification and validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { exportWorkflows, importWorkflow, deleteWorkflow, type Workflow } from './n8n-api';
import { logger } from './logger';
import type { N8nInstance } from './n8n-podman';
import { collectJsonFilesRecursive } from './file';

export interface BackupRestoreTestResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    workflowsBackedUp: number;
    workflowsRestored: number;
    workflowsVerified: number;
    referencesFixed: number;
    referencesBroken: number;
  };
}

export interface WorkflowVerificationResult {
  matches: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Create test workflows in n8n instance
 */
export async function createTestWorkflows(
  instance: N8nInstance,
  workflows: Workflow[]
): Promise<Workflow[]> {
  const imported: Workflow[] = [];
  const baseUrl = instance.baseUrl;

  logger.info(`Creating ${workflows.length} test workflow(s) in n8n instance...`);

  for (const workflow of workflows) {
    try {
      const importedWorkflow = await importWorkflow(workflow, { baseURL: baseUrl });
      imported.push(importedWorkflow);
      logger.debug(`Created test workflow: ${workflow.name} (ID: ${importedWorkflow.id})`);
    } catch (error) {
      throw new Error(
        `Failed to create test workflow "${workflow.name}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  logger.info(`✅ Created ${imported.length} test workflow(s)`);
  return imported;
}

/**
 * Clear all workflows from n8n instance
 */
export async function clearAllWorkflows(instance: N8nInstance): Promise<void> {
  const baseUrl = instance.baseUrl;
  
  logger.info('Clearing all workflows from n8n instance...');
  
  try {
    const workflows = await exportWorkflows({ baseURL: baseUrl });
    let deletedCount = 0;
    
    for (const wf of workflows) {
      try {
        await deleteWorkflow(wf.id, { baseURL: baseUrl });
        deletedCount++;
      } catch (error) {
        logger.warn(`Failed to delete workflow ${wf.id} (${wf.name}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    logger.info(`✅ Deleted ${deletedCount} workflow(s)`);
  } catch (error) {
    throw new Error(`Failed to clear workflows: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Verify workflows match after restore
 */
export async function verifyWorkflowsMatch(
  instance: N8nInstance,
  originalWorkflows: Workflow[],
  backupDir: string
): Promise<WorkflowVerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const baseUrl = instance.baseUrl;

  logger.info('Verifying workflows match after restore...');

  // Export workflows from n8n
  let restoredWorkflows: Workflow[];
  try {
    restoredWorkflows = await exportWorkflows({ baseURL: baseUrl });
  } catch (error) {
    errors.push(`Failed to export workflows from n8n: ${error instanceof Error ? error.message : String(error)}`);
    return { matches: false, errors, warnings };
  }

  // Build maps for comparison
  const originalByName = new Map<string, Workflow>();
  const restoredByName = new Map<string, Workflow>();

  for (const wf of originalWorkflows) {
    if (wf.name) {
      originalByName.set(wf.name, wf);
    }
  }

  for (const wf of restoredWorkflows) {
    if (wf.name) {
      restoredByName.set(wf.name, wf);
    }
  }

  // Check all original workflows exist
  for (const [name, original] of originalByName) {
    const restored = restoredByName.get(name);
    if (!restored) {
      errors.push(`Workflow "${name}" not found after restore`);
      continue;
    }

    // Compare workflow structure (ignore IDs as they may change)
    const originalNodes = JSON.stringify(original.nodes || []);
    const restoredNodes = JSON.stringify(restored.nodes || []);
    if (originalNodes !== restoredNodes) {
      errors.push(`Workflow "${name}" nodes don't match`);
      logger.debug(`Original nodes: ${originalNodes.substring(0, 200)}...`);
      logger.debug(`Restored nodes: ${restoredNodes.substring(0, 200)}...`);
    }
    
    const originalConnections = JSON.stringify(original.connections || {});
    const restoredConnections = JSON.stringify(restored.connections || {});
    if (originalConnections !== restoredConnections) {
      errors.push(`Workflow "${name}" connections don't match`);
    }
    
    // Note: IDs may differ, so we don't compare them
    if (original.id !== restored.id) {
      warnings.push(`Workflow "${name}" ID changed: ${original.id} → ${restored.id} (expected in non-preserve mode)`);
    }
  }

  // Check for unexpected workflows
  for (const [name] of restoredByName) {
    if (!originalByName.has(name)) {
      warnings.push(`Unexpected workflow "${name}" found after restore`);
    }
  }

  // Verify backup files exist
  try {
    const backupFiles = await collectJsonFilesRecursive(backupDir);
    if (backupFiles.length === 0) {
      errors.push(`No backup files found in ${backupDir}`);
    } else if (backupFiles.length !== originalWorkflows.length) {
      warnings.push(
        `Backup file count mismatch: expected ${originalWorkflows.length}, found ${backupFiles.length}`
      );
    }
  } catch (error) {
    errors.push(`Failed to verify backup files: ${error instanceof Error ? error.message : String(error)}`);
  }

  const matches = errors.length === 0;
  if (matches) {
    logger.info(`✅ All workflows verified successfully`);
  } else {
    logger.warn(`⚠️  Workflow verification found ${errors.length} error(s) and ${warnings.length} warning(s)`);
  }

  return { matches, errors, warnings };
}

/**
 * Verify workflow references are valid
 */
export async function verifyWorkflowReferences(
  instance: N8nInstance,
  workflows: Workflow[]
): Promise<{ valid: boolean; broken: string[] }> {
  const broken: string[] = [];
  const baseUrl = instance.baseUrl;

  logger.info('Verifying workflow references...');

  // Get all workflow IDs from n8n
  let n8nWorkflows: Workflow[];
  try {
    n8nWorkflows = await exportWorkflows({ baseURL: baseUrl });
  } catch (error) {
    return {
      valid: false,
      broken: [`Failed to export workflows: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const validIds = new Set(n8nWorkflows.map(w => w.id));
  const validNames = new Set(n8nWorkflows.map(w => w.name));

  // Check each workflow for references
  for (const workflow of workflows) {
    for (const node of workflow.nodes || []) {
      // Check toolWorkflow nodes
      if (node.type === '@n8n/n8n-nodes-langchain.toolWorkflow') {
        const params = node.parameters as any;
        const workflowId = params?.workflowId;
        
        if (workflowId) {
          const value = workflowId.value;
          const cachedName = workflowId.cachedResultName;
          
          // Check if reference is valid
          if (value && !validIds.has(value)) {
            // Check if it's a name instead of ID
            if (cachedName && validNames.has(cachedName)) {
              // Reference by name is valid (will be resolved at runtime)
              logger.debug(`Workflow "${workflow.name}" → Node "${node.name}" references "${cachedName}" by name (valid)`);
            } else {
              broken.push(
                `Workflow "${workflow.name}" → Node "${node.name}" references non-existent workflow ID: ${value}${cachedName ? ` (name: ${cachedName})` : ''}`
              );
            }
          }
        }
      }

      // Check executeWorkflow nodes
      if (node.type === 'n8n-nodes-base.executeWorkflow') {
        const params = node.parameters as any;
        const workflowId = params?.workflowId;
        
        if (workflowId && !validIds.has(workflowId)) {
          broken.push(
            `Workflow "${workflow.name}" → Node "${node.name}" references non-existent workflow ID: ${workflowId}`
          );
        }
      }
    }
  }

  const valid = broken.length === 0;
  if (valid) {
    logger.info(`✅ All workflow references are valid`);
  } else {
    logger.warn(`⚠️  Found ${broken.length} broken workflow reference(s)`);
  }

  return { valid, broken };
}

/**
 * Run a complete backup/restore test cycle
 * 
 * This function:
 * 1. Creates test workflows in n8n
 * 2. Runs backup
 * 3. Clears n8n instance
 * 4. Runs restore
 * 5. Verifies workflows match
 * 6. Optionally verifies references
 */
export async function runBackupRestoreTest(
  instance: N8nInstance,
  testWorkflows: Workflow[],
  backupDir: string,
  options?: {
    preserveIds?: boolean;
    verifyReferences?: boolean;
    clearBeforeRestore?: boolean;
  }
): Promise<BackupRestoreTestResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats = {
    workflowsBackedUp: 0,
    workflowsRestored: 0,
    workflowsVerified: 0,
    referencesFixed: 0,
    referencesBroken: 0,
  };

  // Ensure backup directory exists
  fs.mkdirSync(backupDir, { recursive: true });

  try {
    // Step 1: Create test workflows
    logger.info(`\n📝 Step 1: Creating ${testWorkflows.length} test workflow(s)...`);
    const originalWorkflows = await createTestWorkflows(instance, testWorkflows);
    stats.workflowsBackedUp = originalWorkflows.length;

    // Step 2: Backup workflows
    logger.info(`\n💾 Step 2: Running backup to ${backupDir}...`);
    const originalN8nUrl = process.env.N8N_BASE_URL;
    const originalN8nUrl2 = process.env.N8N_URL;
    try {
      // Set both environment variables to ensure API client picks it up
      process.env.N8N_BASE_URL = instance.baseUrl;
      process.env.N8N_URL = instance.baseUrl;
      const { executeBackup } = await import('../commands/backup');
      await executeBackup({ output: backupDir, yes: true }, []);
    } catch (error) {
      errors.push(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      if (originalN8nUrl !== undefined) {
        process.env.N8N_BASE_URL = originalN8nUrl;
      } else {
        delete process.env.N8N_BASE_URL;
      }
      if (originalN8nUrl2 !== undefined) {
        process.env.N8N_URL = originalN8nUrl2;
      } else {
        delete process.env.N8N_URL;
      }
    }
    
    // Verify backup files exist
    const backupFiles = await collectJsonFilesRecursive(backupDir);
    if (backupFiles.length === 0) {
      errors.push('No backup files created');
    } else {
      logger.info(`✅ Backup created ${backupFiles.length} file(s)`);
    }

    // Step 3: Clear n8n instance (simulate fresh restore)
    if (options?.clearBeforeRestore !== false) {
      logger.info(`\n🗑️  Step 3: Clearing n8n instance...`);
      await clearAllWorkflows(instance);
    }

    // Step 4: Restore workflows
    logger.info(`\n📥 Step 4: Running restore${options?.preserveIds ? ' with ID preservation' : ''}...`);
    try {
      // Set both environment variables to ensure API client picks it up
      process.env.N8N_BASE_URL = instance.baseUrl;
      process.env.N8N_URL = instance.baseUrl;
      const { executeRestore } = await import('../commands/restore');
      await executeRestore({ 
        input: backupDir, 
        yes: true, 
        preserveIds: options?.preserveIds 
      }, []);
    } catch (error) {
      errors.push(`Restore failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      if (originalN8nUrl !== undefined) {
        process.env.N8N_BASE_URL = originalN8nUrl;
      } else {
        delete process.env.N8N_BASE_URL;
      }
      if (originalN8nUrl2 !== undefined) {
        process.env.N8N_URL = originalN8nUrl2;
      } else {
        delete process.env.N8N_URL;
      }
    }

    // Step 5: Verify workflows match
    logger.info(`\n✅ Step 5: Verifying workflows...`);
    const verification = await verifyWorkflowsMatch(instance, originalWorkflows, backupDir);
    if (!verification.matches) {
      errors.push(...verification.errors);
    } else {
      stats.workflowsVerified = originalWorkflows.length;
    }
    warnings.push(...verification.warnings);

    // Step 6: Verify references (if requested)
    if (options?.verifyReferences) {
      logger.info(`\n🔗 Step 6: Verifying workflow references...`);
      const restoredWorkflows = await exportWorkflows({ baseURL: instance.baseUrl });
      const refCheck = await verifyWorkflowReferences(instance, restoredWorkflows);
      if (!refCheck.valid) {
        errors.push(...refCheck.broken);
        stats.referencesBroken = refCheck.broken.length;
      } else {
        stats.referencesFixed = restoredWorkflows.length;
      }
    }

    stats.workflowsRestored = originalWorkflows.length;

    if (errors.length === 0) {
      logger.info(`\n🎉 Backup/restore test completed successfully!`);
    } else {
      logger.error(`\n❌ Backup/restore test completed with ${errors.length} error(s)`);
    }

  } catch (error) {
    errors.push(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
    logger.error(`Test error:`, error);
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}

