#!/usr/bin/env ts-node
/**
 * Force n8n to regenerate cachedResultUrl fields in toolWorkflow nodes
 * 
 * This script:
 * 1. Fetches workflows from n8n via API
 * 2. Identifies toolWorkflow nodes with missing or incomplete cachedResultUrl
 * 3. Re-saves the workflow via API to force n8n to regenerate the fields
 * 
 * This is the "proper" way to fix the issue, as it lets n8n handle the field generation.
 */

import { getWorkflow, importWorkflow, exportWorkflows, type Workflow } from '../src/utils/n8n-api';
import { logger } from '../src/utils/logger';

interface WorkflowIdReference {
  __rl?: boolean;
  mode?: 'list' | 'id';
  value?: string;
  cachedResultName?: string;
  cachedResultUrl?: string;
}

interface Node {
  id: string;
  name: string;
  type: string;
  parameters?: {
    workflowId?: WorkflowIdReference;
    [key: string]: unknown;
  };
}

async function regenerateCachedUrls() {
  console.log('🔄 Forcing n8n to regenerate cachedResultUrl fields...\n');
  
  try {
    // Get all workflows from n8n
    const workflows = await exportWorkflows();
    
    let totalFixed = 0;
    const fixedWorkflows: string[] = [];
    
    for (const workflow of workflows) {
      // workflow is already the full workflow object from exportWorkflows
      
      if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
        continue;
      }
      
      let needsRegeneration = false;
      const issuesFound: string[] = [];
      
      // Check for toolWorkflow nodes with missing cachedResultUrl
      for (const node of workflow.nodes as Node[]) {
        if (node.type === '@n8n/n8n-nodes-langchain.toolWorkflow' && node.parameters?.workflowId) {
          const workflowId = node.parameters.workflowId;
          
          if (workflowId.__rl && workflowId.value && !workflowId.cachedResultUrl) {
            needsRegeneration = true;
            issuesFound.push(`  - Node "${node.name}": missing cachedResultUrl for workflow ${workflowId.value}`);
          }
        }
      }
      
      if (needsRegeneration) {
        console.log(`📝 Found issues in workflow: ${workflow.name}`);
        issuesFound.forEach(issue => console.log(issue));
        
        try {
          // Re-save the workflow to force n8n to regenerate fields
          // The importWorkflow function will use PUT to update the existing workflow
          // Pass undefined for config, false for forceCreate, workflow.id for existingWorkflowId
          await importWorkflow(workflow, undefined, false, workflow.id);
          
          console.log(`   ✅ Re-saved workflow - n8n should regenerate cachedResultUrl\n`);
          totalFixed++;
          fixedWorkflows.push(workflow.name);
        } catch (error) {
          console.error(`   ❌ Failed to re-save workflow: ${error}`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`✨ Triggered regeneration for ${totalFixed} workflow(s)`);
    
    if (fixedWorkflows.length > 0) {
      console.log('\n📋 Updated workflows:');
      fixedWorkflows.forEach(name => console.log(`   - ${name}`));
      console.log('\n✅ n8n should have regenerated the cachedResultUrl fields');
      console.log('💡 You may want to verify by checking the workflows in the UI');
    } else {
      console.log('\n✅ No issues found - all toolWorkflow nodes have cachedResultUrl');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

// Run the regeneration
regenerateCachedUrls().catch(error => {
  logger.error('Failed to regenerate cached URLs:', error);
  process.exit(1);
});

