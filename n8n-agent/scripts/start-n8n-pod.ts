import 'dotenv/config';
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

  // Get Telegram credentials
  let telegramApiId = process.env.TELEGRAM_API_ID;
  let telegramApiHash = process.env.TELEGRAM_API_HASH;
  let telegramSessionString = process.env.TELEGRAM_SESSION_STRING;

  if (!telegramApiId || !telegramApiHash || !telegramSessionString) {
    const mcpEnv = process.env.TELEGRAM_MCP_ENV;
    if (mcpEnv) {
      try {
        const parsed = JSON.parse(mcpEnv);
        telegramApiId = telegramApiId || parsed.TELEGRAM_API_ID;
        telegramApiHash = telegramApiHash || parsed.TELEGRAM_API_HASH;
        telegramSessionString = telegramSessionString || parsed.TELEGRAM_SESSION_STRING;
      } catch { /* ignore */ }
    }
  }

  if (!telegramApiId || !telegramApiHash || !telegramSessionString) {
    console.error('❌ Telegram credentials not set');
    console.error('   Set TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION_STRING or TELEGRAM_MCP_ENV');
    process.exit(1);
  }

  console.log('🚀 Starting MCP pod with Discord MCP + Telegram MCP + n8n...');

  const pod = await startMcpPod({
    mcpServers: [
      { type: 'discord', env: { DISCORD_TOKEN: discordToken } },
      { type: 'telegram', env: {
        TELEGRAM_API_ID: telegramApiId,
        TELEGRAM_API_HASH: telegramApiHash,
        TELEGRAM_SESSION_STRING: telegramSessionString
      } },
    ],
    timeout: 180000,
  });

  console.log(`✅ Pod ready: ${pod.podName}`);
  console.log(`   n8n URL: ${pod.n8nInstance.baseUrl}`);
  console.log(`   Discord MCP (internal): ${pod.mcpEndpointsInternal.discord}`);
  console.log(`   Telegram MCP (internal): ${pod.mcpEndpointsInternal.telegram}`);

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
    'Discord & Telegram Step Executor',
    'Universal Entity Fetcher',
    'Discord Entity Cache Handler',
    'Telegram Entity Cache Handler',
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

  // Import main workflows (with dependency ordering)
  console.log('\n📦 Importing main workflows...');
  const mainFiles = fs.readdirSync(workflowsDir)
    .filter(f => f.endsWith('.json'));

  // Main workflow dependency order: Context Scouts and Smart Agents must be imported
  // before ParagonOS Manager (which references both Smart Agents)
  const mainDependencyOrder = [
    'Discord Context Scout',
    'Telegram Context Scout',
    'Discord Smart Agent',
    'Telegram Smart Agent',
    'ParagonOS Manager',
  ];

  // Import ordered dependencies first
  const importedFiles = new Set<string>();
  for (const name of mainDependencyOrder) {
    const file = mainFiles.find(f => f.replace('.json', '') === name);
    if (file) {
      const filePath = path.join(workflowsDir, file);
      if (fs.statSync(filePath).isFile()) {
        try {
          await importWorkflowFromFile(filePath, apiConfig, pod.mcpCredentialMappings);
          console.log(`   ✅ ${file.replace('.json', '')}`);
          importedFiles.add(file);
        } catch (e: any) {
          console.log(`   ⚠️  ${file}: ${e.message}`);
          importedFiles.add(file);
        }
      }
    }
  }

  // Import remaining main workflows
  for (const file of mainFiles) {
    if (importedFiles.has(file)) continue;
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
