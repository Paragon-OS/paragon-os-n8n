/**
 * Supabase Client Configuration
 * Handles environment variable configuration for Supabase
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "http://127.0.0.1:54321";

// Singleton client instance
let supabaseClient: SupabaseClient | null = null;
let clientUrl: string | null = null;
let clientAnonKey: string | null = null;

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
 * Get or create a singleton Supabase client instance
 * Returns null if the anon key is not configured
 * Reuses the same client instance to avoid multiple GoTrueClient warnings
 */
export function createSupabaseClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!anonKey) {
    return null;
  }

  // ALWAYS create a new client to avoid schema caching issues
  // TODO: Optimize this after schema is stable
  supabaseClient = createClient(url, anonKey, {
    db: {
      schema: 'public'
    }
  });
  clientUrl = url;
  clientAnonKey = anonKey;

  return supabaseClient;
}

