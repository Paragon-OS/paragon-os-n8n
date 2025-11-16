#!/usr/bin/env node

/**
 * Sync selected n8n workflows from a local instance into versioned JSON files under src/.
 *
 * - Reads workflow IDs from workflow-ids.txt (one per line, # comments allowed)
 * - Fetches workflow + folder metadata from the n8n REST API
 * - Computes a folder-based path under src/ matching the n8n folder tree
 * - Writes pretty-printed JSON files with filenames:
 *     <sanitized-workflow-name>--<last5OfWorkflowId>.json
 *
 * Usage:
 *   node src/sync-workflows.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const PROJECT_ROOT = __dirname ? path.resolve(__dirname, '..') : process.cwd();
const CONFIG_PATH = path.join(PROJECT_ROOT, 'n8n-sync.config.json');
const ID_LIST_PATH = path.join(PROJECT_ROOT, 'workflow-ids.txt');
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'src', 'workflows');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found at ${CONFIG_PATH}. Please create n8n-sync.config.json.`);
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const cfg = JSON.parse(raw);
  if (!cfg.baseUrl) {
    throw new Error('n8n-sync.config.json must contain a "baseUrl" property.');
  }
  return cfg;
}

function readWorkflowIds() {
  if (!fs.existsSync(ID_LIST_PATH)) {
    throw new Error(`workflow-ids.txt not found at ${ID_LIST_PATH}`);
  }
  const raw = fs.readFileSync(ID_LIST_PATH, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function sanitizeName(name) {
  const replaced = name.replace(/[\s]+/g, '-').replace(/[^a-zA-Z0-9\-_.]/g, '');
  return replaced || 'workflow';
}

function last5(id) {
  if (!id) return 'xxxxx';
  return id.slice(-5);
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
  };
}

function requestJson(baseUrl, endpoint, apiKey) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, baseUrl);
    const lib = url.protocol === 'https:' ? https : http;

    const options = {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    };

    if (apiKey) {
      options.headers['X-N8N-API-KEY'] = apiKey;
    }

    const req = lib.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (err) {
            reject(new Error(`Failed to parse JSON from ${url.toString()}: ${err.message}`));
          }
        } else {
          reject(
            new Error(
              `Request to ${url.toString()} failed with status ${res.statusCode}: ${data}`,
            ),
          );
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function fetchWorkflow(baseUrl, apiKey, id) {
  // n8n REST endpoint for a single workflow
  return requestJson(baseUrl, `/rest/workflows/${encodeURIComponent(id)}`, apiKey);
}

async function fetchFolder(baseUrl, apiKey, folderId) {
  if (!folderId) return null;
  return requestJson(baseUrl, `/rest/folders/${encodeURIComponent(folderId)}`, apiKey);
}

async function buildFolderPath(baseUrl, apiKey, folderId) {
  // Walk up parent folders if the API exposes parent relationships.
  const segments = [];
  let currentId = folderId;

  while (currentId) {
    // eslint-disable-next-line no-await-in-loop
    const folder = await fetchFolder(baseUrl, apiKey, currentId);
    if (!folder || !folder.name) break;
    segments.unshift(sanitizeName(folder.name));

    if (folder.parentId) {
      currentId = folder.parentId;
    } else {
      break;
    }
  }

  return segments.join(path.sep);
}

async function main() {
  const { dryRun } = parseArgs();
  const config = loadConfig();
  const { baseUrl, apiKey } = config;
  const ids = readWorkflowIds();

  if (ids.length === 0) {
    console.log('No workflow IDs found in workflow-ids.txt (non-comment lines). Nothing to do.');
    return;
  }

  console.log(`Found ${ids.length} workflow ID(s) to sync.`);
  console.log(`Output root: ${OUTPUT_ROOT}`);
  if (dryRun) {
    console.log('Running in DRY-RUN mode. No files will be written.\n');
  }

  const results = {
    success: [],
    failed: [],
  };

  for (const id of ids) {
    console.log(`\n=== Sync workflow ${id} ===`);
    try {
      // eslint-disable-next-line no-await-in-loop
      const workflow = await fetchWorkflow(baseUrl, apiKey, id);

      if (!workflow || !workflow.id) {
        throw new Error('Workflow payload missing id');
      }

      const wfName = workflow.name || workflow.id;
      const wfFolderId = workflow.folderId || workflow.folderId === 0 ? workflow.folderId : null;

      // eslint-disable-next-line no-await-in-loop
      const folderPath = wfFolderId != null
        ? await buildFolderPath(baseUrl, apiKey, wfFolderId)
        : '';

      const sanitizedName = sanitizeName(wfName);
      const suffix = last5(workflow.id);
      const fileName = `${sanitizedName}--${suffix}.json`;
      const targetDir = folderPath
        ? path.join(OUTPUT_ROOT, folderPath)
        : OUTPUT_ROOT;
      const targetPath = path.join(targetDir, fileName);

      console.log(`Workflow name: ${wfName}`);
      console.log(`Folder path: ${folderPath || '(root)'}`);
      console.log(`Target file: ${targetPath}`);

      if (!dryRun) {
        fs.mkdirSync(targetDir, { recursive: true });
        const jsonString = JSON.stringify(workflow, null, 2);
        fs.writeFileSync(targetPath, jsonString, 'utf8');
      }

      results.success.push({ id: workflow.id, path: targetPath });
    } catch (err) {
      console.error(`Failed to sync workflow ${id}: ${err.message}`);
      results.failed.push({ id, error: err.message });
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Successful: ${results.success.length}`);
  results.success.forEach((s) => {
    console.log(`  - ${s.id} -> ${s.path}`);
  });
  console.log(`Failed: ${results.failed.length}`);
  results.failed.forEach((f) => {
    console.log(`  - ${f.id}: ${f.error}`);
  });

  if (results.failed.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during sync:', err);
    process.exit(1);
  });
}


