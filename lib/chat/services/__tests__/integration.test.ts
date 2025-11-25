/**
 * Integration Tests for Chat Services
 * Tests the interaction between MessageLoaderService and SessionManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageLoaderService, type Thread } from '../message-loader';
import { SessionManager } from '../session-manager';
import { MockChatRepository } from '../../repositories/mock-chat-repository';
import type { SessionStoreOperations } from '../session-manager';
import type { ValidatedMessage } from '../../message-validation';

describe('Chat Services Integration', () => {
  let messageLoader: MessageLoaderService;
  let sessionManager: SessionManager;
  let repository: MockChatRepository;
  let store: SessionStoreOperations;
  let activeSessionId: string | null = null;
  let activeSessionTitle: string | null = null;

  beforeEach(() => {
    messageLoader = new MessageLoaderService();
    repository = new MockChatRepository();
    
    store = {
      getActiveSessionId: () => activeSessionId,
      setActiveSession: (sessionId: string | null, title?: string | null) => {
        activeSessionId = sessionId;
        activeSessionTitle = title || null;
      },
      clearActiveSession: () => {
        activeSessionId = null;
        activeSessionTitle = null;
      },
    };

    sessionManager = new SessionManager(repository, store);
    activeSessionId = null;
    activeSessionTitle = null;
  });

  describe('Session Creation and Message Loading', () => {
    it('should create a session and load messages into thread', async () => {
      // Create a new session
      const sessionId = await sessionManager.createNewSession({
        title: 'Integration Test Session',
        userId: 'user-1',
      });

      expect(sessionId).toBeDefined();
      expect(activeSessionId).toBe(sessionId);
      expect(activeSessionTitle).toBe('Integration Test Session');

      // Create messages
      const messages: ValidatedMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hi there!',
        },
      ];

      // Mock thread
      const importFn: Thread['import'] = vi.fn().mockImplementation((options: { messages: ValidatedMessage[] }) => {
        expect(options.messages).toEqual(messages);
      });
      const thread: Thread = {
        reset: () => {},
        import: importFn,
      };

      // Load messages
      const shouldLoad = messageLoader.shouldLoadMessages(
        [],
        messages,
        null,
        sessionId
      );
      expect(shouldLoad).toBe(true);

      await messageLoader.loadMessagesIntoThread(
        thread,
        messages,
        [],
        null,
        sessionId
      );
    });

    it('should handle session switching with message loading', async () => {
      // Create first session
      const session1 = await sessionManager.createNewSession({
        title: 'Session 1',
      });

      const messages1: ValidatedMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Message 1' },
      ];

      const importFn: Thread['import'] = vi.fn();
      const thread: Thread = {
        reset: () => {},
        import: importFn,
      };

      // Load messages for session 1
      await messageLoader.loadMessagesIntoThread(
        thread,
        messages1,
        [],
        null,
        session1
      );

      expect(thread.import).toHaveBeenCalledWith({ messages: messages1 });

      // Create and switch to second session
      const session2 = await sessionManager.createNewSession({
        title: 'Session 2',
      });

      await sessionManager.switchSession(session2);
      expect(activeSessionId).toBe(session2);

      const messages2: ValidatedMessage[] = [
        { id: 'msg-2', role: 'user', content: 'Message 2' },
      ];

      // Load messages for session 2 (should reset thread)
      const resetSpy = vi.fn();
      const importFn2: Thread['import'] = vi.fn();
      const thread2: Thread = {
        reset: resetSpy,
        import: importFn2,
      };

      await messageLoader.loadMessagesIntoThread(
        thread2,
        messages2,
        messages1,
        session1,
        session2
      );

      expect(resetSpy).toHaveBeenCalled();
      expect(thread2.import).toHaveBeenCalledWith({ messages: messages2 });
    });

    it('should prevent duplicate message loading', async () => {
      const sessionId = await sessionManager.createNewSession();

      const messages: ValidatedMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Message 1' },
        { id: 'msg-2', role: 'assistant', content: 'Response 1' },
      ];

      const importFn: Thread['import'] = vi.fn();
      const thread: Thread = {
        reset: () => {},
        import: importFn,
      };

      // First load
      await messageLoader.loadMessagesIntoThread(
        thread,
        messages,
        [],
        null,
        sessionId
      );

      expect(thread.import).toHaveBeenCalledTimes(1);

      // Try to load again (should be skipped)
      const shouldLoad = messageLoader.shouldLoadMessages(
        messages,
        messages,
        sessionId,
        sessionId
      );
      expect(shouldLoad).toBe(false);

      await messageLoader.loadMessagesIntoThread(
        thread,
        messages,
        messages,
        sessionId,
        sessionId
      );

      // Should not import again
      expect(thread.import).toHaveBeenCalledTimes(1);
    });
  });

  describe('Session Lifecycle with Messages', () => {
    it('should handle complete session lifecycle', async () => {
      // Create session
      const sessionId = await sessionManager.createNewSession({
        title: 'Lifecycle Session',
        userId: 'user-1',
      });

      // Add messages to repository
      repository.addMessage(sessionId, {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
      });

      // Retrieve messages
      const messages = await repository.getMessages(sessionId);
      expect(messages.length).toBe(1);

      // Update session
      await sessionManager.updateSession(sessionId, {
        title: 'Updated Lifecycle Session',
      });

      const session = await repository.getSessionById(sessionId);
      expect(session?.title).toBe('Updated Lifecycle Session');

      // Delete session
      activeSessionId = sessionId;
      const deleted = await sessionManager.deleteSession(sessionId);
      expect(deleted).toBe(true);
      expect(activeSessionId).toBeNull();

      // Verify messages are gone
      const messagesAfterDelete = await repository.getMessages(sessionId);
      expect(messagesAfterDelete.length).toBe(0);
    });

    it('should handle multiple sessions with different messages', async () => {
      // Create multiple sessions
      const session1 = await sessionManager.createNewSession({ title: 'Session 1' });
      const session2 = await sessionManager.createNewSession({ title: 'Session 2' });

      // Add messages to each
      repository.addMessage(session1, {
        id: 'msg-1',
        role: 'user',
        content: 'Session 1 message',
      });

      repository.addMessage(session2, {
        id: 'msg-2',
        role: 'user',
        content: 'Session 2 message',
      });

      // Switch between sessions
      await sessionManager.switchSession(session1);
      const messages1 = await repository.getMessages(session1);
      expect(messages1.length).toBe(1);

      await sessionManager.switchSession(session2);
      const messages2 = await repository.getMessages(session2);
      expect(messages2.length).toBe(1);

      // Verify isolation
      expect(messages1[0].content).toBe('Session 1 message');
      expect(messages2[0].content).toBe('Session 2 message');
    });
  });

  describe('Error Handling', () => {
    it('should handle thread without import method', async () => {
      const sessionId = await sessionManager.createNewSession();
      const messages: ValidatedMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Test' },
      ];

      // Create a thread without import method to test error handling
      const invalidThread: Partial<Thread> = {
        reset: () => {},
        // Missing import method
      };

      await expect(
        messageLoader.loadMessagesIntoThread(
          invalidThread as Thread,
          messages,
          [],
          null,
          sessionId
        )
      ).rejects.toThrow('Thread runtime does not support import()');
    });

    it('should handle session operations on non-existent sessions', async () => {
      // Try to switch to non-existent session
      await sessionManager.switchSession('non-existent');
      expect(activeSessionId).toBe('non-existent');

      // Try to update non-existent session
      const updated = await sessionManager.updateSession('non-existent', {
        title: 'New Title',
      });
      expect(updated).toBe(false);

      // Try to delete non-existent session
      const deleted = await sessionManager.deleteSession('non-existent');
      expect(deleted).toBe(false);
    });
  });
});

