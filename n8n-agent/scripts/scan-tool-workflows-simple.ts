#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';

interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  parameters?: {
    workflowId?: {
      value?: string;
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

function main() {
  const workflowsDir = path.join(__dirname, '..', 'workflows');
  const workflowFiles = getAllWorkflowFiles(workflowsDir);
  
  console.log('Target Workflow IDs referenced by toolWorkflow nodes:\n');
  
  const targetIds = new Set<string>();
  
  for (const filePath of workflowFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const workflow: Workflow = JSON.parse(content);
      
      const toolWorkflowNodes = workflow.nodes.filter(
        node => node.type === '@n8n/n8n-nodes-langchain.toolWorkflow'
      );
      
      for (const node of toolWorkflowNodes) {
        const targetWorkflowId = node.parameters?.workflowId?.value;
        if (targetWorkflowId) {
          targetIds.add(targetWorkflowId);
        }
      }
    } catch (error) {
      // Skip invalid files
    }
  }
  
  const sortedIds = Array.from(targetIds).sort();
  sortedIds.forEach(id => console.log(id));
  
  console.log(`\nTotal: ${sortedIds.length} unique workflow IDs`);
}

main();

