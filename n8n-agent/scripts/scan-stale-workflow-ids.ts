#!/usr/bin/env ts-node

/**
 * Scan for stale workflow ID references
 * 
 * Finds workflow IDs that are referenced but don't match actual workflow files:
 * 1. Execute Workflow nodes
 * 2. Tool Workflow nodes  
 * 3. JavaScript code strings (fetchWorkflowId patterns)
 */

import * as fs from 'fs';
import * as path from 'path';

interface Workflow {
  id: string;
  name: string;
  nodes: any[];
}

interface StaleReference {
  sourceFile: string;
  sourceWorkflowName: string;
  referenceType: 'executeWorkflow' | 'toolWorkflow' | 'jsCode';
  nodeName?: string;
  staleId: string;
  expectedName?: string;
  lineContext?: string;
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
  const idMap = new Map<string, { name: string; file: string }>();
  
  for (const filePath of workflowFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const workflow: Workflow = JSON.parse(content);
      
      if (workflow.id && workflow.name) {
        idMap.set(workflow.id, {
          name: workflow.name,
          file: path.relative(workflowsDir, filePath)
        });
      }
    } catch (error) {
      // Skip invalid files
    }
  }
  
  return idMap;
}

function extractWorkflowIdsFromJsCode(jsCode: string): string[] {
  const ids: string[] = [];
  
  // Pattern: fetchWorkflowId: "ID"
  const fetchWorkflowIdPattern = /fetchWorkflowId:\s*["']([A-Za-z0-9_-]{10,21})["']/g;
  let match;
  while ((match = fetchWorkflowIdPattern.exec(jsCode)) !== null) {
    ids.push(match[1]);
  }
  
  return ids;
}

function scanForStaleReferences(workflowsDir: string): StaleReference[] {
  const workflowFiles = getAllWorkflowFiles(workflowsDir);
  const workflowMap = buildWorkflowMap(workflowsDir);
  const staleRefs: StaleReference[] = [];
  
  for (const filePath of workflowFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const workflow: Workflow = JSON.parse(content);
      const relativePath = path.relative(workflowsDir, filePath);
      
      for (const node of workflow.nodes) {
        // Check Execute Workflow nodes
        if (node.type === 'n8n-nodes-base.executeWorkflow') {
          const workflowId = node.parameters?.workflowId;
          if (workflowId?.value) {
            const referencedId = workflowId.value;
            if (!workflowMap.has(referencedId)) {
              staleRefs.push({
                sourceFile: relativePath,
                sourceWorkflowName: workflow.name,
                referenceType: 'executeWorkflow',
                nodeName: node.name,
                staleId: referencedId,
                expectedName: workflowId.cachedResultName
              });
            }
          }
        }
        
        // Check Tool Workflow nodes
        if (node.type === '@n8n/n8n-nodes-langchain.toolWorkflow') {
          const workflowId = node.parameters?.workflowId;
          if (workflowId?.value) {
            const referencedId = workflowId.value;
            if (!workflowMap.has(referencedId)) {
              staleRefs.push({
                sourceFile: relativePath,
                sourceWorkflowName: workflow.name,
                referenceType: 'toolWorkflow',
                nodeName: node.name,
                staleId: referencedId,
                expectedName: workflowId.cachedResultName
              });
            }
          }
        }
        
        // Check JavaScript code strings
        if (node.type === 'n8n-nodes-base.code' && node.parameters?.jsCode) {
          const jsCode = node.parameters.jsCode;
          const referencedIds = extractWorkflowIdsFromJsCode(jsCode);
          
          for (const referencedId of referencedIds) {
            if (!workflowMap.has(referencedId)) {
              // Try to find context line
              const lines = jsCode.split('\n');
              const contextLine = lines.find((line: string) => line.includes(referencedId)) || '';
              
              staleRefs.push({
                sourceFile: relativePath,
                sourceWorkflowName: workflow.name,
                referenceType: 'jsCode',
                nodeName: node.name,
                staleId: referencedId,
                lineContext: contextLine.trim().substring(0, 100)
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }
  
  return staleRefs;
}

function findWorkflowByName(workflowMap: Map<string, { name: string; file: string }>, searchName: string): string | null {
  // Try exact match first
  for (const [id, info] of workflowMap.entries()) {
    if (info.name === searchName) {
      return id;
    }
  }
  
  // Try partial match (remove brackets/prefixes)
  const normalizedSearch = searchName.replace(/^\[.*?\]\s*/, '').toLowerCase();
  for (const [id, info] of workflowMap.entries()) {
    const normalizedInfo = info.name.replace(/^\[.*?\]\s*/, '').toLowerCase();
    if (normalizedInfo === normalizedSearch || normalizedInfo.includes(normalizedSearch) || normalizedSearch.includes(normalizedInfo)) {
      return id;
    }
  }
  
  return null;
}

function main() {
  const workflowsDir = path.join(__dirname, '..', 'workflows');
  const workflowMap = buildWorkflowMap(workflowsDir);
  const staleRefs = scanForStaleReferences(workflowsDir);
  
  console.log('='.repeat(80));
  console.log('STALE WORKFLOW ID REFERENCES SCAN');
  console.log('='.repeat(80));
  console.log(`\nTotal workflows found: ${workflowMap.size}`);
  console.log(`Stale references found: ${staleRefs.length}\n`);
  
  if (staleRefs.length === 0) {
    console.log('✅ No stale workflow ID references found!');
    return;
  }
  
  // Group by reference type
  const byType = {
    executeWorkflow: staleRefs.filter(r => r.referenceType === 'executeWorkflow'),
    toolWorkflow: staleRefs.filter(r => r.referenceType === 'toolWorkflow'),
    jsCode: staleRefs.filter(r => r.referenceType === 'jsCode')
  };
  
  // Execute Workflow nodes
  if (byType.executeWorkflow.length > 0) {
    console.log('\n🔴 STALE REFERENCES IN EXECUTE WORKFLOW NODES:');
    console.log('-'.repeat(80));
    for (const ref of byType.executeWorkflow) {
      console.log(`\n📄 ${ref.sourceFile}`);
      console.log(`   Workflow: ${ref.sourceWorkflowName}`);
      console.log(`   Node: "${ref.nodeName}"`);
      console.log(`   Stale ID: ${ref.staleId}`);
      if (ref.expectedName) {
        const correctId = findWorkflowByName(workflowMap, ref.expectedName);
        if (correctId) {
          console.log(`   ✅ Should be: ${correctId} (${ref.expectedName})`);
        } else {
          console.log(`   ⚠️  Expected name: ${ref.expectedName} (not found in workflows)`);
        }
      }
    }
  }
  
  // Tool Workflow nodes
  if (byType.toolWorkflow.length > 0) {
    console.log('\n🔴 STALE REFERENCES IN TOOL WORKFLOW NODES:');
    console.log('-'.repeat(80));
    for (const ref of byType.toolWorkflow) {
      console.log(`\n📄 ${ref.sourceFile}`);
      console.log(`   Workflow: ${ref.sourceWorkflowName}`);
      console.log(`   Node: "${ref.nodeName}"`);
      console.log(`   Stale ID: ${ref.staleId}`);
      if (ref.expectedName) {
        const correctId = findWorkflowByName(workflowMap, ref.expectedName);
        if (correctId) {
          console.log(`   ✅ Should be: ${correctId} (${ref.expectedName})`);
        } else {
          console.log(`   ⚠️  Expected name: ${ref.expectedName} (not found in workflows)`);
        }
      }
    }
  }
  
  // JavaScript code strings
  if (byType.jsCode.length > 0) {
    console.log('\n🔴 STALE REFERENCES IN JAVASCRIPT CODE:');
    console.log('-'.repeat(80));
    for (const ref of byType.jsCode) {
      console.log(`\n📄 ${ref.sourceFile}`);
      console.log(`   Workflow: ${ref.sourceWorkflowName}`);
      console.log(`   Node: "${ref.nodeName}"`);
      console.log(`   Stale ID: ${ref.staleId}`);
      if (ref.lineContext) {
        console.log(`   Context: ${ref.lineContext}`);
      }
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log(`\nTotal issues found: ${staleRefs.length}`);
  console.log('\n💡 Tip: Use workflow names to find the correct IDs, then update the references.');
}

main();

