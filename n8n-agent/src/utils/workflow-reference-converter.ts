/**
 * Convert Execute Workflow node references to use workflow IDs
 * Updates references to use current n8n database IDs in the value field
 */

import { logger } from './logger';
import { exportWorkflows, type Workflow, type N8nApiConfig } from './n8n-api';

/**
 * Convert Execute Workflow node references to use workflow IDs
 * Updates references to match current n8n database IDs
 */
export async function convertWorkflowReferencesToNames(
  workflow: Workflow,
  allWorkflows?: Workflow[],
  config?: N8nApiConfig
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

  // Also rewrite fetchWorkflowId values in Code node jsCode
  const nodesWithJsCodeFixed = rewriteFetchWorkflowIdsInJsCode(updatedNodes, workflows || []);

  return {
    ...workflow,
    nodes: nodesWithJsCodeFixed,
  };
}

/**
 * Rewrite fetchWorkflowId values in JavaScript code within Code nodes.
 * This handles the case where workflow IDs are embedded as string literals in
 * JavaScript code (e.g., platform config objects in Discord/Telegram Context Scout).
 *
 * Pattern matched: `fetchWorkflowId: "OLD_ID"` or `fetchWorkflowId: 'OLD_ID'`
 * The comment after the ID (e.g., `// [HELPERS] Workflow Name`) is used to find the new ID.
 */
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

function rewriteFetchWorkflowIdsInJsCode(nodes: any[], allWorkflows: Workflow[]): any[] {
  // Build a name-to-ID mapping from all workflows
  const nameToIdMap = new Map<string, string>();
  for (const wf of allWorkflows) {
    if (wf.name && wf.id) {
      nameToIdMap.set(wf.name, wf.id);
    }
  }

  return nodes.map((node: any) => {
    // Only process Code nodes
    if (node?.type !== 'n8n-nodes-base.code') {
      return node;
    }

    const jsCode = node.parameters?.jsCode;
    if (!jsCode || typeof jsCode !== 'string') {
      return node;
    }

    // Pattern: fetchWorkflowId: "OLD_ID", // [HELPERS] Workflow Name
    // or: fetchWorkflowId: "OLD_ID" // [HELPERS] Workflow Name
    const fetchWorkflowIdPattern = /fetchWorkflowId:\s*["']([^"']+)["']\s*,?\s*\/\/\s*(\[HELPERS\][^\n]+)/g;

    let updatedCode = jsCode;
    let match: RegExpExecArray | null;
    const replacements: Array<{ oldId: string; newId: string; workflowName: string }> = [];

    // Reset lastIndex for global regex
    fetchWorkflowIdPattern.lastIndex = 0;

    while ((match = fetchWorkflowIdPattern.exec(jsCode)) !== null) {
      const oldId = match[1];
      const workflowName = match[2].trim();

      // Look up the new ID by workflow name
      const newId = nameToIdMap.get(workflowName);

      if (newId && newId !== oldId) {
        replacements.push({ oldId, newId, workflowName });
      }
    }

    // Apply all replacements
    for (const { oldId, newId, workflowName } of replacements) {
      // Replace exact pattern to avoid accidental replacements
      const exactPattern = new RegExp(
        `(fetchWorkflowId:\\s*["'])${oldId}(["']\\s*,?\\s*\\/\\/\\s*${workflowName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
        'g'
      );
      const before = updatedCode;
      updatedCode = updatedCode.replace(exactPattern, `$1${newId}$2`);

      if (before !== updatedCode) {
        logger.info(`🔄 Rewrote fetchWorkflowId in Code node: "${oldId}" → "${newId}" (${workflowName})`);
      }
    }

    if (updatedCode !== jsCode) {
      return {
        ...node,
        parameters: {
          ...node.parameters,
          jsCode: updatedCode,
        },
      };
    }

    return node;
  });
}

