/**
 * Convert Execute Workflow node references from ID-based to name-based
 * This eliminates the need for reference fixing - names are stable, IDs are not
 */

import { logger } from './logger';
import { exportWorkflows, type Workflow } from './n8n-api';

/**
 * Convert Execute Workflow node references to use names instead of IDs
 * This makes references stable and eliminates the need for reference fixing
 */
export async function convertWorkflowReferencesToNames(
  workflow: Workflow,
  allWorkflows?: Workflow[]
): Promise<Workflow> {
  if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
    return workflow;
  }

  // Get all workflows if not provided (needed to resolve workflow names)
  let workflows = allWorkflows;
  if (!workflows) {
    try {
      workflows = await exportWorkflows();
    } catch (error) {
      logger.warn('Failed to fetch workflows for reference conversion, skipping', error);
      return workflow;
    }
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

      // If already using name-based reference, keep it
      if (currentMode === 'list') {
        return node;
      }

      // Find workflow by ID or custom ID
      let targetWorkflow: Workflow | undefined;
      
      // Try to find by database ID first
      targetWorkflow = workflows?.find(w => w.id === currentValue);
      
      // If not found, try to find by name (in case value is a custom ID like "TestDataHelper001")
      if (!targetWorkflow && currentValue) {
        targetWorkflow = workflows?.find(w => {
          if (!w.name) return false;
          // Exact name match
          if (w.name === currentValue) return true;
          // Check if workflow has this as a custom ID (stored in JSON file)
          // Custom IDs are often stored in the workflow JSON but not in the API response
          // So we need to match by name patterns
          const nameNoSpaces = w.name.replace(/\s+/g, '').replace(/\[.*?\]/g, '');
          const valueNoSpaces = currentValue.replace(/\s+/g, '');
          
          // Try various matching strategies for custom IDs
          // 1. Name without spaces/tags matches custom ID
          if (nameNoSpaces === valueNoSpaces || nameNoSpaces.toLowerCase() === valueNoSpaces.toLowerCase()) {
            return true;
          }
          // 2. Custom ID might be embedded in name (e.g., "TestDataHelper001" in "[HELPERS] Test Data")
          if (nameNoSpaces.toLowerCase().includes(valueNoSpaces.toLowerCase()) || 
              valueNoSpaces.toLowerCase().includes(nameNoSpaces.toLowerCase())) {
            return true;
          }
          // 3. Try matching by removing common suffixes/prefixes
          // "TestDataHelper001" might match "TestData" or "Test Data Helper"
          const nameWords = nameNoSpaces.toLowerCase().split(/(?=[A-Z])|Helper|001/).filter(Boolean);
          const valueWords = valueNoSpaces.toLowerCase().split(/(?=[A-Z])|Helper|001/).filter(Boolean);
          if (nameWords.length > 0 && valueWords.length > 0) {
            const commonWords = nameWords.filter(w => valueWords.includes(w));
            if (commonWords.length >= Math.min(nameWords.length, valueWords.length) * 0.7) {
              return true;
            }
          }
          return false;
        });
      }

      if (targetWorkflow && targetWorkflow.name) {
        // Convert to name-based reference
        const newWorkflowId = {
          ...wfParam,
          value: targetWorkflow.name,
          mode: 'list',
          cachedResultName: targetWorkflow.name,
        };
        
        // Keep cachedResultUrl if it exists, or set it based on the workflow ID
        if (targetWorkflow.id) {
          newWorkflowId.cachedResultUrl = `/workflow/${targetWorkflow.id}`;
        }

        return {
          ...node,
          parameters: {
            ...params,
            workflowId: newWorkflowId,
          },
        };
      } else {
        logger.debug(`Could not resolve workflow reference "${currentValue}" to a name, keeping as-is`);
        return node;
      }
    }
    // Handle string format (legacy)
    else if (typeof wfParam === 'string') {
      const currentValue = wfParam;
      
      // Find workflow by ID or name
      let targetWorkflow: Workflow | undefined;
      targetWorkflow = workflows?.find(w => w.id === currentValue || w.name === currentValue);
      
      if (targetWorkflow && targetWorkflow.name) {
        // Convert to object format with name-based reference
        return {
          ...node,
          parameters: {
            ...params,
            workflowId: {
              value: targetWorkflow.name,
              mode: 'list',
              __rl: true,
              cachedResultName: targetWorkflow.name,
              ...(targetWorkflow.id ? { cachedResultUrl: `/workflow/${targetWorkflow.id}` } : {}),
            },
          },
        };
      } else {
        logger.debug(`Could not resolve workflow reference "${currentValue}" to a name, keeping as-is`);
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

