/**
 * n8n Credential Management via CLI
 * 
 * Uses n8n CLI commands to inject credentials into containers with exact IDs
 */

import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { execa } from 'execa';
import { logger } from './logger';

/**
 * Credential definition for n8n import
 */
export interface CredentialDefinition {
  id: string;
  name: string;
  type: string;
  data: Record<string, any>;
}

/**
 * All credentials needed for testing workflows
 */
export const TEST_CREDENTIALS: Record<string, CredentialDefinition> = {
  // Google Gemini API (used by Dynamic RAG, Smart Agents, etc.)
  googleGemini: {
    id: 'NIhZoi9otQV2vaAP',
    name: 'Google Gemini(PaLM) Api account',
    type: 'googlePalmApi',
    data: {
      apiKey: process.env.GOOGLE_GEMINI_API_KEY || 
              process.env.GOOGLE_PALM_API_KEY || 
              process.env.GOOGLE_API_KEY ||
              process.env.GOOGLE_AI_STUDIO_API_KEY ||
              '',
    },
  },

  // Redis (used by Global Cache System)
  redis: {
    id: 'I9K02BUMIbHYp1nQ',
    name: 'Redis account',
    type: 'redis',
    data: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      database: parseInt(process.env.REDIS_DB || '0', 10),
      password: process.env.REDIS_PASSWORD || '',
    },
  },

  // Qdrant (used by Dynamic RAG)
  qdrant: {
    id: 'ytBh4xOzWNQ347S5',
    name: 'QdrantApi account',
    type: 'qdrantApi',
    data: {
      url: process.env.QDRANT_URL || 'https://fc88ca3b-0d52-4861-8aea-4ddad3adb373.us-east4-0.gcp.cloud.qdrant.io:6333',
      apiKey: process.env.QDRANT_API_KEY || '',
    },
  },

  // Qdrant Header Auth (used by Dynamic RAG for some operations)
  qdrantHeaderAuth: {
    id: 'S0nticGtHhYu1fe4',
    name: 'Header Auth account',
    type: 'httpHeaderAuth',
    data: {
      name: 'api-key',
      value: process.env.QDRANT_API_KEY || '',
    },
  },

  // Discord MCP Client (STDIO)
  discordMcp: {
    id: 'ZFofx3k2ze1wsifx',
    name: 'Discord MCP Client (STDIO) account',
    type: 'mcpClientApi',
    data: {
      command: process.env.DISCORD_MCP_COMMAND || 'node',
      args: process.env.DISCORD_MCP_ARGS || '/path/to/discord-mcp/index.js',
      env: process.env.DISCORD_MCP_ENV || '{}',
    },
  },

  // Telegram MCP Client (STDIO)
  telegramMcp: {
    id: 'aiYCclLDUqob5iQ0',
    name: 'Telegram MCP Client (STDIO) account',
    type: 'mcpClientApi',
    data: {
      command: process.env.TELEGRAM_MCP_COMMAND || 'node',
      args: process.env.TELEGRAM_MCP_ARGS || '/path/to/telegram-mcp/index.js',
      env: process.env.TELEGRAM_MCP_ENV || '{}',
    },
  },

  // Pinecone (used in LAB workflows)
  pinecone: {
    id: 'AjwVKGbxaD6TrCuF',
    name: 'PineconeApi account',
    type: 'pineconeApi',
    data: {
      apiKey: process.env.PINECONE_API_KEY || '',
      environment: process.env.PINECONE_ENVIRONMENT || 'us-east-1-aws',
    },
  },

  // Anthropic (used in LAB workflows)
  anthropic: {
    id: 'isyty1NtptrrMxOT',
    name: 'Anthropic account',
    type: 'anthropicApi',
    data: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
    },
  },

  // Gmail OAuth2 (used in LAB workflows)
  gmail: {
    id: 'YTo91hCU5KquQMnX',
    name: 'Gmail account',
    type: 'gmailOAuth2',
    data: {
      clientId: process.env.GMAIL_CLIENT_ID || '',
      clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
      refreshToken: process.env.GMAIL_REFRESH_TOKEN || '',
    },
  },

  // Ollama (used in LAB workflows)
  ollama: {
    id: 'ocz8JdQXZuMEnepT',
    name: 'Ollama account',
    type: 'ollamaApi',
    data: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    },
  },
};

