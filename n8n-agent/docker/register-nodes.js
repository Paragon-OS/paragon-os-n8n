#!/usr/bin/env node
/**
 * Register community nodes in the n8n database.
 *
 * n8n requires community nodes to be registered in the database (installed_packages
 * and installed_nodes tables) for them to appear in the UI. The nodes will still
 * be loaded and functional without registration, but they won't show as "installed"
 * in Settings > Community Nodes.
 *
 * This script reads the custom nodes from ~/.n8n/nodes/ and registers them.
 *
 * Scenarios handled:
 * 1. Database exists with tables -> registers nodes
 * 2. Database doesn't exist -> skips (will be handled on next container restart)
 * 3. Database exists but tables don't exist -> skips (n8n migrations not run yet)
 */

const fs = require('fs');
const path = require('path');

// Database path - check both possible locations due to N8N_USER_FOLDER nesting
const DB_PATHS = [
  '/home/node/.n8n/.n8n/database.sqlite',
  '/home/node/.n8n/database.sqlite',
];

// Nodes directory - check both locations
const NODES_DIRS = [
  '/home/node/.n8n/.n8n/nodes/node_modules',
  '/home/node/.n8n/nodes/node_modules',
];

// Find the sqlite3 module from n8n's dependencies
function findSqlite3() {
  const possiblePaths = [
    '/usr/local/lib/node_modules/n8n/node_modules/.pnpm/sqlite3@5.1.7/node_modules/sqlite3',
    '/usr/local/lib/node_modules/n8n/node_modules/sqlite3',
  ];

  for (const p of possiblePaths) {
    try {
      return require(p);
    } catch (e) {
      continue;
    }
  }
  return null;
}

function dbQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function registerNodes() {
  // Find the database
  let dbPath = null;
  for (const p of DB_PATHS) {
    if (fs.existsSync(p)) {
      dbPath = p;
      break;
    }
  }

  if (!dbPath) {
    console.log('  Database not found (first run?) - nodes will load from filesystem');
    console.log('  Registration will happen on next container restart');
    return;
  }

  // Find nodes directory
  let nodesDir = null;
  for (const d of NODES_DIRS) {
    if (fs.existsSync(d)) {
      nodesDir = d;
      break;
    }
  }

  if (!nodesDir) {
    console.log('  No nodes directory found - skipping registration');
    return;
  }

  const Database = findSqlite3();
  if (!Database) {
    console.log('  sqlite3 module not found - skipping registration');
    return;
  }

  const db = new Database.Database(dbPath);

  // Check if the required tables exist
  try {
    const tables = await dbQuery(db, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('installed_packages', 'installed_nodes')");
    if (tables.length < 2) {
      console.log('  Database tables not ready (migrations pending?) - skipping registration');
      db.close();
      return;
    }
  } catch (err) {
    console.log('  Could not query database:', err.message);
    db.close();
    return;
  }

  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

  // Find all n8n-nodes-* packages
  const packages = fs.readdirSync(nodesDir)
    .filter(name => name.startsWith('n8n-nodes-') && !name.startsWith('.'))
    .filter(name => {
      try {
        return fs.statSync(path.join(nodesDir, name)).isDirectory();
      } catch {
        return false;
      }
    });

  if (packages.length === 0) {
    console.log('  No community packages found to register');
    db.close();
    return;
  }

  console.log(`  Found ${packages.length} community package(s) to register`);

  for (const pkgName of packages) {
    const pkgJsonPath = path.join(nodesDir, pkgName, 'package.json');

    if (!fs.existsSync(pkgJsonPath)) {
      console.log(`  Warning: No package.json for ${pkgName}, skipping`);
      continue;
    }

    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    } catch (err) {
      console.log(`  Warning: Invalid package.json for ${pkgName}, skipping`);
      continue;
    }

    const nodes = pkg.n8n?.nodes || [];
    if (nodes.length === 0) {
      console.log(`  Warning: No nodes defined in ${pkgName}/package.json, skipping`);
      continue;
    }

    // Insert into installed_packages
    try {
      await dbRun(db,
        `INSERT OR REPLACE INTO installed_packages
         (packageName, installedVersion, authorName, authorEmail, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          pkg.name,
          pkg.version,
          pkg.author?.name || 'Unknown',
          pkg.author?.email || '',
          now,
          now
        ]
      );
      console.log(`  Registered: ${pkg.name}@${pkg.version}`);
    } catch (err) {
      console.log(`  Error registering ${pkg.name}:`, err.message);
      continue;
    }

    // Insert each node
    for (const nodePath of nodes) {
      const nodeFile = path.basename(nodePath, '.node.js');
      const nodeType = pkg.name + '.' + nodeFile.charAt(0).toLowerCase() + nodeFile.slice(1);

      try {
        await dbRun(db,
          `INSERT OR REPLACE INTO installed_nodes (name, type, latestVersion, package) VALUES (?, ?, ?, ?)`,
          [nodeFile, nodeType, 1, pkg.name]
        );
        console.log(`    - ${nodeFile}`);
      } catch (err) {
        console.log(`    - ${nodeFile} (error: ${err.message})`);
      }
    }
  }

  // Close the database
  await new Promise((resolve) => db.close(resolve));

  console.log('  Registration complete');
}

// Run the registration
registerNodes().catch(err => {
  console.error('  Error registering nodes:', err.message);
  // Don't exit with error - let n8n start anyway
});
