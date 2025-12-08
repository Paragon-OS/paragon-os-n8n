#!/usr/bin/env ts-node

/**
 * Post-Backup Sync Script
 * 
 * Run this AFTER backing up workflows from n8n.
 * 
 * This script:
 * 1. Removes duplicate " (2).json" files created by backup
 * 2. Syncs workflow IDs from n8n to fix toolWorkflow references
 * 3. Backs up again to get clean files with correct references
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { exportWorkflows } from '../src/utils/n8n-api';

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

interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
}

function getAllWorkflowFiles(dir: string, pattern: RegExp): string[] {
  const files: string[] = [];
  
  function scan(currentDir: string) {
    const entries = fs.readdirSync(currentDir);
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        scan(fullPath);
      } else if (pattern.test(entry)) {
        files.push(fullPath);
      }
    }
  }
  
  scan(dir);
  return files;
}

async function syncWorkflowReferences(workflowsDir: string): Promise<number> {
  console.log('Fetching workflows from n8n...');
  const n8nWorkflows = await exportWorkflows();
  console.log(`✓ Fetched ${n8nWorkflows.length} workflows\n`);
  
  const n8nNameToId = new Map<string, string>();
  n8nWorkflows.forEach(wf => n8nNameToId.set(wf.name, wf.id));
  
  const workflowFiles = getAllWorkflowFiles(workflowsDir, /\.json$/);
  let fixedCount = 0;
  
  for (const filePath of workflowFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const workflow: Workflow = JSON.parse(content);
      let modified = false;
      
      for (const node of workflow.nodes) {
        if (node.type === '@n8n/n8n-nodes-langchain.toolWorkflow') {
          const workflowId = node.parameters?.workflowId;
          
          if (workflowId?.value && workflowId?.cachedResultName) {
            const referencedName = workflowId.cachedResultName;
            const currentId = workflowId.value;
            const n8nId = n8nNameToId.get(referencedName);
            
            if (n8nId && currentId !== n8nId) {
              workflowId.value = n8nId;
              workflowId.cachedResultUrl = `/workflow/${n8nId}`;
              modified = true;
              fixedCount++;
            }
          }
        }
      }
      
      if (modified) {
        fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2) + '\n', 'utf-8');
      }
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }
  
  return fixedCount;
}

async function main() {
  const workflowsDir = path.join(__dirname, '..', 'workflows');
  
  console.log('\x1b[1m🔄 Post-Backup Sync\x1b[0m\n');
  
  // Step 1: Find and remove duplicate " (2).json" files
  console.log('Step 1: Removing duplicate " (2).json" files...');
  const duplicates = getAllWorkflowFiles(workflowsDir, / \(2\)\.json$/);
  
  if (duplicates.length > 0) {
    console.log(`Found ${duplicates.length} duplicate files:`);
    for (const dup of duplicates) {
      const relativePath = path.relative(workflowsDir, dup);
      console.log(`  - ${relativePath}`);
      fs.unlinkSync(dup);
    }
    console.log(`✓ Removed ${duplicates.length} duplicate files\n`);
  } else {
    console.log('✓ No duplicate files found\n');
  }
  
  // Step 2: Sync workflow IDs
  console.log('Step 2: Syncing workflow IDs from n8n...');
  const fixedCount = await syncWorkflowReferences(workflowsDir);
  
  if (fixedCount > 0) {
    console.log(`✓ Fixed ${fixedCount} workflow references\n`);
  } else {
    console.log('✓ All references already correct\n');
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

