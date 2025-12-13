import 'dotenv/config';
import { execSync } from 'child_process';

async function main() {
  console.log('🔍 Finding n8n MCP pods...');

  try {
    // Find pods matching our naming pattern
    const podList = execSync('podman pod ps --format "{{.Name}}" 2>/dev/null', { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(name => name.startsWith('n8n-mcp-test-'));

    if (podList.length === 0 || (podList.length === 1 && podList[0] === '')) {
      console.log('ℹ️  No n8n MCP pods running');
      return;
    }

    console.log(`Found ${podList.length} pod(s):`);
    for (const pod of podList) {
      console.log(`  - ${pod}`);
    }

    console.log('\n🛑 Stopping pods...');
    for (const pod of podList) {
      try {
        execSync(`podman pod stop ${pod}`, { stdio: 'inherit' });
        console.log(`  ✅ Stopped: ${pod}`);
      } catch {
        console.log(`  ⚠️  Failed to stop: ${pod}`);
      }
    }

    console.log('\n🗑️  Removing pods...');
    for (const pod of podList) {
      try {
        execSync(`podman pod rm ${pod}`, { stdio: 'inherit' });
        console.log(`  ✅ Removed: ${pod}`);
      } catch {
        console.log(`  ⚠️  Failed to remove: ${pod}`);
      }
    }

    console.log('\n✅ Cleanup complete!');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
