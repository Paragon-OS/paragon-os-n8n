/**
 * Convert Execute Workflow node references to use workflow IDs
 * Updates references to use current n8n database IDs in the value field
 */

import { logger } from './logger';
import { exportWorkflows, type Workflow, type N8nApiConfig } from './n8n-api';

/**
 * Convert Execute Workflow node references to use workflow IDs
 * Updates references to match current n8n database IDs
 * Optionally rewrites MCP credentials from STDIO to SSE transport
 */
export async function convertWorkflowReferencesToNames(
  workflow: Workflow,
  allWorkflows?: Workflow[],
  config?: N8nApiConfig,
  mcpCredentialMappings?: McpSseCredentialMapping[]
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
    if (!config) {
      logger.warn('No workflows provided and no config to fetch them, skipping reference conversion');
      return workflow;
    }
    try {
      workflows = await exportWorkflows(config);
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

  // Apply MCP credential rewriting if mappings are provided
  let finalNodes = updatedNodes;
  if (mcpCredentialMappings && mcpCredentialMappings.length > 0) {
    finalNodes = rewriteMcpCredentialsToSse(updatedNodes, mcpCredentialMappings);
  }

  return {
    ...workflow,
    nodes: finalNodes,
  };
}

/**
 * MCP SSE credential mapping for container mode
 * Maps STDIO credential IDs to SSE credential IDs
 */
export interface McpSseCredentialMapping {
  /** STDIO credential ID */
  stdioId: string;
  /** SSE credential ID to use instead */
  sseId: string;
  /** SSE credential name */
  sseName: string;
}

/**
 * Rewrite MCP node credentials from STDIO to SSE transport for container mode.
 * This allows workflows designed for local STDIO MCP to work in containers
 * using SSE transport.
 *
 * @param nodes - Workflow nodes to process
 * @param mappings - Credential mappings (STDIO ID -> SSE ID)
 * @returns Updated nodes with SSE credentials
 */
export function rewriteMcpCredentialsToSse(
  nodes: any[],
  mappings: McpSseCredentialMapping[]
): any[] {
  // Build mapping lookup
  const credentialMap = new Map<string, { sseId: string; sseName: string }>();
  for (const mapping of mappings) {
    credentialMap.set(mapping.stdioId, {
      sseId: mapping.sseId,
      sseName: mapping.sseName,
    });
    logger.debug(`  MCP credential mapping: ${mapping.stdioId} → ${mapping.sseId}`);
  }

  let mcpNodesFound = 0;
  let mcpNodesRewritten = 0;

  const result = nodes.map((node: any) => {
    // Check if this is an MCP node with mcpClientApi credential
    if (!node?.credentials?.mcpClientApi) {
      return node;
    }

    mcpNodesFound++;
    const stdioCredential = node.credentials.mcpClientApi;
    logger.debug(`  Found MCP node "${node.name}" with credential ID: ${stdioCredential.id}`);

    const mapping = credentialMap.get(stdioCredential.id);

    if (!mapping) {
      logger.warn(`  ⚠️  No SSE mapping found for credential ID: ${stdioCredential.id}`);
      return node;
    }

    mcpNodesRewritten++;
    logger.info(`🔄 Rewriting MCP credential from STDIO to SSE: "${stdioCredential.name}" → "${mapping.sseName}"`);

    // Replace mcpClientApi with mcpClientSseApi
    const updatedCredentials = { ...node.credentials };
    delete updatedCredentials.mcpClientApi;
    updatedCredentials.mcpClientSseApi = {
      id: mapping.sseId,
      name: mapping.sseName,
    };

    return {
      ...node,
      credentials: updatedCredentials,
    };
  });

  if (mcpNodesFound > 0) {
    logger.info(`  MCP credential rewrite: ${mcpNodesRewritten}/${mcpNodesFound} nodes rewritten`);
  }

  return result;
}
