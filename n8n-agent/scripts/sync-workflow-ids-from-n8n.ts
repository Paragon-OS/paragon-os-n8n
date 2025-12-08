#!/usr/bin/env ts-node

/**
 * Sync workflow IDs from live n8n instance
 * 
 * This script:
 * 1. Fetches all workflows from the running n8n instance via API
 * 2. Builds a map of workflow names to their ACTUAL IDs in n8n
 * 3. Updates all toolWorkflow references in local files to match n8n's IDs
 * 
 * This solves the problem where n8n assigns new IDs on restore,
 * making local file references stale.
 */

import * as fs from 'fs';
import * as path from 'path';
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

async function syncWorkflowIds(workflowsDir: string, dryRun: boolean = true): Promise<{ synced: number; notFound: number }> {
  console.log('Fetching workflows from n8n API...\n');
  
  // Fetch workflows from n8n
  let n8nWorkflows;
  try {
    n8nWorkflows = await exportWorkflows();
  } catch (error) {
    console.error('\x1b[31m❌ Failed to fetch workflows from n8n:\x1b[0m');
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    } else {
      console.error(`   ${error}`);
    }
    console.error('\n\x1b[33mMake sure:\x1b[0m');
    console.error('  1. n8n is running');
    console.error('  2. N8N_BASE_URL is set in your environment or .env file');
    console.error('  3. N8N_API_KEY or session cookie is configured');
    console.error('\nExample .env:');
    console.error('  N8N_BASE_URL=http://localhost:5678');
    console.error('  N8N_API_KEY=your-api-key-here');
    process.exit(1);
  }
  
  console.log(`✓ Fetched ${n8nWorkflows.length} workflows from n8n\n`);
  
  // Build name -> ID map from n8n
  const n8nNameToId = new Map<string, string>();
  n8nWorkflows.forEach(wf => {
    n8nNameToId.set(wf.name, wf.id);
  });
  
  // Get local workflow files
  const workflowFiles = getAllWorkflowFiles(workflowsDir);
  let syncedCount = 0;
  let notFoundCount = 0;
  
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
            
            if (n8nId) {
              if (currentId !== n8nId) {
                console.log(`\x1b[33m[SYNC]\x1b[0m ${workflow.name}`);
                console.log(`  Node: "${node.name}"`);
                console.log(`  Target: ${referencedName}`);
                console.log(`  Local ID:  ${currentId}`);
                console.log(`  n8n ID:    \x1b[32m${n8nId}\x1b[0m`);
                
                if (!dryRun) {
                  workflowId.value = n8nId;
                  workflowId.cachedResultUrl = `/workflow/${n8nId}`;
                  modified = true;
                }
                syncedCount++;
                console.log('');
              }
            } else {
              console.log(`\x1b[31m[NOT FOUND]\x1b[0m ${workflow.name}`);
              console.log(`  Node: "${node.name}"`);
              console.log(`  Target: "${referencedName}" not found in n8n!`);
              console.log(`  Current ID: ${currentId}`);
              console.log('');
              notFoundCount++;
            }
          }
        }
      }
      
      if (modified && !dryRun) {
        fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2) + '\n', 'utf-8');
        console.log(`\x1b[32m✓ Saved: ${path.relative(workflowsDir, filePath)}\x1b[0m\n`);
      }
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }
  
  return { synced: syncedCount, notFound: notFoundCount };
}

async function main() {
  const workflowsDir = path.join(__dirname, '..', 'workflows');
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--sync');
  
  if (dryRun) {
    console.log('\x1b[1m🔍 DRY RUN MODE - No changes will be made\x1b[0m');
    console.log('Run with --sync flag to apply changes\n');
  } else {
    console.log('\x1b[1m🔄 SYNC MODE - Changes will be applied\x1b[0m\n');
  }
  
  const { synced, notFound } = await syncWorkflowIds(workflowsDir, dryRun);
  
  console.log('\x1b[1mSUMMARY:\x1b[0m');
  if (dryRun) {
    console.log(`  Workflows that need syncing: ${synced}`);
  } else {
    console.log(`  \x1b[32mWorkflows synced: ${synced}\x1b[0m`);
  }
  console.log(`  \x1b[31mWorkflows not found in n8n: ${notFound}\x1b[0m`);
  
  if (dryRun && synced > 0) {
    console.log(`\n\x1b[33mRun with --sync to apply changes:\x1b[0m`);
    console.log(`  npx ts-node scripts/sync-workflow-ids-from-n8n.ts --sync`);
  } else if (!dryRun && synced > 0) {
    console.log(`\n\x1b[32m✓ ${synced} workflow reference(s) synced with n8n!\x1b[0m`);
    console.log(`\n\x1b[33mRun validation to verify:\x1b[0m`);
    console.log(`  npx ts-node scripts/validate-tool-workflow-references.ts`);
  } else if (synced === 0 && notFound === 0) {
    console.log(`\n\x1b[32m✓ All workflow references are already in sync with n8n!\x1b[0m`);
  }
  
  if (notFound > 0) {
    console.log(`\n\x1b[31m⚠️  ${notFound} referenced workflow(s) not found in n8n.\x1b[0m`);
    console.log(`These workflows may need to be restored to n8n first.`);
  }
}

main().catch(error => {
  console.error('\x1b[31mFatal error:\x1b[0m', error);
  process.exit(1);
});

