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

interface ToolWorkflowReference {
  sourceWorkflowId: string;
  sourceWorkflowName: string;
  sourceWorkflowFile: string;
  toolNodeId: string;
  toolNodeName: string;
  targetWorkflowId: string;
  targetWorkflowName: string;
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

function scanToolWorkflows(workflowsDir: string): ToolWorkflowReference[] {
  const workflowFiles = getAllWorkflowFiles(workflowsDir);
  const references: ToolWorkflowReference[] = [];
  
  for (const filePath of workflowFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const workflow: Workflow = JSON.parse(content);
      
      // Find all toolWorkflow nodes
      const toolWorkflowNodes = workflow.nodes.filter(
        node => node.type === '@n8n/n8n-nodes-langchain.toolWorkflow'
      );
      
      for (const node of toolWorkflowNodes) {
        const targetWorkflowId = node.parameters?.workflowId?.value;
        const targetWorkflowName = node.parameters?.workflowId?.cachedResultName || 'Unknown';
        
        if (targetWorkflowId) {
          references.push({
            sourceWorkflowId: workflow.id,
            sourceWorkflowName: workflow.name,
            sourceWorkflowFile: path.relative(workflowsDir, filePath),
            toolNodeId: node.id,
            toolNodeName: node.name,
            targetWorkflowId,
            targetWorkflowName
          });
        }
      }
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }
  
  return references;
}

function main() {
  const workflowsDir = path.join(__dirname, '..', 'workflows');
  
  console.log('Scanning for @n8n/n8n-nodes-langchain.toolWorkflow nodes...\n');
  
  const references = scanToolWorkflows(workflowsDir);
  
  if (references.length === 0) {
    console.log('No toolWorkflow nodes found.');
    return;
  }
  
  console.log(`Found ${references.length} toolWorkflow node(s):\n`);
  
  // Group by source workflow
  const groupedBySource = references.reduce((acc, ref) => {
    if (!acc[ref.sourceWorkflowId]) {
      acc[ref.sourceWorkflowId] = [];
    }
    acc[ref.sourceWorkflowId].push(ref);
    return acc;
  }, {} as Record<string, ToolWorkflowReference[]>);
  
  // Print grouped results
  for (const [sourceId, refs] of Object.entries(groupedBySource)) {
    const firstRef = refs[0];
    console.log(`\x1b[1m${firstRef.sourceWorkflowName}\x1b[0m`);
    console.log(`  File: ${firstRef.sourceWorkflowFile}`);
    console.log(`  Workflow ID: ${sourceId}`);
    console.log(`  Tool Nodes (${refs.length}):`);
    
    for (const ref of refs) {
      console.log(`    - \x1b[36m${ref.toolNodeName}\x1b[0m`);
      console.log(`      Node ID: ${ref.toolNodeId}`);
      console.log(`      → Target: ${ref.targetWorkflowName}`);
      console.log(`      → Target ID: \x1b[33m${ref.targetWorkflowId}\x1b[0m`);
    }
    console.log('');
  }
  
  // Print summary of unique target workflows
  console.log('\n\x1b[1mSummary of Target Workflows:\x1b[0m');
  const uniqueTargets = new Map<string, string>();
  references.forEach(ref => {
    uniqueTargets.set(ref.targetWorkflowId, ref.targetWorkflowName);
  });
  
  for (const [id, name] of uniqueTargets) {
    const count = references.filter(r => r.targetWorkflowId === id).length;
    console.log(`  \x1b[33m${id}\x1b[0m - ${name} (referenced ${count} time(s))`);
  }
}

main();

