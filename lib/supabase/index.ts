/**
 * Supabase Integration Module
 * Central export point for all Supabase functionality
 */

// Configuration
export {
  getSupabaseUrl,
  getSupabaseAnonKey,
  createSupabaseClient,
} from "./supabase-config";

// Migrations
export {
  checkStreamEventsTable,
  getMigrationFiles,
  readMigrationFile,
  needsMigrations,
  logMigrationInstructions,
} from "./supabase-migrations";

// Stream Events
export {
  saveStreamEventToSupabase,
  getStreamEventsByExecutionId,
  getAllStreamEvents,
  convertStreamEventRowToUpdate,
  getStreamEventsByExecutionIds,
} from "./supabase-stream-events";

export type { StreamEventRow } from "./supabase-stream-events";

// Chat Persistence
export {
  saveChatMessagesToSupabase,
  saveChatMessageToSupabase,
  getChatMessagesBySessionId,
  getAllChatSessions,
  getChatSessionById,
  updateChatSession,
  deleteChatSession,
  getChatMessageCount,
  convertRowToUIMessage,
} from "./supabase-chat";

export type {
  ChatSessionRow,
  ChatMessageRow,
  UIMessage,
  SaveChatMessagesOptions,
  GetChatMessagesOptions,
} from "./supabase-chat";

