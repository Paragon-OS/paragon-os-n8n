#!/usr/bin/env ts-node

/**
 * Fix stale workflow ID references
 * 
 * Automatically fixes common stale workflow ID references based on known mappings
 */

import * as fs from 'fs';
import * as path from 'path';

interface Workflow {
  id: string;
  name: string;
  nodes: any[];
}

// Known ID mappings: oldId -> newId
const ID_MAPPINGS: Record<string, string> = {
  // Global Cache System
  'npaYRLfYn6TYFhMb': 'tfSCD7ysSOdQZac1',
  
  // MCP Data Normalizer
  'a4RRtQ8i7NB8Yvvn': 'GIW9StT6wLqEJ4bU',
  
  // Generic Context Scout Core
  'Co0F1S4ew57zA2j2': '3oWOf1fvT3tYjvwF',
  
  // Dynamic RAG
  'dmfZW5pOm7xzVmM1': 'jUGz7J644cDACNhG',
  
  // Test Data
  '5Lmo7lOjdgXnKSM9': 'IKM2EmRmQO5jE8HR',
  
  // Discord workflows
  'wSwSWVkFCAIttXrq': 'JateTZIxaU5RpWd1', // Discord Contact Fetch
  'g3Qahj6Nh8AbtyLd': 'ssmSNWi9AiLqCa5o', // Discord Guild Fetch
  'e2rF6uyFyeDRyOUT': 'D1eAnmpn6Fs0H0dI', // Discord Tool Fetch
  'N7EIByrRRNAdKcxR': 'cRUgh0Bgi661d30i', // Discord Profile Fetch
  
  // Telegram workflows
  'wik6TtHPOdmqMDj4': 'da8V1scDP9mbcFUV', // Telegram Chat Fetch
  'SXxUoB4mbMLdKgaq': 'G2KBXZbPvdSBpOzW', // Telegram Tool Fetch
  '0O6vb0bzZBh8KmhH': '6kVCZeJHVvDd2Z2B', // Telegram Profile Fetch
  '0c7rvvnr3iITGCoG': 'XMb1RsZrRBf4G0PI', // Telegram Message Fetch
  
  // Smart Agents
  'nZTUa5bPxY6Ft6er': 'R5zBSutw5eVSURyz', // Telegram Smart Agent
  
  // Step Executor
  'uoYXevOl4ePWKeNx': 'HPTijhww7cLOzHRU', // Discord & Telegram Step Executor
  
  // Context Enrichers
  'zBL0JT7t26pK2x95': 'ieeGOfzLVxw1eXwc', // Discord Context Enricher
  'WFlhiFmm1Tt6ICRM': 'FoUczbmJALfx29t3', // Telegram Context Enricher (if exists)
  
  // Test Runner references
  'neiUMoN5ABLkLukN': 'Bwantxu38HCUo5tm', // Telegram Context Scout
  'BB1zsros5LmyJO9N': 'Cah2fzzIE8UrrNKJ', // Discord Context Scout
};

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

function fixWorkflowReferences(filePath: string, dryRun: boolean = true): { fixed: number; modified: boolean } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const workflow: any = JSON.parse(content);
  let fixed = 0;
  let modified = false;
  
  // Fix Execute Workflow nodes
  for (const node of workflow.nodes || []) {
    if (node.type === 'n8n-nodes-base.executeWorkflow') {
      const workflowId = node.parameters?.workflowId;
      if (workflowId?.value && ID_MAPPINGS[workflowId.value]) {
        const oldId = workflowId.value;
        const newId = ID_MAPPINGS[oldId];
        
        if (!dryRun) {
          workflowId.value = newId;
          if (workflowId.cachedResultUrl) {
            workflowId.cachedResultUrl = `/workflow/${newId}`;
          }
        }
        fixed++;
        modified = true;
      }
    }
    
    // Fix Tool Workflow nodes
    if (node.type === '@n8n/n8n-nodes-langchain.toolWorkflow') {
      const workflowId = node.parameters?.workflowId;
      if (workflowId?.value && ID_MAPPINGS[workflowId.value]) {
        const oldId = workflowId.value;
        const newId = ID_MAPPINGS[oldId];
        
        if (!dryRun) {
          workflowId.value = newId;
          if (workflowId.cachedResultUrl) {
            workflowId.cachedResultUrl = `/workflow/${newId}`;
          }
        }
        fixed++;
        modified = true;
      }
    }
    
    // Fix JavaScript code strings
    if (node.type === 'n8n-nodes-base.code' && node.parameters?.jsCode) {
      let jsCode = node.parameters.jsCode;
      let codeModified = false;
      
      for (const [oldId, newId] of Object.entries(ID_MAPPINGS)) {
        if (jsCode.includes(oldId)) {
          // Replace fetchWorkflowId: "oldId" with fetchWorkflowId: "newId"
          jsCode = jsCode.replace(
            new RegExp(`fetchWorkflowId:\\s*["']${oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'g'),
            `fetchWorkflowId: "${newId}"`
          );
          codeModified = true;
        }
      }
      
      if (codeModified) {
        if (!dryRun) {
          node.parameters.jsCode = jsCode;
        }
        fixed++;
        modified = true;
      }
    }
  }
  
  if (modified && !dryRun) {
    fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2) + '\n', 'utf-8');
  }
  
  return { fixed, modified };
}

function main() {
  const workflowsDir = path.join(__dirname, '..', 'workflows');
  const workflowFiles = getAllWorkflowFiles(workflowsDir);
  const dryRun = process.argv.includes('--apply') === false;
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be modified');
    console.log('   Use --apply to actually fix the files\n');
  } else {
    console.log('🔧 APPLY MODE - Files will be modified\n');
  }
  
  let totalFixed = 0;
  let filesModified = 0;
  
  for (const filePath of workflowFiles) {
    try {
      const { fixed, modified } = fixWorkflowReferences(filePath, dryRun);
      if (fixed > 0) {
        const relativePath = path.relative(workflowsDir, filePath);
        console.log(`📄 ${relativePath}`);
        console.log(`   Fixed ${fixed} reference(s)`);
        if (modified) {
          filesModified++;
        }
        totalFixed += fixed;
      }
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  if (dryRun) {
    console.log(`\n✅ Would fix ${totalFixed} reference(s) in ${filesModified} file(s)`);
    console.log('   Run with --apply to actually apply the fixes');
  } else {
    console.log(`\n✅ Fixed ${totalFixed} reference(s) in ${filesModified} file(s)`);
  }
}

main();

