import 'dotenv/config';
import { execSync } from 'child_process';

async function main() {
  console.log('🔍 n8n MCP Pod Status\n');

  try {
    // Find pods matching our naming pattern
    const podList = execSync('podman pod ps --format "{{.Name}}" 2>/dev/null', { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(name => name.startsWith('n8n-mcp-test-'));

    if (podList.length === 0 || (podList.length === 1 && podList[0] === '')) {
      console.log('ℹ️  No n8n MCP pods running');
      console.log('\nTo start a pod: npm run n8n:pod:start');
      return;
    }

    // Show pod info
    console.log('📦 Pods:');
    execSync('podman pod ps --filter "name=n8n-mcp-test"', { stdio: 'inherit' });

    console.log('\n🐳 Containers:');
    for (const pod of podList) {
      execSync(`podman ps --pod --filter "pod=${pod}" --format "table {{.Names}}\\t{{.Status}}"`, { stdio: 'inherit' });
    }

    // Show URLs
    console.log('\n🌐 URLs:');
    console.log('   n8n UI:       http://localhost:50000');
    console.log('   Discord MCP:  http://localhost:50001/sse');
    console.log('   Telegram MCP: http://localhost:50002/sse');

    console.log('\n💡 Commands:');
    console.log('   Stop pod:  npm run n8n:pod:stop');
    console.log('   View logs: podman logs <container-name>');

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
