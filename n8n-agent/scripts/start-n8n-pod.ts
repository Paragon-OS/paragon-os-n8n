import { startMcpPod } from '../src/utils/mcp-pod-manager';
import { importWorkflowFromFile } from '../src/utils/n8n-api';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  // Get Discord token
  let discordToken = process.env.DISCORD_TOKEN;
  if (!discordToken) {
    const mcpEnv = process.env.DISCORD_MCP_ENV;
    if (mcpEnv) {
      try {
        discordToken = JSON.parse(mcpEnv).DISCORD_TOKEN;
      } catch { /* ignore */ }
    }
  }

  if (!discordToken) {
    console.error('❌ DISCORD_TOKEN not set');
    console.error('   Set DISCORD_TOKEN or DISCORD_MCP_ENV environment variable');
    process.exit(1);
  }

  console.log('🚀 Starting MCP pod with Discord MCP + n8n...');

  const pod = await startMcpPod({
    mcpServers: [
      { type: 'discord', env: { DISCORD_TOKEN: discordToken } },
    ],
    timeout: 180000,
  });

  console.log(`✅ Pod ready: ${pod.podName}`);
  console.log(`   n8n URL: ${pod.n8nInstance.baseUrl}`);
  console.log(`   Discord MCP (internal): ${pod.mcpEndpointsInternal.discord}`);

  // Build API config (note: N8nApiConfig uses baseURL not baseUrl)
  const apiConfig = {
    baseURL: pod.n8nInstance.baseUrl,
    sessionCookie: pod.n8nInstance.sessionCookie,
  };

  // Import all helper workflows
  const workflowsDir = path.join(__dirname, '..', 'workflows');
  const helpersDir = path.join(workflowsDir, 'HELPERS');

  const dependencyOrder = [
    'Global Cache System',
    'MCP Data Normalizer',
    'Test Data',
    'Dynamic RAG',
    'Entity Cache Handler',
    'Discord & Telegram Step Executor',
    'Discord Contact Fetch',
    'Discord Guild Fetch',
    'Discord Profile Fetch',
    'Discord Tool Fetch',
    'Telegram Chat Fetch',
    'Telegram Contact Fetch',
    'Telegram Message Fetch',
    'Telegram Profile Fetch',
    'Telegram Tool Fetch',
    'Generic Context Scout Core',
    'Test Runner',
  ];

  console.log('\n📦 Importing helper workflows...');

  const helperFiles = fs.readdirSync(helpersDir).filter(f => f.endsWith('.json'));

  for (const name of dependencyOrder) {
    const file = helperFiles.find(f => {
      const baseName = f.replace('.json', '').replace('[HELPERS] ', '');
      return baseName === name || baseName.includes(name);
    });
    if (file) {
      try {
        await importWorkflowFromFile(
          path.join(helpersDir, file),
          apiConfig,
          pod.mcpCredentialMappings
        );
        console.log(`   ✅ ${name}`);
      } catch (e: any) {
        console.log(`   ⚠️  ${name}: ${e.message}`);
      }
    }
  }

  // Import main workflows
  console.log('\n📦 Importing main workflows...');
  const mainFiles = fs.readdirSync(workflowsDir)
    .filter(f => f.endsWith('.json'));

  for (const file of mainFiles) {
    const filePath = path.join(workflowsDir, file);
    if (fs.statSync(filePath).isFile()) {
      try {
        await importWorkflowFromFile(filePath, apiConfig, pod.mcpCredentialMappings);
        console.log(`   ✅ ${file.replace('.json', '')}`);
      } catch (e: any) {
        console.log(`   ⚠️  ${file}: ${e.message}`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎉 n8n is ready!');
  console.log('='.repeat(60));
  console.log(`\n🌐 Open in browser: ${pod.n8nInstance.baseUrl}\n`);
  console.log('Press Ctrl+C to stop the pod and cleanup.\n');

  // Keep process running
  process.on('SIGINT', async () => {
    console.log('\n🧹 Cleaning up pod...');
    await pod.cleanup();
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
