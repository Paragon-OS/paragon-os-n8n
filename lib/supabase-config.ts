/**
 * Supabase Client Configuration
 * Handles environment variable configuration for Supabase
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "http://127.0.0.1:54321";

/**
 * Get the Supabase URL from environment variables
 */
export function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
}

/**
 * Get the Supabase anon key from environment variables
 */
export function getSupabaseAnonKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

/**
 * Create and return a Supabase client instance
 * Returns null if the anon key is not configured
 */
export function createSupabaseClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!anonKey) {
    return null;
  }

  return createClient(url, anonKey);
}

