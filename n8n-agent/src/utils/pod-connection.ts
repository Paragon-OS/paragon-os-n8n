/**
 * Pod Connection Utility
 *
 * Detects running n8n MCP pods and provides connection info for CLI commands.
 * Queries podman directly each time (no file storage) for reliability.
 */

import { execa } from 'execa';
import { logger } from './logger';
import { type McpSseCredentialMapping } from './workflow-reference-converter';

// File paths inside container where pod-connection info is stored
export const POD_SESSION_COOKIE_PATH = '/tmp/n8n-pod-session-cookie';
export const POD_MCP_MAPPINGS_PATH = '/tmp/n8n-pod-mcp-mappings.json';

export interface PodConnection {
  podName: string;
  n8nContainerName: string;
  baseUrl: string;
  sessionCookie: string;
  mcpCredentialMappings: McpSseCredentialMapping[];
}

interface PodmanPodInfo {
  Id: string;
  Name: string;
  Status: string;
  Containers: Array<{
    Id: string;
    Names: string;
  }>;
}

interface PodmanContainerInfo {
  Id: string;
  Names: string[];
  Ports: Array<{
    host_port: number;
    container_port: number;
  }>;
}

/**
 * Check if podman is available
 */
async function checkPodman(): Promise<boolean> {
  try {
    await execa('podman', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find running n8n-mcp pods
 */
async function findRunningPods(): Promise<PodmanPodInfo[]> {
  try {
    const result = await execa('podman', [
      'pod', 'ps',
      '--filter', 'name=n8n-mcp',
      '--filter', 'status=running',
      '--format', 'json',
    ], { timeout: 10000 });

    if (!result.stdout.trim()) {
      return [];
    }

    const pods = JSON.parse(result.stdout);
    return Array.isArray(pods) ? pods : [pods];
  } catch (error) {
    logger.debug('Failed to query pods', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Get n8n container info from a pod
 */
async function getN8nContainerInfo(podName: string): Promise<{ containerName: string; port: number } | null> {
  try {
    // List containers in the pod
    const result = await execa('podman', [
      'ps',
      '--filter', `pod=${podName}`,
      '--format', 'json',
    ], { timeout: 10000 });

    if (!result.stdout.trim()) {
      return null;
    }

    const containers: PodmanContainerInfo[] = JSON.parse(result.stdout);

    // Find the n8n container (name ends with -n8n)
    const n8nContainer = containers.find(c =>
      c.Names.some(n => n.endsWith('-n8n'))
    );

    if (!n8nContainer) {
      logger.debug(`No n8n container found in pod ${podName}`);
      return null;
    }

    const containerName = n8nContainer.Names[0];

    // Get the port mapping for 5678
    const portMapping = n8nContainer.Ports?.find(p => p.container_port === 5678);
    if (!portMapping) {
      // Try getting port via podman port command
      const portResult = await execa('podman', [
        'port', containerName, '5678',
      ], { timeout: 5000, reject: false });

      if (portResult.exitCode === 0 && portResult.stdout.trim()) {
        // Output format: "0.0.0.0:50000"
        const match = portResult.stdout.match(/:(\d+)/);
        if (match) {
          return { containerName, port: parseInt(match[1], 10) };
        }
      }

      logger.debug(`No port mapping found for n8n container ${containerName}`);
      return null;
    }

    return { containerName, port: portMapping.host_port };
  } catch (error) {
    logger.debug(`Failed to get n8n container info for pod ${podName}`, { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Read session cookie from container
 */
async function getSessionCookie(containerName: string): Promise<string | null> {
  try {
    const result = await execa('podman', [
      'exec', containerName,
      'cat', POD_SESSION_COOKIE_PATH,
    ], { timeout: 5000, reject: false });

    if (result.exitCode === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Read MCP credential mappings from container
 */
async function getMcpCredentialMappings(containerName: string): Promise<McpSseCredentialMapping[]> {
  try {
    const result = await execa('podman', [
      'exec', containerName,
      'cat', POD_MCP_MAPPINGS_PATH,
    ], { timeout: 5000, reject: false });

    if (result.exitCode === 0 && result.stdout.trim()) {
      return JSON.parse(result.stdout.trim());
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Get connection info for a running n8n-mcp pod.
 *
 * @throws Error if no pod is running or connection info cannot be retrieved
 */
export async function getRunningPodConnection(): Promise<PodConnection> {
  // Check podman availability
  if (!await checkPodman()) {
    throw new Error(
      'Podman is not available.\n' +
      'Install podman: https://podman.io/getting-started/installation'
    );
  }

  // Find running pods
  const pods = await findRunningPods();

  if (pods.length === 0) {
    throw new Error(
      'No n8n pod running.\n' +
      'Start with: npm run n8n:pod:start'
    );
  }

  if (pods.length > 1) {
    logger.warn(`Multiple n8n pods found, using first: ${pods[0].Name}`);
  }

  const pod = pods[0];
  const podName = pod.Name;

  // Get n8n container info
  const containerInfo = await getN8nContainerInfo(podName);
  if (!containerInfo) {
    throw new Error(
      `Could not find n8n container in pod ${podName}.\n` +
      'The pod may be corrupted. Try: npm run n8n:pod:stop && npm run n8n:pod:start'
    );
  }

  const { containerName, port } = containerInfo;
  const baseUrl = `http://localhost:${port}`;

  // Get session cookie
  const sessionCookie = await getSessionCookie(containerName);
  if (!sessionCookie) {
    throw new Error(
      `Could not retrieve session cookie from pod.\n` +
      'The pod may need to be restarted: npm run n8n:pod:stop && npm run n8n:pod:start'
    );
  }

  // Get MCP credential mappings
  const mcpCredentialMappings = await getMcpCredentialMappings(containerName);

  logger.info(`Connected to pod: ${podName}`);
  logger.info(`  n8n URL: ${baseUrl}`);
  logger.info(`  MCP credential mappings: ${mcpCredentialMappings.length}`);

  return {
    podName,
    n8nContainerName: containerName,
    baseUrl,
    sessionCookie,
    mcpCredentialMappings,
  };
}

/**
 * Check if any n8n-mcp pod is running (quick check, no full connection info)
 */
export async function isPodRunning(): Promise<boolean> {
  const pods = await findRunningPods();
  return pods.length > 0;
}

/**
 * Build N8nApiConfig from pod connection
 */
export function buildApiConfigFromPod(connection: PodConnection): {
  baseURL: string;
  sessionCookie: string;
} {
  return {
    baseURL: connection.baseUrl,
    sessionCookie: connection.sessionCookie,
  };
}
