/**
 * Supabase Migration Utilities
 * Helper functions for checking and applying migrations
 */

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { createSupabaseClient } from "./supabase-config";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Check if a table exists in Supabase
 */
async function tableExists(tableName: string): Promise<boolean> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return false;
  }

  try {
    // Try to query the table with a limit of 0 to check if it exists
    const { error } = await supabase
      .from(tableName)
      .select("*")
      .limit(0);

    // If no error, table exists
    if (!error) {
      return true;
    }

    // Check if error is "relation does not exist"
    if (error.code === "42P01" || error.message.includes("does not exist")) {
      return false;
    }

    // Other errors might mean table exists but we don't have permissions
    // In that case, assume it exists
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if stream_events table exists
 * This is a simple check to see if migrations have been applied
 */
export async function checkStreamEventsTable(): Promise<boolean> {
  return tableExists("stream_events");
}

/**
 * Get migration files from the migrations directory
 */
export async function getMigrationFiles(): Promise<string[]> {
  try {
    const files = await readdir(MIGRATIONS_DIR);
    return files
      .filter((f) => f.endsWith(".sql"))
      .sort(); // Sort to ensure correct order
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Read a migration file
 */
export async function readMigrationFile(filename: string): Promise<string> {
  const filePath = join(MIGRATIONS_DIR, filename);
  return readFile(filePath, "utf-8");
}

/**
 * Check if migrations need to be applied
 * Returns true if stream_events table doesn't exist
 */
export async function needsMigrations(): Promise<boolean> {
  const hasTable = await checkStreamEventsTable();
  return !hasTable;
}

/**
 * Log migration instructions to console
 */
export function logMigrationInstructions(): void {
  console.log("\n⚠️  Database migrations need to be applied!\n");
  console.log("To apply migrations, choose one of these methods:\n");
  console.log("Method 1: Using Supabase CLI (Recommended)");
  console.log("  npm run db:setup     # Install and setup Supabase CLI");
  console.log("  npm run db:start     # Start Supabase (auto-applies migrations)\n");
  console.log("Method 2: Manual SQL Execution");
  console.log("  1. Open Supabase Dashboard → SQL Editor");
  console.log("  2. Copy SQL from: supabase/migrations/20240120000000_create_stream_events.sql");
  console.log("  3. Paste and run the SQL\n");
  console.log("Method 3: Using Migration Scripts");
  console.log("  npm run db:migrate   # View migration files\n");
  console.log("See supabase/README.md for detailed instructions.\n");
}

