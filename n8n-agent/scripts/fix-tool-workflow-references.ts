#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';

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

function buildWorkflowMaps(workflowsDir: string) {
  const workflowFiles = getAllWorkflowFiles(workflowsDir);
  const idMap = new Map<string, { name: string; file: string }>();
  const nameMap = new Map<string, string>(); // name -> id
  
  for (const filePath of workflowFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const workflow: Workflow = JSON.parse(content);
      idMap.set(workflow.id, {
        name: workflow.name,
        file: filePath
      });
      nameMap.set(workflow.name, workflow.id);
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }
  
  return { idMap, nameMap };
}

function findWorkflowByName(nameMap: Map<string, string>, searchName: string): string | null {
  // Try exact match first
  if (nameMap.has(searchName)) {
    return nameMap.get(searchName)!;
  }
  
  // Try with [LAB] prefix
  const labName = `[LAB] ${searchName}`;
  if (nameMap.has(labName)) {
    return nameMap.get(labName)!;
  }
  
  // Try with [HELPERS] prefix
  const helpersName = `[HELPERS] ${searchName}`;
  if (nameMap.has(helpersName)) {
    return nameMap.get(helpersName)!;
  }
  
  // Try with [LEGACY] prefix
  const legacyName = `[LEGACY] ${searchName}`;
  if (nameMap.has(legacyName)) {
    return nameMap.get(legacyName)!;
  }
  
  return null;
}

function fixWorkflowReferences(workflowsDir: string, dryRun: boolean = true): { fixed: number; unfixable: number } {
  const { idMap, nameMap } = buildWorkflowMaps(workflowsDir);
  const workflowFiles = getAllWorkflowFiles(workflowsDir);
  let fixedCount = 0;
  let unfixableCount = 0;
  
  for (const filePath of workflowFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const workflow: Workflow = JSON.parse(content);
      let modified = false;
      
      for (const node of workflow.nodes) {
        if (node.type === '@n8n/n8n-nodes-langchain.toolWorkflow') {
          const workflowId = node.parameters?.workflowId;
          
          if (workflowId?.value) {
            const referencedId = workflowId.value;
            const referencedName = workflowId.cachedResultName;
            
            // Check if the referenced ID exists
            if (!idMap.has(referencedId)) {
              // Try to find by name (with various prefixes)
              if (referencedName) {
                const correctId = findWorkflowByName(nameMap, referencedName);
                
                if (correctId) {
                  const correctName = idMap.get(correctId)!.name;
                  console.log(`\x1b[33m[FIX]\x1b[0m ${workflow.name}`);
                  console.log(`  Node: "${node.name}"`);
                  console.log(`  Old ID: ${referencedId} (BROKEN)`);
                  console.log(`  New ID: ${correctId}`);
                  console.log(`  Target: ${correctName}`);
                  
                  if (!dryRun) {
                    workflowId.value = correctId;
                    workflowId.cachedResultUrl = `/workflow/${correctId}`;
                    workflowId.cachedResultName = correctName;
                    modified = true;
                    fixedCount++;
                  } else {
                    fixedCount++;
                  }
                  console.log('');
                } else {
                  console.log(`\x1b[31m[UNFIXABLE]\x1b[0m ${workflow.name}`);
                  console.log(`  Node: "${node.name}"`);
                  console.log(`  Referenced workflow "${referencedName}" not found!`);
                  console.log(`  (Tried: "${referencedName}", "[LAB] ${referencedName}", "[HELPERS] ${referencedName}", "[LEGACY] ${referencedName}")`);
                  console.log('');
                  unfixableCount++;
                }
              } else {
                console.log(`\x1b[31m[UNFIXABLE]\x1b[0m ${workflow.name}`);
                console.log(`  Node: "${node.name}"`);
                console.log(`  No cached result name available`);
                console.log('');
                unfixableCount++;
              }
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
  
  return { fixed: fixedCount, unfixable: unfixableCount };
}

function main() {
  const workflowsDir = path.join(__dirname, '..', 'workflows');
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--fix');
  
  if (dryRun) {
    console.log('\x1b[1m🔍 DRY RUN MODE - No changes will be made\x1b[0m');
    console.log('Run with --fix flag to apply changes\n');
  } else {
    console.log('\x1b[1m🔧 FIX MODE - Changes will be applied\x1b[0m\n');
  }
  
  const { fixed, unfixable } = fixWorkflowReferences(workflowsDir, dryRun);
  
  console.log('\x1b[1mSUMMARY:\x1b[0m');
  console.log(`  \x1b[32mFixable: ${fixed}\x1b[0m`);
  console.log(`  \x1b[31mUnfixable: ${unfixable}\x1b[0m`);
  
  if (dryRun && fixed > 0) {
    console.log(`\n\x1b[33mRun with --fix to apply changes:\x1b[0m`);
    console.log(`  npx ts-node scripts/fix-tool-workflow-references.ts --fix`);
  } else if (!dryRun && fixed > 0) {
    console.log(`\n\x1b[32m✓ ${fixed} reference(s) fixed!\x1b[0m`);
    console.log(`\n\x1b[33mRun validation to verify:\x1b[0m`);
    console.log(`  npx ts-node scripts/validate-tool-workflow-references.ts`);
  }
  
  if (unfixable > 0) {
    console.log(`\n\x1b[31m⚠️  ${unfixable} reference(s) could not be fixed automatically.\x1b[0m`);
    console.log(`These workflows may need to be restored or the references removed manually.`);
  }
}

main();
