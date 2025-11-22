/**
 * n8n Workflow Configuration
 * Maps workflow names to webhook URLs and defines confirmation requirements
 */

import { buildWebhookUrl } from "./n8n-client";
import { type WebhookMode } from "./stores/webhook-mode";

export interface WorkflowConfig {
  webhookPath?: string;
  webhookUrl?: string;
  workflowId?: string;
  requiresConfirmation: boolean;
  description: string;
  method?: "GET" | "POST";
}

export type WorkflowName =
  | "paragonOS";

/**
 * Workflow configurations
 * Add your n8n workflow webhook paths or URLs here
 */
export const workflowConfigs: Record<WorkflowName, WorkflowConfig> = {
  paragonOS: {
    webhookPath: "/paragon-os",
    requiresConfirmation: false,
    description: "Interact with ParagonOS to handle messaging, questions, and tasks via Discord and Telegram.",
    method: "POST",
  },
};

/**
 * Get workflow configuration by name
 */
export function getWorkflowConfig(
  workflowName: WorkflowName,
): WorkflowConfig | null {
  return workflowConfigs[workflowName] || null;
}

/**
 * Get webhook URL for a workflow
 */
export function getWorkflowWebhookUrl(
  workflowName: WorkflowName,
  mode: WebhookMode = "test"
): string | null {
  const config = getWorkflowConfig(workflowName);
  if (!config) return null;

  if (config.webhookUrl) {
    return config.webhookUrl;
  }

  if (config.webhookPath) {
    return buildWebhookUrl(config.webhookPath, mode);
  }

  return null;
}

/**
 * Check if a workflow requires confirmation
 */
export function requiresConfirmation(workflowName: WorkflowName): boolean {
  const config = getWorkflowConfig(workflowName);
  return config?.requiresConfirmation ?? false;
}

/**
 * Get workflow description
 */
export function getWorkflowDescription(workflowName: WorkflowName): string {
  const config = getWorkflowConfig(workflowName);
  return config?.description ?? "Unknown workflow";
}
