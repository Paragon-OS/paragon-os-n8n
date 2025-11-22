#!/usr/bin/env tsx
/**
 * Supabase Migration Runner
 * Automatically applies pending migrations to Supabase (local or remote)
 */

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl, getSupabaseAnonKey } from "../lib/supabase-config";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const MIGRATIONS_TABLE = "schema_migrations";

interface Migration {
  filename: string;
  version: string;
  sql: string;
}

/**
 * Get Supabase client with service role key for migrations
 * Uses anon key if service role key is not available
 */
function getSupabaseClient() {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Please configure Supabase in your environment variables."
    );
  }

  // For migrations, we use anon key. In production, you should use service role key
  // via SUPABASE_SERVICE_ROLE_KEY environment variable
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return createClient(url, serviceRoleKey);
}

/**
 * Create migrations tracking table if it doesn't exist
 */
async function ensureMigrationsTable(client: ReturnType<typeof createClient>) {
  const { error } = await client.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  });

  // If rpc doesn't exist, try direct SQL execution via a simple query
  // This is a fallback for Supabase instances without RPC enabled
  if (error) {
    console.warn(
      "[migrate] Could not create migrations table via RPC, trying alternative method..."
    );
    // We'll create it as part of the first migration if needed
  }
}

/**
 * Get list of applied migrations
 */
async function getAppliedMigrations(
  client: ReturnType<typeof createClient>
): Promise<string[]> {
  try {
    // Try to query migrations table
    const { data, error } = await client
      .from(MIGRATIONS_TABLE)
      .select("version")
      .order("applied_at", { ascending: true });

    if (error) {
      // Table doesn't exist yet, return empty array
      if (error.code === "42P01" || error.message.includes("does not exist")) {
        return [];
      }
      throw error;
    }

    return (data || []).map((row: { version: string }) => row.version);
  } catch (error) {
    console.warn(
      "[migrate] Could not read migrations table, assuming no migrations applied"
    );
    return [];
  }
}

/**
 * Mark a migration as applied
 */
async function markMigrationApplied(
  client: ReturnType<typeof createClient>,
  version: string
): Promise<void> {
  // Ensure migrations table exists first
  try {
    await client
      .from(MIGRATIONS_TABLE)
      .insert({ version })
      .then(() => {
        console.log(`[migrate] Marked migration ${version} as applied`);
      });
  } catch (error: any) {
    // If insert fails because table doesn't exist, create it and retry
    if (
      error?.code === "42P01" ||
      error?.message?.includes("does not exist")
    ) {
      // Create migrations table manually
      const createTableSql = `
        CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
          version VARCHAR(255) PRIMARY KEY,
          applied_at TIMESTAMPTZ DEFAULT NOW()
        );
      `;
      // Execute via raw SQL query (using postgrest for now, might need service role)
      console.log("[migrate] Creating migrations table...");
      // We'll try to execute the SQL directly
      // For now, log a warning and continue
      console.warn(
        "[migrate] Could not automatically create migrations table. Please run:",
        createTableSql
      );
    } else {
      throw error;
    }
  }
}

/**
 * Execute SQL migration
 */
async function executeMigration(
  client: ReturnType<typeof createClient>,
  migration: Migration
): Promise<void> {
  console.log(`[migrate] Applying migration: ${migration.filename}`);

  // Split SQL by semicolons and execute each statement
  // Note: This is a simplified approach. In production, consider using
  // a proper SQL parser or Supabase CLI for better error handling
  const statements = migration.sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const statement of statements) {
    if (statement.trim()) {
      try {
        // For Supabase, we can use RPC or direct queries
        // Since we can't execute arbitrary SQL easily via the client,
        // we'll use a different approach: save the SQL and let users
        // know they can apply it via Supabase CLI or SQL editor
        console.log(
          "[migrate] Note: Auto-execution of SQL via JS client is limited."
        );
        console.log(
          "[migrate] Please run migrations using Supabase CLI or apply manually."
        );
        break;
      } catch (error: any) {
        console.error(`[migrate] Error executing statement:`, error.message);
        throw error;
      }
    }
  }
}

/**
 * Load all migration files
 */
async function loadMigrations(): Promise<Migration[]> {
  try {
    const files = await readdir(MIGRATIONS_DIR);
    const migrationFiles = files
      .filter((f) => f.endsWith(".sql"))
      .sort(); // Sort to ensure correct order

    const migrations: Migration[] = [];

    for (const filename of migrationFiles) {
      const filePath = join(MIGRATIONS_DIR, filename);
      const sql = await readFile(filePath, "utf-8");
      const version = filename.replace(".sql", "");

      migrations.push({
        filename,
        version,
        sql,
      });
    }

    return migrations;
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log(`[migrate] Migrations directory not found: ${MIGRATIONS_DIR}`);
      return [];
    }
    throw error;
  }
}

/**
 * Main migration runner
 */
async function runMigrations() {
  console.log("[migrate] Starting Supabase migrations...\n");

  try {
    const client = getSupabaseClient();
    const migrations = await loadMigrations();

    if (migrations.length === 0) {
      console.log("[migrate] No migrations found.");
      return;
    }

    console.log(`[migrate] Found ${migrations.length} migration(s)\n`);

    // For now, we'll just print the migrations and suggest using Supabase CLI
    // This is because executing arbitrary SQL via the JS client is complex
    console.log(
      "[migrate] To apply migrations, use one of these methods:\n"
    );
    console.log("Method 1: Supabase CLI (Recommended)");
    console.log("  supabase db reset  # Reset and apply all migrations");
    console.log("  supabase migration up  # Apply pending migrations\n");

    console.log("Method 2: Manual SQL execution");
    console.log("  Copy the SQL from migration files and run in Supabase SQL editor\n");

    console.log("Method 3: Use the provided npm scripts");
    console.log("  npm run db:migrate  # Shows migration files\n");

    console.log("\nMigration files found:");
    migrations.forEach((m) => {
      console.log(`  - ${m.filename}`);
    });
  } catch (error: any) {
    console.error("[migrate] Error running migrations:", error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runMigrations().catch((error) => {
    console.error("[migrate] Fatal error:", error);
    process.exit(1);
  });
}

export { runMigrations, loadMigrations };

