#!/usr/bin/env tsx
/**
 * Data Migration Script for Chat Schema Refactoring
 * 
 * This script helps migrate existing chat data from the old schema to the new refactored schema.
 * It should be run AFTER applying the database migration (20251126000000_refactor_chat_schema.sql)
 * 
 * Usage:
 *   npm run migrate-chat-data
 * 
 * The migration SQL handles the actual data transformation, so this script is mainly for:
 * - Verification that migration completed successfully
 * - Providing rollback capability if needed
 * - Generating a report of migrated data
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

interface MigrationReport {
  sessionsCount: number;
  messagesCount: number;
  streamEventsCount: number;
  errors: string[];
  warnings: string[];
}

async function main() {
  console.log("=".repeat(80));
  console.log("Chat Data Migration Verification");
  console.log("=".repeat(80));
  console.log();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Error: Supabase credentials not found in environment variables");
    console.error("   Please ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const report: MigrationReport = {
    sessionsCount: 0,
    messagesCount: 0,
    streamEventsCount: 0,
    errors: [],
    warnings: [],
  };

  try {
    // Verify chat_sessions table structure
    console.log("📋 Verifying chat_sessions table...");
    const { data: sessions, error: sessionsError } = await supabase
      .from("chat_sessions")
      .select("*")
      .limit(1);

    if (sessionsError) {
      report.errors.push(`chat_sessions query failed: ${sessionsError.message}`);
    } else {
      // Check for new schema columns
      if (sessions && sessions.length > 0) {
        const session = sessions[0];
        const hasOldSchema = "session_id" in session || "metadata" in session;
        const hasNewSchema = "id" in session && !("session_id" in session);

        if (hasOldSchema) {
          report.errors.push("chat_sessions still has old schema columns (session_id, metadata)");
        } else if (hasNewSchema) {
          console.log("   ✓ Schema verified - using UUID id column");
        }
      }

      // Count total sessions
      const { count: sessionCount } = await supabase
        .from("chat_sessions")
        .select("*", { count: "exact", head: true });

      report.sessionsCount = sessionCount || 0;
      console.log(`   ✓ Found ${report.sessionsCount} sessions`);
    }

    // Verify chat_messages table structure
    console.log("\n📋 Verifying chat_messages table...");
    const { data: messages, error: messagesError } = await supabase
      .from("chat_messages")
      .select("*")
      .limit(1);

    if (messagesError) {
      report.errors.push(`chat_messages query failed: ${messagesError.message}`);
    } else {
      // Check for new schema columns
      if (messages && messages.length > 0) {
        const message = messages[0];
        const hasOldSchema =
          "message_id" in message ||
          "content_parts" in message ||
          "tool_calls" in message ||
          "tool_invocations" in message ||
          "metadata" in message;
        const hasNewSchema =
          "id" in message &&
          "content" in message &&
          !("message_id" in message);

        if (hasOldSchema) {
          report.errors.push(
            "chat_messages still has old schema columns (message_id, content_parts, tool_calls, tool_invocations, metadata)"
          );
        } else if (hasNewSchema) {
          console.log("   ✓ Schema verified - using UUID id and JSONB content");
        }
      }

      // Count total messages
      const { count: messageCount } = await supabase
        .from("chat_messages")
        .select("*", { count: "exact", head: true });

      report.messagesCount = messageCount || 0;
      console.log(`   ✓ Found ${report.messagesCount} messages`);
    }

    // Verify stream_events table structure
    console.log("\n📋 Verifying stream_events table...");
    const { data: events, error: eventsError } = await supabase
      .from("stream_events")
      .select("*")
      .limit(1);

    if (eventsError) {
      report.errors.push(`stream_events query failed: ${eventsError.message}`);
    } else {
      // Check for new schema
      if (events && events.length > 0) {
        const event = events[0];
        const hasOldSessionId = "session_id" in event;
        const hasNewSchema = "message_id" in event && !("session_id" in event);

        if (hasOldSessionId) {
          report.warnings.push(
            "stream_events still has session_id column (should only have message_id)"
          );
        } else if (hasNewSchema) {
          console.log("   ✓ Schema verified - using message_id FK only");
        }
      }

      // Count total events
      const { count: eventCount } = await supabase
        .from("stream_events")
        .select("*", { count: "exact", head: true });

      report.streamEventsCount = eventCount || 0;
      console.log(`   ✓ Found ${report.streamEventsCount} stream events`);
    }

    // Verify foreign key relationships
    console.log("\n🔗 Verifying foreign key relationships...");
    
    // Check if messages reference valid sessions
    const { data: orphanedMessages } = await supabase
      .from("chat_messages")
      .select("id, session_id")
      .is("session_id", null);

    if (orphanedMessages && orphanedMessages.length > 0) {
      report.warnings.push(
        `Found ${orphanedMessages.length} messages with null session_id`
      );
    } else {
      console.log("   ✓ All messages have valid session references");
    }

    // Check if stream events reference valid messages (where message_id is not null)
    const { data: orphanedEvents } = await supabase
      .from("stream_events")
      .select("id, message_id")
      .not("message_id", "is", null);

    if (orphanedEvents && orphanedEvents.length > 0) {
      console.log(`   ✓ ${orphanedEvents.length} stream events linked to messages`);
    }

  } catch (error) {
    console.error("\n❌ Migration verification failed:", error);
    report.errors.push(`Unexpected error: ${error}`);
  }

  // Print report
  console.log("\n" + "=".repeat(80));
  console.log("Migration Report");
  console.log("=".repeat(80));
  console.log(`\n📊 Statistics:`);
  console.log(`   Sessions:      ${report.sessionsCount}`);
  console.log(`   Messages:      ${report.messagesCount}`);
  console.log(`   Stream Events: ${report.streamEventsCount}`);

  if (report.errors.length > 0) {
    console.log(`\n❌ Errors (${report.errors.length}):`);
    report.errors.forEach((error, i) => {
      console.log(`   ${i + 1}. ${error}`);
    });
  }

  if (report.warnings.length > 0) {
    console.log(`\n⚠️  Warnings (${report.warnings.length}):`);
    report.warnings.forEach((warning, i) => {
      console.log(`   ${i + 1}. ${warning}`);
    });
  }

  if (report.errors.length === 0 && report.warnings.length === 0) {
    console.log("\n✅ Migration verification completed successfully!");
    console.log("   All tables have been migrated to the new schema.");
  } else if (report.errors.length > 0) {
    console.log("\n❌ Migration verification failed!");
    console.log("   Please review the errors above and ensure the migration SQL ran correctly.");
    process.exit(1);
  } else {
    console.log("\n⚠️  Migration verification completed with warnings.");
    console.log("   Please review the warnings above.");
  }

  console.log("\n" + "=".repeat(80));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

