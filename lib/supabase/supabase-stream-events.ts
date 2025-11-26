/**
 * Supabase Stream Events
 * Handles persistence of stream monitor events to Supabase
 */

import { createSupabaseClient } from "./supabase-config";
import type { StreamUpdate } from "../n8n-client/types";

/**
 * Database row type for stream_events table (refactored schema)
 */
export interface StreamEventRow {
  id: string; // UUID primary key
  execution_id: string;
  message_id?: string; // UUID foreign key to chat_messages
  stage: string;
  status: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
  created_at: string;
}

/**
 * Save a StreamUpdate event to Supabase
 * Simplified: No table checks, just save
 */
export async function saveStreamEventToSupabase(
  update: StreamUpdate
): Promise<void> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return;
  }

  try {
    const eventRow: Partial<StreamEventRow> = {
      execution_id: update.executionId,
      message_id: update.metadata?.messageId,
      stage: update.stage,
      status: update.status,
      message: update.message,
      timestamp: update.timestamp,
      data: update.data || {},
    };

    const { error } = await supabase.from("stream_events").insert(eventRow);

    if (error) {
      console.error("[supabase-stream-events] Error saving event:", error);
    }
  } catch (error) {
    console.error("[supabase-stream-events] Error saving event:", error);
  }
}

/**
 * Retrieve stream events for a specific execution
 */
export async function getStreamEventsByExecutionId(
  executionId: string
): Promise<StreamEventRow[]> {
  const supabase = createSupabaseClient();
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("stream_events")
      .select("*")
      .eq("execution_id", executionId)
      .order("timestamp", { ascending: true });

    if (error) {
      console.error("[supabase-stream-events] Error retrieving events:", error);
      return [];
    }

    return (data as StreamEventRow[]) || [];
  } catch (error) {
    console.error("[supabase-stream-events] Error retrieving events:", error);
    return [];
  }
}

/**
 * Retrieve all stream events (with optional limit)
 */
export async function getAllStreamEvents(
  limit?: number
): Promise<StreamEventRow[]> {
  const supabase = createSupabaseClient();
  if (!supabase) {
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
      console.error("[supabase-stream-events] Error retrieving events:", error);
      return [];
    }

    return (data as StreamEventRow[]) || [];
  } catch (error) {
    console.error("[supabase-stream-events] Error retrieving events:", error);
    return [];
  }
}

/**
 * Convert a StreamEventRow from database to StreamUpdate format
 */
export function convertStreamEventRowToUpdate(row: StreamEventRow): StreamUpdate {
  return {
    executionId: row.execution_id,
    metadata: row.message_id ? {
      messageId: row.message_id,
      streamUrl: undefined, // Not stored in DB
    } : undefined,
    stage: row.stage,
    status: row.status as "in_progress" | "completed" | "error" | "info",
    message: row.message,
    timestamp: row.timestamp,
    data: row.data || {},
  };
}

/**
 * Retrieve stream events for multiple execution IDs
 */
export async function getStreamEventsByExecutionIds(
  executionIds: string[]
): Promise<StreamEventRow[]> {
  const supabase = createSupabaseClient();
  if (!supabase || executionIds.length === 0) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("stream_events")
      .select("*")
      .in("execution_id", executionIds)
      .order("timestamp", { ascending: true });

    if (error) {
      console.error("[supabase-stream-events] Error retrieving events:", error);
      return [];
    }

    return (data as StreamEventRow[]) || [];
  } catch (error) {
    console.error("[supabase-stream-events] Error retrieving events:", error);
    return [];
  }
}
