/**
 * Supabase Stream Events
 * Handles persistence of stream monitor events to Supabase
 */

import { createSupabaseClient } from "./supabase-config";
import type { StreamUpdate } from "./n8n-client/types";

/**
 * Database row type for stream_events table
 */
export interface StreamEventRow {
  id?: string; // UUID, auto-generated
  execution_id: string;
  stage: string;
  status: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
  created_at?: string; // Auto-generated
}

/**
 * Save a StreamUpdate event to Supabase
 * This function is non-blocking and will not throw errors to avoid affecting webhook performance
 * Errors are logged but do not propagate
 */
export async function saveStreamEventToSupabase(
  update: StreamUpdate
): Promise<void> {
  const supabase = createSupabaseClient();
  
  // If Supabase is not configured, silently skip
  if (!supabase) {
    console.warn(
      "[supabase-stream-events] Supabase not configured, skipping save",
      { executionId: update.executionId }
    );
    return;
  }

  try {
    const eventRow: StreamEventRow = {
      execution_id: update.executionId,
      stage: update.stage,
      status: update.status,
      message: update.message,
      timestamp: update.timestamp,
      data: update.data || {},
    };

    const { error } = await supabase.from("stream_events").insert(eventRow);

    if (error) {
      console.error(
        "[supabase-stream-events] Error saving stream event:",
        error,
        { executionId: update.executionId, stage: update.stage }
      );
      return;
    }

    console.log(
      `[supabase-stream-events] Saved stream event for execution: ${update.executionId}, stage: ${update.stage}`
    );
  } catch (error) {
    // Catch any unexpected errors to prevent them from propagating
    console.error(
      "[supabase-stream-events] Unexpected error saving stream event:",
      error,
      { executionId: update.executionId }
    );
  }
}

/**
 * Retrieve stream events for a specific execution from Supabase
 * Returns empty array if Supabase is not configured or on error
 */
export async function getStreamEventsByExecutionId(
  executionId: string
): Promise<StreamEventRow[]> {
  const supabase = createSupabaseClient();
  
  if (!supabase) {
    console.warn(
      "[supabase-stream-events] Supabase not configured, cannot retrieve events"
    );
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("stream_events")
      .select("*")
      .eq("execution_id", executionId)
      .order("timestamp", { ascending: true });

    if (error) {
      console.error(
        "[supabase-stream-events] Error retrieving stream events:",
        error,
        { executionId }
      );
      return [];
    }

    return (data as StreamEventRow[]) || [];
  } catch (error) {
    console.error(
      "[supabase-stream-events] Unexpected error retrieving stream events:",
      error,
      { executionId }
    );
    return [];
  }
}

/**
 * Retrieve all stream events from Supabase (with optional limit)
 * Returns empty array if Supabase is not configured or on error
 */
export async function getAllStreamEvents(
  limit?: number
): Promise<StreamEventRow[]> {
  const supabase = createSupabaseClient();
  
  if (!supabase) {
    console.warn(
      "[supabase-stream-events] Supabase not configured, cannot retrieve events"
    );
    return [];
  }

  try {
    let query = supabase
      .from("stream_events")
      .select("*")
      .order("timestamp", { ascending: false });

    if (limit !== undefined) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error(
        "[supabase-stream-events] Error retrieving all stream events:",
        error
      );
      return [];
    }

    return (data as StreamEventRow[]) || [];
  } catch (error) {
    console.error(
      "[supabase-stream-events] Unexpected error retrieving all stream events:",
      error
    );
    return [];
  }
}

/**
 * Convert a StreamEventRow from database to StreamUpdate format
 */
export function convertStreamEventRowToUpdate(row: StreamEventRow): StreamUpdate {
  return {
    executionId: row.execution_id,
    stage: row.stage,
    status: row.status as "in_progress" | "completed" | "error" | "info",
    message: row.message,
    timestamp: row.timestamp,
    data: row.data || {},
  };
}

/**
 * Retrieve stream events for multiple execution IDs from Supabase
 * Returns empty array if Supabase is not configured or on error
 */
export async function getStreamEventsByExecutionIds(
  executionIds: string[]
): Promise<StreamEventRow[]> {
  const supabase = createSupabaseClient();
  
  if (!supabase) {
    console.warn(
      "[supabase-stream-events] Supabase not configured, cannot retrieve events"
    );
    return [];
  }

  if (executionIds.length === 0) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("stream_events")
      .select("*")
      .in("execution_id", executionIds)
      .order("timestamp", { ascending: true });

    if (error) {
      console.error(
        "[supabase-stream-events] Error retrieving stream events by execution IDs:",
        error,
        { executionIds }
      );
      return [];
    }

    return (data as StreamEventRow[]) || [];
  } catch (error) {
    console.error(
      "[supabase-stream-events] Unexpected error retrieving stream events by execution IDs:",
      error,
      { executionIds }
    );
    return [];
  }
}
