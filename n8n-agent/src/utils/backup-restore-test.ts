/**
 * Backup/Restore Integration Test Utilities
 * 
 * Provides utilities for testing backup and restore operations
 * with verification and validation.
 * 
 * Also exports reusable utilities for container reuse pattern:
 * - `resetN8nState()` - Reset instance state between tests (~1-2s)
 * - `verifyN8nHealth()` - Check if instance is healthy
 * - `clearAllWorkflows()` - Clear all workflows from instance
 * 
 * These utilities can be used by any test suite that manages n8n containers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { exportWorkflows, importWorkflow, deleteWorkflow, type Workflow, type N8nApiConfig } from './n8n-api';
import { logger } from './logger';
import type { N8nInstance } from './n8n-podman';
import { collectJsonFilesRecursive } from './file';

/**
 * Helper to build API config from instance
 */
function buildApiConfig(instance: N8nInstance): N8nApiConfig {
  const config: N8nApiConfig = {
    baseURL: instance.baseUrl,
  };
  
  if (instance.apiKey) {
    config.apiKey = instance.apiKey;
    logger.info(`Using API key authentication for ${instance.baseUrl}`);
  } else if (instance.sessionCookie) {
    config.sessionCookie = instance.sessionCookie;
    logger.info(`Using session cookie authentication for ${instance.baseUrl} (cookie length: ${instance.sessionCookie.length})`);
  } else {
    logger.warn(`No authentication method available for ${instance.baseUrl} - API calls may fail`);
  }
  
  return config;
}

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

  if (!baseUrl) {
    throw new Error('baseURL is not defined - instance.baseUrl is missing');
  }

  logger.info(`Creating ${workflows.length} test workflow(s) in n8n instance at ${baseUrl}...`);
  logger.info(`Instance auth: apiKey=${instance.apiKey ? 'present' : 'missing'}, sessionCookie=${instance.sessionCookie ? 'present' : 'missing'}`);

  for (const workflow of workflows) {
    try {
      logger.info(`Importing workflow "${workflow.name}" to ${baseUrl}...`);
      const apiConfig = buildApiConfig(instance);
      logger.info(`API config: baseURL=${apiConfig.baseURL}, apiKey=${apiConfig.apiKey ? 'present' : 'missing'}, sessionCookie=${apiConfig.sessionCookie ? 'present' : 'missing'}`);
      
      const importedWorkflow = await importWorkflow(workflow, apiConfig);
      
      if (!importedWorkflow || !importedWorkflow.id) {
        throw new Error(`Workflow "${workflow.name}" was imported but has no ID`);
      }
      
      imported.push(importedWorkflow);
      logger.debug(`✅ Created test workflow: ${workflow.name} (ID: ${importedWorkflow.id})`);
    } catch (error) {
      logger.error(`Failed to create workflow "${workflow.name}"`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error details: ${errorMessage}`);
      if (error instanceof Error && error.stack) {
        logger.debug(`Stack trace: ${error.stack}`);
      }
      throw new Error(
        `Failed to create test workflow "${workflow.name}": ${errorMessage}`
      );
    }
  }

  logger.info(`✅ Created ${imported.length} test workflow(s)`);
  return imported;
}

/**
 * Clear all workflows from n8n instance
 * 
 * Reusable utility for any test suite using the container reuse pattern.
 * Handles archived workflows that require archiving before deletion.
 * 
 * @param instance - The n8n instance to clear workflows from
 * @throws Error if workflows cannot be cleared
 * 
 * @example
 * ```typescript
 * beforeEach(async () => {
 *   await clearAllWorkflows(instance);
 * });
 * ```
 */
export async function clearAllWorkflows(instance: N8nInstance): Promise<void> {
  const baseUrl = instance.baseUrl;
  
  if (!baseUrl) {
    throw new Error('baseURL is not defined - instance.baseUrl is missing');
  }
  
  logger.info(`Clearing all workflows from n8n instance at ${baseUrl}...`);
  
  try {
    const apiConfig = buildApiConfig(instance);
    const client = (await import('axios')).default;
    const headers: any = {};
    if (apiConfig.apiKey) {
      headers['X-N8N-API-KEY'] = apiConfig.apiKey; // Corrected header
    } else if (apiConfig.sessionCookie) {
      headers['Cookie'] = apiConfig.sessionCookie;
    }

    const workflows = await exportWorkflows(apiConfig);
    logger.debug(`Found ${workflows.length} workflow(s) to delete`);
    
    let deletedCount = 0;
    
    for (const wf of workflows) {
      if (!wf.id) {
        logger.warn(`Skipping workflow without ID: ${wf.name || 'unnamed'}`);
        continue;
      }
      try {
        // Deactivate workflow if it's active using the correct endpoint
        if (wf.active) {
          await client.post(
            `${apiConfig.baseURL}/rest/workflows/${wf.id}/deactivate`,
            {}, // No body needed for deactivation
            { headers, withCredentials: true, timeout: 10000 }
          );
          logger.debug(`Deactivated workflow ${wf.name} (${wf.id})`);
        }

        // Now, delete the workflow
        await client.delete(
          `${apiConfig.baseURL}/rest/workflows/${wf.id}`,
          { headers, withCredentials: true, timeout: 10000 }
        );
        logger.debug(`Deleted workflow ${wf.name} (${wf.id})`);
        deletedCount++;
      } catch (error) {
        const axiosError = error as import('axios').AxiosError;
        if (axiosError.response) {
          logger.warn(`Failed to delete workflow ${wf.id} (${wf.name}): Status ${axiosError.response.status} - ${JSON.stringify(axiosError.response.data)}`);
        } else {
          logger.warn(`Failed to delete workflow ${wf.id} (${wf.name}): ${axiosError.message}`);
        }
      }
    }
    
    logger.info(`✅ Deleted ${deletedCount} workflow(s)`);
  } catch (error) {
    logger.error(`Failed to clear workflows from ${baseUrl}`, error);
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

  if (!baseUrl) {
    errors.push('baseURL is not defined - instance.baseUrl is missing');
    return { matches: false, errors, warnings };
  }

  logger.info(`Verifying workflows match after restore (${baseUrl})...`);
  logger.debug(`Original workflows: ${originalWorkflows.length}, names: ${originalWorkflows.map(w => w.name).join(', ')}`);

  // Export workflows from n8n
  let restoredWorkflows: Workflow[];
  try {
    logger.debug(`Exporting workflows from ${baseUrl}...`);
    const apiConfig = buildApiConfig(instance);
    
    restoredWorkflows = await exportWorkflows(apiConfig);
    logger.debug(`Exported ${restoredWorkflows.length} workflow(s) from n8n`);
    logger.debug(`Restored workflow names: ${restoredWorkflows.map(w => w.name).join(', ')}`);
  } catch (error) {
    const errorMsg = `Failed to export workflows from n8n: ${error instanceof Error ? error.message : String(error)}`;
    logger.error(errorMsg, error);
    errors.push(errorMsg);
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

    // Compare workflow structure (ignore IDs and workflow references as they may change)
    // Normalize nodes to ignore workflow reference IDs which change after restore
    const normalizeNodes = (nodes: any[]) => {
      return nodes.map(node => {
        const normalized = { ...node };
        // Normalize workflow references - keep structure but ignore actual ID values
        if (normalized.parameters?.workflowId?.value) {
          normalized.parameters = {
            ...normalized.parameters,
            workflowId: {
              ...normalized.parameters.workflowId,
              value: '<workflow-id>',  // Normalize to placeholder
              cachedResultUrl: normalized.parameters.workflowId.cachedResultUrl ? '<url>' : undefined,
            }
          };
        }
        return normalized;
      });
    };
    
    const originalNodes = JSON.stringify(normalizeNodes(original.nodes || []), null, 2);
    const restoredNodes = JSON.stringify(normalizeNodes(restored.nodes || []), null, 2);
    if (originalNodes !== restoredNodes) {
      errors.push(`Workflow "${name}" nodes don't match`);
      logger.error(`❌ Nodes mismatch for workflow "${name}"`);
      logger.error(`Original nodes (${(original.nodes || []).length} nodes):\n${originalNodes}`);
      logger.error(`Restored nodes (${(restored.nodes || []).length} nodes):\n${restoredNodes}`);
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
    const apiConfig = buildApiConfig(instance);
    
    n8nWorkflows = await exportWorkflows(apiConfig);
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
    logger.debug(`Backup environment: N8N_BASE_URL=${instance.baseUrl}, N8N_URL=${instance.baseUrl}, N8N_API_KEY=${instance.apiKey ? 'set' : 'not set'}, N8N_SESSION_COOKIE=${instance.sessionCookie ? 'set' : 'not set'}`);
    const originalN8nUrl = process.env.N8N_BASE_URL;
    const originalN8nUrl2 = process.env.N8N_URL;
    const originalApiKey = process.env.N8N_API_KEY;
    const originalSessionCookie = process.env.N8N_SESSION_COOKIE;
    try {
      // Set both environment variables to ensure API client picks it up
      process.env.N8N_BASE_URL = instance.baseUrl;
      process.env.N8N_URL = instance.baseUrl;
      if (instance.apiKey) {
        process.env.N8N_API_KEY = instance.apiKey;
      } else {
        // CRITICAL: Delete API key env var when using session cookie only
        // Otherwise old API key values will override session cookie
        delete process.env.N8N_API_KEY;
      }
      if (instance.sessionCookie) {
        process.env.N8N_SESSION_COOKIE = instance.sessionCookie;
      }
      logger.debug(`Starting backup command...`);
      const { executeBackup } = await import('../commands/backup');
      await executeBackup({ output: backupDir, yes: true }, []);
      logger.debug(`Backup command completed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Backup failed: ${errorMessage}`, error);
      errors.push(`Backup failed: ${errorMessage}`);
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
      if (originalApiKey !== undefined) {
        process.env.N8N_API_KEY = originalApiKey;
      } else {
        delete process.env.N8N_API_KEY;
      }
      if (originalSessionCookie !== undefined) {
        process.env.N8N_SESSION_COOKIE = originalSessionCookie;
      } else {
        delete process.env.N8N_SESSION_COOKIE;
      }
    }
    
    // Verify backup files exist
    logger.debug(`Verifying backup files in ${backupDir}...`);
    const backupFiles = await collectJsonFilesRecursive(backupDir);
    if (backupFiles.length === 0) {
      const errorMsg = 'No backup files created';
      logger.error(errorMsg);
      errors.push(errorMsg);
    } else {
      logger.info(`✅ Backup created ${backupFiles.length} file(s)`);
      logger.debug(`Backup files: ${backupFiles.map(f => path.basename(f)).join(', ')}`);
    }

    // Step 3: Clear n8n instance (simulate fresh restore)
    if (options?.clearBeforeRestore !== false) {
      logger.info(`\n🗑️  Step 3: Clearing n8n instance...`);
      await clearAllWorkflows(instance);
    }

    // Step 4: Restore workflows
    logger.info(`\n📥 Step 4: Running restore${options?.preserveIds ? ' with ID preservation' : ''}...`);
    logger.debug(`Restore environment: N8N_BASE_URL=${instance.baseUrl}, N8N_URL=${instance.baseUrl}, N8N_API_KEY=${instance.apiKey ? 'set' : 'not set'}, N8N_SESSION_COOKIE=${instance.sessionCookie ? 'set' : 'not set'}`);
    logger.debug(`Restore options: input=${backupDir}, preserveIds=${options?.preserveIds || false}`);
    try {
      // Set both environment variables to ensure API client picks it up
      process.env.N8N_BASE_URL = instance.baseUrl;
      process.env.N8N_URL = instance.baseUrl;
      if (instance.apiKey) {
        process.env.N8N_API_KEY = instance.apiKey;
      } else {
        // CRITICAL: Delete API key env var when using session cookie only
        // Otherwise old API key values will override session cookie
        delete process.env.N8N_API_KEY;
      }
      if (instance.sessionCookie) {
        process.env.N8N_SESSION_COOKIE = instance.sessionCookie;
      }
      logger.debug(`Starting restore command...`);
      const { executeRestore } = await import('../commands/restore');
      await executeRestore({ 
        input: backupDir, 
        yes: true, 
        preserveIds: options?.preserveIds 
      }, []);
      logger.debug(`Restore command completed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Restore failed: ${errorMessage}`, error);
      errors.push(`Restore failed: ${errorMessage}`);
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
      if (originalApiKey !== undefined) {
        process.env.N8N_API_KEY = originalApiKey;
      } else {
        delete process.env.N8N_API_KEY;
      }
      if (originalSessionCookie !== undefined) {
        process.env.N8N_SESSION_COOKIE = originalSessionCookie;
      } else {
        delete process.env.N8N_SESSION_COOKIE;
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
      const apiConfig = buildApiConfig(instance);
      const restoredWorkflows = await exportWorkflows(apiConfig);
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
      logger.info(`📊 Test Statistics:`);
      logger.info(`   - Workflows backed up: ${stats.workflowsBackedUp}`);
      logger.info(`   - Workflows restored: ${stats.workflowsRestored}`);
      logger.info(`   - Workflows verified: ${stats.workflowsVerified}`);
      if (options?.verifyReferences) {
        logger.info(`   - References fixed: ${stats.referencesFixed}`);
        logger.info(`   - References broken: ${stats.referencesBroken}`);
      }
    } else {
      logger.error(`\n❌ Backup/restore test completed with ${errors.length} error(s)`);
      logger.error(`\n📋 Error Details:`);
      errors.forEach((error, index) => {
        logger.error(`   ${index + 1}. ${error}`);
      });
      if (warnings.length > 0) {
        logger.warn(`\n⚠️  Warnings (${warnings.length}):`);
        warnings.forEach((warning, index) => {
          logger.warn(`   ${index + 1}. ${warning}`);
        });
      }
      logger.info(`\n📊 Test Statistics:`);
      logger.info(`   - Workflows backed up: ${stats.workflowsBackedUp}`);
      logger.info(`   - Workflows restored: ${stats.workflowsRestored}`);
      logger.info(`   - Workflows verified: ${stats.workflowsVerified}`);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Test failed: ${errorMessage}`);
    logger.error(`\n💥 Test error occurred:`, error);
    if (error instanceof Error && error.stack) {
      logger.debug(`Stack trace: ${error.stack}`);
    }
    logger.error(`\n📋 All Errors (${errors.length}):`);
    errors.forEach((err, index) => {
      logger.error(`   ${index + 1}. ${err}`);
    });
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}

/**
 * Verify n8n instance is healthy and responsive
 * 
 * Reusable utility for any test suite using the container reuse pattern.
 * Use in beforeEach to ensure instance is ready before each test.
 * 
 * @param instance - The n8n instance to check
 * @returns true if instance is healthy, false otherwise
 * 
 * @example
 * ```typescript
 * beforeEach(async () => {
 *   const healthy = await verifyN8nHealth(instance);
 *   if (!healthy) {
 *     throw new Error('Instance is unhealthy');
 *   }
 * });
 * ```
 */
export async function verifyN8nHealth(instance: N8nInstance): Promise<boolean> {
  try {
    const axios = (await import('axios')).default;
    const response = await axios.get(`${instance.baseUrl}/healthz`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    return response.status === 200;
  } catch (error) {
    logger.warn(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Reset n8n instance state between tests
 * 
 * Reusable utility for any test suite using the container reuse pattern.
 * Use in beforeEach to reset state between tests without restarting containers.
 * 
 * - Clears all workflows
 * - Keeps credentials intact
 * - Faster than container restart (~1-2s vs 20-30s)
 * 
 * @param instance - The n8n instance to reset
 * @throws Error if reset fails or workflows cannot be cleared
 * 
 * @example
 * ```typescript
 * beforeEach(async () => {
 *   await resetN8nState(instance);
 * });
 * ```
 */
export async function resetN8nState(instance: N8nInstance): Promise<void> {
  logger.info('🔄 Resetting n8n instance state...');
  
  try {
    // Clear all workflows
    await clearAllWorkflows(instance);
    
    // Verify state is clean
    const apiConfig = buildApiConfig(instance);
    const workflows = await exportWorkflows(apiConfig);
    
    if (workflows.length > 0) {
      logger.warn(`⚠️  ${workflows.length} workflow(s) still present after reset`);
      // Try again with force
      for (const wf of workflows) {
        if (wf.id) {
          try {
            await deleteWorkflow(wf.id, apiConfig);
          } catch (error) {
            logger.error(`Failed to force-delete workflow ${wf.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      
      // Final verification
      const remainingWorkflows = await exportWorkflows(apiConfig);
      if (remainingWorkflows.length > 0) {
        throw new Error(
          `Failed to reset state: ${remainingWorkflows.length} workflow(s) still present after force cleanup. ` +
          `Names: ${remainingWorkflows.map(w => w.name).join(', ')}`
        );
      }
    }
    
    logger.info('✅ n8n instance state reset complete');
  } catch (error) {
    logger.error('Failed to reset n8n state:', error);
    throw new Error(`Failed to reset n8n state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

