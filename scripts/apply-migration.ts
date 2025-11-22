#!/usr/bin/env tsx
/**
 * Apply a single migration file to Supabase
 * This script reads the migration SQL and outputs it for manual execution
 * or attempts to apply it via Supabase CLI if available
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import { getSupabaseUrl } from "../lib/supabase/supabase-config";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

async function applyMigration(migrationFile: string) {
  const migrationPath = join(MIGRATIONS_DIR, migrationFile);

  try {
    const sql = await readFile(migrationPath, "utf-8");
    const supabaseUrl = getSupabaseUrl();

    console.log(`\n📄 Migration: ${migrationFile}\n`);
    console.log(`📍 Supabase URL: ${supabaseUrl}\n`);

    // Check if Supabase CLI is available
    try {
      execSync("which supabase", { stdio: "ignore" });
      console.log("✅ Supabase CLI detected\n");
      console.log(
        "💡 To apply this migration using Supabase CLI, run:\n"
      );
      console.log(
        `   supabase db push --db-url ${supabaseUrl.replace(
          /^http/,
          "postgresql"
        )}\n`
      );
      console.log("   Or apply the SQL manually:\n");
    } catch {
      console.log("⚠️  Supabase CLI not found\n");
      console.log("💡 Apply this SQL in your Supabase SQL editor:\n");
    }

    // Print the SQL
    console.log("─".repeat(60));
    console.log(sql);
    console.log("─".repeat(60));
    console.log("\n");
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.error(`❌ Migration file not found: ${migrationPath}`);
    } else {
      console.error(`❌ Error reading migration: ${error.message}`);
    }
    process.exit(1);
  }
}

// Get migration file from command line args
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error("Usage: tsx scripts/apply-migration.ts <migration-file>");
  console.error(
    "Example: tsx scripts/apply-migration.ts 20240120000000_create_stream_events.sql"
  );
  process.exit(1);
}

applyMigration(migrationFile);

