/**
 * Chat Persistence Tests
 * 
 * These tests verify the chat persistence functionality.
 * Run with: npm test lib/supabase/__tests__/chat-persistence.test.ts
 * 
 * Prerequisites:
 * - Supabase must be running (npm run db:start)
 * - Migrations must be applied
 * - Environment variables must be set
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  saveChatMessagesToSupabase,
  getChatMessagesBySessionId,
  getAllChatSessions,
  getChatSessionById,
  updateChatSession,
  deleteChatSession,
  getChatMessageCount,
  type UIMessage,
} from "../supabase-chat";
import { isSupabaseReady, getSupabaseStatus } from "./test-helpers";

// Check if Supabase is ready at module load time
const IS_SUPABASE_READY = isSupabaseReady();

// Test data
const testSessionId = `test-session-${Date.now()}`;
const testUserId = "test-user-123";

const testMessages: UIMessage[] = [
  {
    id: "msg-1",
    role: "user",
    content: "Hello, this is a test message",
  },
  {
    id: "msg-2",
    role: "assistant",
    content: "Hi! This is a test response",
  },
  {
    id: "msg-3",
    role: "user",
    content: ["This is a multipart message", { type: "text", text: "with parts" }],
  },
];

describe("Chat Persistence", () => {
  let supabaseStatus: ReturnType<typeof getSupabaseStatus>;

  beforeAll(() => {
    // Check Supabase status and provide helpful information
    supabaseStatus = getSupabaseStatus();
    const isReady = isSupabaseReady();

    if (!isReady) {
      console.warn("\n⚠️  Supabase is not ready for testing.");
      console.log("Status:", {
        configured: supabaseStatus.configured,
        running: supabaseStatus.running,
        url: supabaseStatus.url || "not set",
        hasAnonKey: supabaseStatus.hasAnonKey,
      });
      console.log("\nTo run these tests:");
      console.log("  1. Start Supabase: npm run db:start");
      console.log("  2. Set environment variables in .env.local:");
      console.log("     NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321");
      console.log("     NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>");
      console.log("\nTests will be skipped if Supabase is not ready.\n");
    }
  });

  describe("Save and Retrieve Messages", () => {
    it.skipIf(!IS_SUPABASE_READY)("should save messages to a session", async () => {
      await saveChatMessagesToSupabase({
        sessionId: testSessionId,
        messages: testMessages,
        userId: testUserId,
        sessionTitle: "Test Chat Session",
        sessionMetadata: {
          source: "test",
          environment: "development",
        },
      });

      // Verify messages were saved
      const retrievedMessages = await getChatMessagesBySessionId({
        sessionId: testSessionId,
      });

      expect(retrievedMessages.length).toBeGreaterThanOrEqual(testMessages.length);
    });

    it.skipIf(!IS_SUPABASE_READY)("should retrieve messages by session ID", async () => {
      const messages = await getChatMessagesBySessionId({
        sessionId: testSessionId,
        limit: 10,
      });

      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBeGreaterThan(0);

      // Verify message structure
      const firstMessage = messages[0];
      expect(firstMessage).toHaveProperty("id");
      expect(firstMessage).toHaveProperty("role");
      expect(firstMessage).toHaveProperty("content");
    });

    it.skipIf(!IS_SUPABASE_READY)("should handle pagination", async () => {
      const page1 = await getChatMessagesBySessionId({
        sessionId: testSessionId,
        limit: 2,
        offset: 0,
      });

      const page2 = await getChatMessagesBySessionId({
        sessionId: testSessionId,
        limit: 2,
        offset: 2,
      });

      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);
    });
  });

  describe("Session Management", () => {
    it.skipIf(!IS_SUPABASE_READY)("should retrieve session by ID", async () => {
      const session = await getChatSessionById(testSessionId);

      expect(session).not.toBeNull();
      expect(session?.session_id).toBe(testSessionId);
      expect(session?.user_id).toBe(testUserId);
      expect(session?.title).toBe("Test Chat Session");
    });

    it.skipIf(!IS_SUPABASE_READY)("should list all sessions", async () => {
      const sessions = await getAllChatSessions(10);

      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBeGreaterThan(0);

      // Verify our test session is in the list
      const testSession = sessions.find((s) => s.session_id === testSessionId);
      expect(testSession).toBeDefined();
    });

    it.skipIf(!IS_SUPABASE_READY)("should filter sessions by user ID", async () => {
      const sessions = await getAllChatSessions(10, testUserId);

      expect(Array.isArray(sessions)).toBe(true);
      sessions.forEach((session) => {
        expect(session.user_id).toBe(testUserId);
      });
    });

    it.skipIf(!IS_SUPABASE_READY)("should update session metadata", async () => {
      const success = await updateChatSession(testSessionId, {
        title: "Updated Test Title",
        metadata: {
          updated: true,
          timestamp: new Date().toISOString(),
        },
      });

      expect(success).toBe(true);

      // Verify update
      const session = await getChatSessionById(testSessionId);
      expect(session?.title).toBe("Updated Test Title");
      expect(session?.metadata).toHaveProperty("updated", true);
    });

    it.skipIf(!IS_SUPABASE_READY)("should get message count for session", async () => {
      const count = await getChatMessageCount(testSessionId);

      expect(count).toBeGreaterThanOrEqual(testMessages.length);
      expect(typeof count).toBe("number");
    });
  });

  describe("Message Format Compatibility", () => {
    it.skipIf(!IS_SUPABASE_READY)("should handle simple text messages", async () => {
      const simpleMessage: UIMessage = {
        id: "simple-1",
        role: "user",
        content: "Simple text message",
      };

      await saveChatMessagesToSupabase({
        sessionId: testSessionId,
        messages: [simpleMessage],
      });

      const messages = await getChatMessagesBySessionId({
        sessionId: testSessionId,
      });

      const retrieved = messages.find((m) => m.id === "simple-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe("Simple text message");
    });

    it.skipIf(!IS_SUPABASE_READY)("should handle multipart messages", async () => {
      const multipartMessage: UIMessage = {
        id: "multipart-1",
        role: "assistant",
        content: [
          { type: "text", text: "Part 1" },
          { type: "text", text: "Part 2" },
        ],
      };

      await saveChatMessagesToSupabase({
        sessionId: testSessionId,
        messages: [multipartMessage],
      });

      const messages = await getChatMessagesBySessionId({
        sessionId: testSessionId,
      });

      const retrieved = messages.find((m) => m.id === "multipart-1");
      expect(retrieved).toBeDefined();
      expect(Array.isArray(retrieved?.content)).toBe(true);
    });

    it.skipIf(!IS_SUPABASE_READY)("should handle tool invocations", async () => {
      const toolMessage: UIMessage = {
        id: "tool-1",
        role: "assistant",
        content: "Using tool",
        toolInvocations: [
          {
            id: "tool-invocation-1",
            toolName: "testTool",
            args: { param: "value" },
            result: { success: true },
          },
        ],
      };

      await saveChatMessagesToSupabase({
        sessionId: testSessionId,
        messages: [toolMessage],
      });

      const messages = await getChatMessagesBySessionId({
        sessionId: testSessionId,
      });

      const retrieved = messages.find((m) => m.id === "tool-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.toolInvocations).toBeDefined();
      expect(Array.isArray(retrieved?.toolInvocations)).toBe(true);
    });
  });

  describe("Cleanup", () => {
    it.skipIf(!IS_SUPABASE_READY)("should delete session and all messages", async () => {
      const success = await deleteChatSession(testSessionId);

      expect(success).toBe(true);

      // Verify deletion
      const session = await getChatSessionById(testSessionId);
      expect(session).toBeNull();

      const messages = await getChatMessagesBySessionId({
        sessionId: testSessionId,
      });
      expect(messages.length).toBe(0);
    });
  });

  describe("Error Handling", () => {
    it.skipIf(!IS_SUPABASE_READY)("should handle non-existent session gracefully", async () => {
      const messages = await getChatMessagesBySessionId({
        sessionId: "non-existent-session",
      });

      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBe(0);
    });

    it.skipIf(!IS_SUPABASE_READY)("should return null for non-existent session", async () => {
      const session = await getChatSessionById("non-existent-session");

      expect(session).toBeNull();
    });

    it.skipIf(!IS_SUPABASE_READY)("should return 0 for message count of non-existent session", async () => {
      const count = await getChatMessageCount("non-existent-session");

      expect(count).toBe(0);
    });
  });
});

/**
 * Manual Test Instructions:
 * 
 * 1. Start Supabase:
 *    npm run db:start
 * 
 * 2. Ensure environment variables are set in .env.local:
 *    NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
 *    NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
 * 
 * 3. Run tests:
 *    npm test lib/supabase/__tests__/chat-persistence.test.ts
 * 
 * 4. Check Supabase Studio to verify data:
 *    http://localhost:54323
 * 
 * 5. View tables:
 *    - chat_sessions
 *    - chat_messages
 */

