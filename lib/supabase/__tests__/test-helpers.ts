/**
 * Test Helpers for Supabase Tests
 * Provides utilities for checking Supabase configuration and status
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { getSupabaseUrl, getSupabaseAnonKey, createSupabaseClient } from '../supabase-config';

// Load environment variables from .env.local (Next.js convention)
const envLocalPath = resolve(process.cwd(), '.env.local');
const envPath = resolve(process.cwd(), '.env');

config({ path: envLocalPath });
config({ path: envPath });

/**
 * Check if Supabase is configured and ready for testing
 */
export function isSupabaseReady(): boolean {
  // Ensure env vars are loaded (they should be from vitest.config.ts, but double-check)
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  
  // Only check client if we have URL and key
  if (!url || !anonKey) {
    return false;
  }
  
  const client = createSupabaseClient();
  return !!client;
}

/**
 * Get detailed Supabase status information
 */
export function getSupabaseStatus() {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  const client = createSupabaseClient();

  // Try to check if Supabase is actually running by making a simple query
  let running = false;
  if (client) {
    // We'll check this asynchronously in tests if needed
    running = true; // Assume running if client can be created
  }

  return {
    configured: !!(url && anonKey),
    running,
    url: url || undefined,
    hasAnonKey: !!anonKey,
    hasClient: !!client,
  };
}

