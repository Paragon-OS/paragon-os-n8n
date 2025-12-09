/**
 * Convert Execute Workflow node references to use workflow IDs
 * Updates references to use current n8n database IDs in the value field
 */

import { logger } from './logger';
import { exportWorkflows, type Workflow } from './n8n-api';

/**
 * Convert Execute Workflow node references to use workflow IDs
 * Updates references to match current n8n database IDs
 */
export async function convertWorkflowReferencesToNames(
  workflow: Workflow,
  allWorkflows?: Workflow[]
): Promise<Workflow> {
  if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
    return workflow;
  }

  // Get all workflows if not provided (needed to resolve workflow names)
  // Priority: use provided workflows (from backup files), then try to fetch from n8n
  // This allows resolving references by name from backup files even if workflows
  // haven't been imported yet (critical for fixing old IDs after VCS upgrade)
  let workflows = allWorkflows;
  if (!workflows || workflows.length === 0) {
    try {
      workflows = await exportWorkflows();
      logger.debug(`Fetched ${workflows.length} workflows from n8n for reference resolution`);
    } catch (error) {
      logger.warn('Failed to fetch workflows for reference conversion, skipping', error);
      return workflow;
    }
  } else {
    logger.info(`📋 Using ${workflows.length} provided workflows (from backup files) for reference resolution`);
  }

  const updatedNodes = workflow.nodes.map((node: any) => {
    // Handle Execute Workflow nodes
    const isExecuteWorkflow = node?.type === 'n8n-nodes-base.executeWorkflow';
    // Handle Tool Workflow nodes (LangChain)
    const isToolWorkflow = node?.type === '@n8n/n8n-nodes-langchain.toolWorkflow';
    
    if (!isExecuteWorkflow && !isToolWorkflow) {
      return node;
    }

    const params = node.parameters || {};
    const wfParam = params.workflowId;

    if (!wfParam) {
      return node;
    }

    // Handle object format: { value: "...", mode: "id" | "list", ... }
    if (wfParam && typeof wfParam === 'object' && 'value' in wfParam) {
      const currentValue = wfParam.value as string;
      const currentMode = wfParam.mode || 'id';

      // Find workflow by ID or name
      let targetWorkflow: Workflow | undefined;
      
      // Try to find by database ID first (only works if workflows are from n8n API)
      targetWorkflow = workflows?.find(w => w.id === currentValue);
      
      // If not found, try to find by name (value might be a workflow name)
      if (!targetWorkflow && currentValue) {
        targetWorkflow = workflows?.find(w => w.name === currentValue);
      }
      
      // If not found, try by cached name
      if (!targetWorkflow && wfParam.cachedResultName) {
        targetWorkflow = workflows?.find(w => w.name === wfParam.cachedResultName);
      }
      
      // Log ID rewrites (when old ID doesn't match new ID)
      if (targetWorkflow && targetWorkflow.id && currentValue !== targetWorkflow.id) {
        logger.info(`🔄 Rewriting workflow reference: "${currentValue}" → "${targetWorkflow.id}"`);
      }

      if (targetWorkflow && targetWorkflow.id) {
        // Use ID-based reference (n8n resolves by ID in value field)
        // Always use relative path for cachedResultUrl (not full URL like http://localhost:5678/workflow/...)
        const newWorkflowId = {
          ...wfParam,
          value: targetWorkflow.id,
          mode: 'list',
          cachedResultName: targetWorkflow.name,
          cachedResultUrl: `/workflow/${targetWorkflow.id}`, // Relative path only, never full URL
        };

        return {
          ...node,
          parameters: {
            ...params,
            workflowId: newWorkflowId,
          },
        };
      } else {
        logger.warn(`⚠️  Could not resolve workflow reference "${currentValue}" to an ID, keeping as-is. This may cause broken references.`);
        return node;
      }
    }
    // Handle string format (legacy)
    else if (typeof wfParam === 'string') {
      const currentValue = wfParam;
      
      // Find workflow by ID or name
      let targetWorkflow: Workflow | undefined;
      targetWorkflow = workflows?.find(w => w.id === currentValue || w.name === currentValue);
      
      if (targetWorkflow && targetWorkflow.id) {
        // Convert to object format with ID-based reference
        // Always use relative path for cachedResultUrl (not full URL)
        return {
          ...node,
          parameters: {
            ...params,
            workflowId: {
              value: targetWorkflow.id,
              mode: 'list',
              __rl: true,
              cachedResultName: targetWorkflow.name,
              cachedResultUrl: `/workflow/${targetWorkflow.id}`, // Relative path only
            },
          },
        };
      } else {
        logger.warn(`⚠️  Could not resolve workflow reference "${currentValue}" to an ID, keeping as-is. This may cause broken references.`);
        return node;
      }
    }

    return node;
  });

  return {
    ...workflow,
    nodes: updatedNodes,
  };
}

