#!/usr/bin/env ts-node

/**
 * Post-Backup Sync Script
 * 
 * Run this AFTER backing up workflows from n8n.
 * 
 * This script:
 * 1. Removes duplicate " (2).json" files created by backup
 * 2. Syncs workflow IDs from n8n to fix toolWorkflow references
 * 
 * NOTE: The backup command now does this automatically, so this script
 * is mainly for manual cleanup if needed.
 */

import * as path from 'path';
import { exportWorkflows } from '../src/utils/n8n-api';
import { syncWorkflowReferences, removeDuplicateWorkflowFiles } from '../src/utils/workflow-id-sync';

async function main() {
  const workflowsDir = path.join(__dirname, '..', 'workflows');
  
  console.log('\x1b[1m🔄 Post-Backup Sync\x1b[0m\n');
  
  // Step 1: Find and remove duplicate " (2).json" files
  console.log('Step 1: Removing duplicate " (2).json" files...');
  const duplicatesRemoved = removeDuplicateWorkflowFiles(workflowsDir);
  
  if (duplicatesRemoved > 0) {
    console.log(`✓ Removed ${duplicatesRemoved} duplicate files\n`);
  } else {
    console.log('✓ No duplicate files found\n');
  }
  
  // Step 2: Sync workflow IDs
  console.log('Step 2: Syncing workflow IDs from n8n...');
  console.log('Fetching workflows from n8n...');
  
  const n8nWorkflows = await exportWorkflows();
  console.log(`✓ Fetched ${n8nWorkflows.length} workflows\n`);
  
  const syncResult = await syncWorkflowReferences(workflowsDir, n8nWorkflows);
  
  if (syncResult.fixed > 0) {
    console.log(`✓ Fixed ${syncResult.fixed} workflow references\n`);
  } else {
    console.log('✓ All references already correct\n');
  }
  
  if (syncResult.notFound > 0) {
    console.log(`\x1b[33m⚠ ${syncResult.notFound} referenced workflow(s) not found in n8n\x1b[0m\n`);
  }
  
  console.log('\x1b[32m✓ Post-backup sync complete!\x1b[0m\n');
  console.log('Your workflow files now have:');
  console.log('  1. No duplicate " (2).json" files');
  console.log('  2. Correct workflow IDs matching n8n');
  console.log('  3. Fixed toolWorkflow references');
}

main().catch(error => {
  console.error('\x1b[31mError:\x1b[0m', error);
  process.exit(1);
});