/**
 * Essential credentials needed for core workflows
 */
export const ESSENTIAL_CREDENTIALS = [
  'googleGemini',
  'redis',
  'qdrant',
  'qdrantHeaderAuth',
];

/**
 * Create a credential JSON file for n8n import
 */
function createCredentialFile(
  dataDir: string,
  credential: CredentialDefinition
): string {
  const credDir = join(dataDir, '.n8n-credentials');
  
  // Create credentials directory if it doesn't exist
  if (!existsSync(credDir)) {
    mkdirSync(credDir, { recursive: true });
  }

  const credFile = join(credDir, `credential-${credential.id}.json`);
  
  // n8n credential export format (must be an array!)
  const credentialJson = [{
    id: credential.id,
    name: credential.name,
    type: credential.type,
    data: credential.data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }];
  
  writeFileSync(credFile, JSON.stringify(credentialJson, null, 2));
  logger.debug(`Created credential file: ${credFile}`);
  
  return credFile;
}

/**
 * Execute a command inside a podman container
 */
async function execInContainer(
  containerName: string,
  command: string[],
  options: { timeout?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const timeout: number = options.timeout ?? 30000;
  
  try {
    const result = await execa(
      'podman',
      ['exec', '-u', 'node', containerName, ...command],
      { timeout, reject: false }
    );
    
    const exitCode = result.exitCode ?? (result.failed ? 1 : 0);
    
    return { 
      stdout: result.stdout || '', 
      stderr: result.stderr || '', 
      exitCode, 
    };
  } catch (error) {
    logger.error(`Failed to execute command in container: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Copy a file into the container
 */
async function copyToContainer(
  containerName: string,
  hostPath: string,
  containerPath: string
): Promise<void> {
  try {
    const result = await execa(
      'podman',
      ['cp', hostPath, `${containerName}:${containerPath}`],
      { timeout: 10000, reject: false }
    );
    
    if (result.exitCode !== 0) {
      throw new Error(`Failed to copy file: ${result.stderr}`);
    }
    
    logger.debug(`Copied ${hostPath} to ${containerName}:${containerPath}`);
  } catch (error) {
    logger.error(`Failed to copy file to container: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Import credential into n8n container using CLI
 */
async function importCredentialViaCli(
  containerName: string,
  credentialFilePath: string
): Promise<void> {
  logger.info(`Importing credential via CLI: ${credentialFilePath}`);
  
  // Copy credential file to container's temp directory
  const containerTempPath = `/tmp/credential-${Date.now()}.json`;
  await copyToContainer(containerName, credentialFilePath, containerTempPath);
  
  // Import using n8n CLI
  const result = await execInContainer(
    containerName,
    ['n8n', 'import:credentials', '--input', containerTempPath],
    { timeout: 30000 }
  );
  
  if (result.exitCode !== 0) {
    logger.error(`Failed to import credential: ${result.stderr}`);
    throw new Error(`Credential import failed: ${result.stderr}`);
  }
  
  // Clean up temp file
  await execInContainer(
    containerName,
    ['rm', containerTempPath],
    { timeout: 5000 }
  );
  
  logger.debug(`✅ Credential imported successfully`);
}

/**
 * Setup a single credential in the container
 */
export async function setupCredential(
  containerName: string,
  dataDir: string,
  credentialKey: keyof typeof TEST_CREDENTIALS
): Promise<void> {
  const credential = TEST_CREDENTIALS[credentialKey];
  
  // Check if credential data is available
  const hasData = Object.values(credential.data).some(value => {
    if (typeof value === 'string') return value !== '';
    if (typeof value === 'number') return true;
    return false;
  });
  
  if (!hasData) {
    logger.warn(`⚠️  Skipping ${credential.name} - no data available in environment`);
    return;
  }
  
  logger.info(`Setting up credential: ${credential.name} (${credential.id})`);
  
  try {
    // Create credential file
    const credFile = createCredentialFile(dataDir, credential);
    
    // Import into container
    await importCredentialViaCli(containerName, credFile);
    
    logger.info(`✅ ${credential.name} setup complete`);
  } catch (error) {
    logger.error(`Failed to setup ${credential.name}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Setup all essential credentials for testing
 */
export async function setupEssentialCredentials(
  containerName: string,
  dataDir: string
): Promise<void> {
  logger.info(`🔐 Setting up essential credentials for testing...`);
  
  const results: { credential: string; success: boolean; error?: string }[] = [];
  
  for (const credKey of ESSENTIAL_CREDENTIALS) {
    try {
      await setupCredential(containerName, dataDir, credKey);
      results.push({ credential: credKey, success: true });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ credential: credKey, success: false, error: errorMsg });
      logger.warn(`⚠️  Failed to setup ${credKey}: ${errorMsg}`);
    }
  }
  
  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  logger.info(`\n📊 Credential Setup Summary:`);
  logger.info(`  ✅ Successful: ${successful}/${ESSENTIAL_CREDENTIALS.length}`);
  if (failed > 0) {
    logger.warn(`  ❌ Failed: ${failed}/${ESSENTIAL_CREDENTIALS.length}`);
    results.filter(r => !r.success).forEach(r => {
      logger.warn(`    - ${r.credential}: ${r.error}`);
    });
  }
  
  // Clean up credential files
  const credDir = join(dataDir, '.n8n-credentials');
  if (existsSync(credDir)) {
    rmSync(credDir, { recursive: true, force: true });
    logger.debug(`Cleaned up credential files from ${credDir}`);
  }
  
  if (failed === ESSENTIAL_CREDENTIALS.length) {
    throw new Error('Failed to setup any essential credentials');
  }
}

/**
 * Setup all credentials (including optional ones)
 */
export async function setupAllCredentials(
  containerName: string,
  dataDir: string
): Promise<void> {
  logger.info(`🔐 Setting up all credentials...`);
  
  const results: { credential: string; success: boolean; error?: string }[] = [];
  
  for (const credKey of Object.keys(TEST_CREDENTIALS)) {
    try {
      await setupCredential(containerName, dataDir, credKey as keyof typeof TEST_CREDENTIALS);
      results.push({ credential: credKey, success: true });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({ credential: credKey, success: false, error: errorMsg });
      logger.debug(`Skipped ${credKey}: ${errorMsg}`);
    }
  }
  
  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  logger.info(`\n📊 Credential Setup Summary:`);
  logger.info(`  ✅ Successful: ${successful}/${Object.keys(TEST_CREDENTIALS).length}`);
  if (failed > 0) {
    logger.info(`  ⏭️  Skipped: ${failed}/${Object.keys(TEST_CREDENTIALS).length}`);
  }
  
  // Clean up credential files
  const credDir = join(dataDir, '.n8n-credentials');
  if (existsSync(credDir)) {
    rmSync(credDir, { recursive: true, force: true });
    logger.debug(`Cleaned up credential files from ${credDir}`);
  }
}

/**
 * Check if n8n CLI import:credentials command is available
 */
export async function checkCliAvailability(containerName: string): Promise<boolean> {
  try {
    const result = await execInContainer(
      containerName,
      ['n8n', '--help'],
      { timeout: 5000 }
    );
    
    if (result.exitCode !== 0) {
      return false;
    }
    
    // Check if import:credentials is in the help output
    return result.stdout.includes('import:credentials');
  } catch (error) {
    logger.debug(`CLI availability check failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

