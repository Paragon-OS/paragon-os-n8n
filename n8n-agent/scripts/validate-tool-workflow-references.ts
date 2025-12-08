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

function buildWorkflowMap(workflowsDir: string): Map<string, { name: string; file: string }> {
  const workflowFiles = getAllWorkflowFiles(workflowsDir);
  const workflowMap = new Map<string, { name: string; file: string }>();
  
  for (const filePath of workflowFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const workflow: Workflow = JSON.parse(content);
      workflowMap.set(workflow.id, {
        name: workflow.name,
        file: path.relative(workflowsDir, filePath)
      });
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }
  
  return workflowMap;
}

function scanToolWorkflows(workflowsDir: string): ToolWorkflowReference[] {
  const workflowFiles = getAllWorkflowFiles(workflowsDir);
  const references: ToolWorkflowReference[] = [];
  
  for (const filePath of workflowFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const workflow: Workflow = JSON.parse(content);
      
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
  
  console.log('Validating toolWorkflow references...\n');
  
  // Build map of all actual workflow IDs
  const workflowMap = buildWorkflowMap(workflowsDir);
  
  console.log(`Found ${workflowMap.size} workflows in total\n`);
  
  // Scan all tool workflow references
  const references = scanToolWorkflows(workflowsDir);
  
  console.log(`Found ${references.length} toolWorkflow references\n`);
  
  // Validate each reference
  const brokenReferences: ToolWorkflowReference[] = [];
  const validReferences: ToolWorkflowReference[] = [];
  
  for (const ref of references) {
    if (workflowMap.has(ref.targetWorkflowId)) {
      validReferences.push(ref);
    } else {
      brokenReferences.push(ref);
    }
  }
  
  // Report broken references
  if (brokenReferences.length > 0) {
    console.log(`\x1b[31m❌ BROKEN REFERENCES (${brokenReferences.length}):\x1b[0m\n`);
    
    for (const ref of brokenReferences) {
      console.log(`\x1b[1m${ref.sourceWorkflowName}\x1b[0m (${ref.sourceWorkflowFile})`);
      console.log(`  Tool Node: "${ref.toolNodeName}"`);
      console.log(`  \x1b[31m→ References MISSING workflow ID: ${ref.targetWorkflowId}\x1b[0m`);
      console.log(`  → Expected workflow name: "${ref.targetWorkflowName}"`);
      
      // Try to find a workflow with matching name
      const matchingWorkflows = Array.from(workflowMap.entries())
        .filter(([_, info]) => info.name === ref.targetWorkflowName);
      
      if (matchingWorkflows.length > 0) {
        console.log(`  \x1b[33m💡 Found workflow with matching name:\x1b[0m`);
        for (const [id, info] of matchingWorkflows) {
          console.log(`     Actual ID: ${id} (${info.file})`);
        }
      } else {
        console.log(`  \x1b[33m💡 No workflow found with name "${ref.targetWorkflowName}"\x1b[0m`);
      }
      console.log('');
    }
  }
  
  // Report valid references
  if (validReferences.length > 0) {
    console.log(`\x1b[32m✓ VALID REFERENCES (${validReferences.length}):\x1b[0m\n`);
    
    const grouped = validReferences.reduce((acc, ref) => {
      if (!acc[ref.targetWorkflowId]) {
        acc[ref.targetWorkflowId] = [];
      }
      acc[ref.targetWorkflowId].push(ref);
      return acc;
    }, {} as Record<string, ToolWorkflowReference[]>);
    
    for (const [targetId, refs] of Object.entries(grouped)) {
      const targetInfo = workflowMap.get(targetId)!;
      console.log(`  \x1b[32m${targetId}\x1b[0m - ${targetInfo.name} (${refs.length} reference(s))`);
    }
  }
  
  // Summary
  console.log(`\n\x1b[1mSUMMARY:\x1b[0m`);
  console.log(`  Total workflows: ${workflowMap.size}`);
  console.log(`  Total toolWorkflow nodes: ${references.length}`);
  console.log(`  \x1b[32mValid references: ${validReferences.length}\x1b[0m`);
  console.log(`  \x1b[31mBroken references: ${brokenReferences.length}\x1b[0m`);
  
  if (brokenReferences.length > 0) {
    console.log(`\n\x1b[33m⚠️  You have broken workflow references that need to be fixed!\x1b[0m`);
    process.exit(1);
  } else {
    console.log(`\n\x1b[32m✓ All references are valid!\x1b[0m`);
  }
}

main();

