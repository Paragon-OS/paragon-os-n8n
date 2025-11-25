/**
 * Unit Tests for SessionManager
 * Tests session creation, switching, deletion, and management logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../session-manager';
import type { ChatRepository, SessionMetadata } from '../../repositories/chat-repository.interface';
import type { SessionStoreOperations } from '../session-manager';
import type { ChatSessionRow } from '@/lib/supabase/supabase-chat';
import { MockChatRepository } from '../../repositories/mock-chat-repository';

describe('SessionManager', () => {
  let manager: SessionManager;
  let mockRepository: ChatRepository;
  let mockStore: SessionStoreOperations;
  let getActiveSessionIdSpy: ReturnType<typeof vi.fn>;
  let setActiveSessionSpy: ReturnType<typeof vi.fn>;
  let clearActiveSessionSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRepository = new MockChatRepository();
    getActiveSessionIdSpy = vi.fn(() => null);
    setActiveSessionSpy = vi.fn();
    clearActiveSessionSpy = vi.fn();

    mockStore = {
      getActiveSessionId: getActiveSessionIdSpy,
      setActiveSession: setActiveSessionSpy,
      clearActiveSession: clearActiveSessionSpy,
    };

    manager = new SessionManager(mockRepository, mockStore);
  });

  describe('switchSession', () => {
    it('should switch to an existing session', async () => {
      const sessionId = 'session-1';
      const sessionTitle = 'Test Session';
      
      // Create session in repository
      await mockRepository.createSession(sessionId, { title: sessionTitle });

      await manager.switchSession(sessionId);

      expect(setActiveSessionSpy).toHaveBeenCalledWith(sessionId, sessionTitle);
    });

    it('should handle session with null title', async () => {
      const sessionId = 'session-2';
      
      // Create session without title
      await mockRepository.createSession(sessionId);

      await manager.switchSession(sessionId);

      expect(setActiveSessionSpy).toHaveBeenCalledWith(sessionId, null);
    });

    it('should handle non-existent session gracefully', async () => {
      const sessionId = 'non-existent-session';

      await manager.switchSession(sessionId);

      // Should still call setActiveSession, but with null title
      expect(setActiveSessionSpy).toHaveBeenCalledWith(sessionId, null);
    });

    it('should update store with session title from repository', async () => {
      const sessionId = 'session-3';
      const sessionTitle = 'Updated Title';
      
      await mockRepository.createSession(sessionId, { title: 'Original Title' });
      await mockRepository.updateSession(sessionId, { title: sessionTitle });

      await manager.switchSession(sessionId);

      const session = await mockRepository.getSessionById(sessionId);
      expect(setActiveSessionSpy).toHaveBeenCalledWith(sessionId, sessionTitle);
    });
  });

  describe('createNewSession', () => {
    it('should create a new session with generated ID', async () => {
      const sessionId = await manager.createNewSession();

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(sessionId).toContain('session-');
      
      const session = await mockRepository.getSessionById(sessionId);
      expect(session).not.toBeNull();
      expect(setActiveSessionSpy).toHaveBeenCalledWith(sessionId, null);
    });

    it('should create session with metadata', async () => {
      const metadata: SessionMetadata = {
        title: 'New Test Session',
        userId: 'user-123',
        metadata: { source: 'test' },
      };

      const sessionId = await manager.createNewSession(metadata);

      const session = await mockRepository.getSessionById(sessionId);
      expect(session).not.toBeNull();
      expect(session?.title).toBe(metadata.title);
      expect(session?.user_id).toBe(metadata.userId);
      expect(setActiveSessionSpy).toHaveBeenCalledWith(sessionId, metadata.title);
    });

    it('should create session with only title', async () => {
      const metadata: SessionMetadata = {
        title: 'Title Only Session',
      };

      const sessionId = await manager.createNewSession(metadata);

      const session = await mockRepository.getSessionById(sessionId);
      expect(session?.title).toBe(metadata.title);
      expect(setActiveSessionSpy).toHaveBeenCalledWith(sessionId, metadata.title);
    });

    it('should generate unique session IDs', async () => {
      const id1 = await manager.createNewSession();
      const id2 = await manager.createNewSession();

      expect(id1).not.toBe(id2);
    });

    it('should update store after creating session', async () => {
      const metadata: SessionMetadata = {
        title: 'Store Test Session',
      };

      const sessionId = await manager.createNewSession(metadata);

      expect(setActiveSessionSpy).toHaveBeenCalledTimes(1);
      expect(setActiveSessionSpy).toHaveBeenCalledWith(sessionId, metadata.title);
    });
  });

  describe('deleteSession', () => {
    it('should delete an existing session', async () => {
      const sessionId = 'session-to-delete';
      await mockRepository.createSession(sessionId);

      const result = await manager.deleteSession(sessionId);

      expect(result).toBe(true);
      const session = await mockRepository.getSessionById(sessionId);
      expect(session).toBeNull();
    });

    it('should return false when deleting non-existent session', async () => {
      const result = await manager.deleteSession('non-existent');

      expect(result).toBe(false);
    });

    it('should clear active session if it is the one being deleted', async () => {
      const sessionId = 'active-session';
      await mockRepository.createSession(sessionId);
      getActiveSessionIdSpy.mockReturnValue(sessionId);

      const result = await manager.deleteSession(sessionId);

      expect(result).toBe(true);
      expect(clearActiveSessionSpy).toHaveBeenCalledTimes(1);
    });

    it('should not clear active session if deleting different session', async () => {
      const sessionId1 = 'session-1';
      const sessionId2 = 'session-2';
      
      await mockRepository.createSession(sessionId1);
      await mockRepository.createSession(sessionId2);
      getActiveSessionIdSpy.mockReturnValue(sessionId1);

      const result = await manager.deleteSession(sessionId2);

      expect(result).toBe(true);
      expect(clearActiveSessionSpy).not.toHaveBeenCalled();
      expect(getActiveSessionIdSpy).toHaveBeenCalled();
    });

    it('should handle deletion when no active session', async () => {
      const sessionId = 'session-to-delete';
      await mockRepository.createSession(sessionId);
      getActiveSessionIdSpy.mockReturnValue(null);

      const result = await manager.deleteSession(sessionId);

      expect(result).toBe(true);
      expect(clearActiveSessionSpy).not.toHaveBeenCalled();
    });
  });

  describe('ensureSessionExists', () => {
    it('should create session if it does not exist', async () => {
      const sessionId = 'new-session';
      const metadata: SessionMetadata = {
        title: 'Ensure Test',
        userId: 'user-1',
      };

      await manager.ensureSessionExists(sessionId, metadata);

      const session = await mockRepository.getSessionById(sessionId);
      expect(session).not.toBeNull();
      expect(session?.title).toBe(metadata.title);
    });

    it('should not throw if session already exists', async () => {
      const sessionId = 'existing-session';
      await mockRepository.createSession(sessionId);

      await expect(
        manager.ensureSessionExists(sessionId)
      ).resolves.not.toThrow();

      const session = await mockRepository.getSessionById(sessionId);
      expect(session).not.toBeNull();
    });

    it('should create session without metadata', async () => {
      const sessionId = 'session-no-metadata';

      await manager.ensureSessionExists(sessionId);

      const session = await mockRepository.getSessionById(sessionId);
      expect(session).not.toBeNull();
    });
  });

  describe('getActiveSessionId', () => {
    it('should return active session ID from store', () => {
      const sessionId = 'active-session';
      getActiveSessionIdSpy.mockReturnValue(sessionId);

      const result = manager.getActiveSessionId();

      expect(result).toBe(sessionId);
      expect(getActiveSessionIdSpy).toHaveBeenCalled();
    });

    it('should return null when no active session', () => {
      getActiveSessionIdSpy.mockReturnValue(null);

      const result = manager.getActiveSessionId();

      expect(result).toBeNull();
    });
  });

  describe('updateSession', () => {
    it('should update session title', async () => {
      const sessionId = 'session-to-update';
      await mockRepository.createSession(sessionId, { title: 'Original Title' });

      const result = await manager.updateSession(sessionId, {
        title: 'Updated Title',
      });

      expect(result).toBe(true);
      const session = await mockRepository.getSessionById(sessionId);
      expect(session?.title).toBe('Updated Title');
    });

    it('should update session metadata', async () => {
      const sessionId = 'session-to-update';
      await mockRepository.createSession(sessionId);

      const newMetadata = { key: 'value', count: 42 };
      const result = await manager.updateSession(sessionId, {
        metadata: newMetadata,
      });

      expect(result).toBe(true);
      const session = await mockRepository.getSessionById(sessionId);
      expect(session?.metadata).toEqual(newMetadata);
    });

    it('should update both title and metadata', async () => {
      const sessionId = 'session-to-update';
      await mockRepository.createSession(sessionId);

      const result = await manager.updateSession(sessionId, {
        title: 'New Title',
        metadata: { updated: true },
      });

      expect(result).toBe(true);
      const session = await mockRepository.getSessionById(sessionId);
      expect(session?.title).toBe('New Title');
      expect(session?.metadata).toEqual({ updated: true });
    });

    it('should return false for non-existent session', async () => {
      const result = await manager.updateSession('non-existent', {
        title: 'New Title',
      });

      expect(result).toBe(false);
    });

    it('should handle partial updates', async () => {
      const sessionId = 'session-to-update';
      await mockRepository.createSession(sessionId, {
        title: 'Original Title',
        metadata: { original: true },
      });

      // Update only title
      await manager.updateSession(sessionId, { title: 'New Title' });

      const session = await mockRepository.getSessionById(sessionId);
      expect(session?.title).toBe('New Title');
      // Metadata should still exist (implementation dependent)
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete session lifecycle', async () => {
      // Create session
      const sessionId = await manager.createNewSession({
        title: 'Lifecycle Test',
        userId: 'user-1',
      });
      expect(sessionId).toBeDefined();

      // Switch to it
      await manager.switchSession(sessionId);
      expect(setActiveSessionSpy).toHaveBeenCalled();

      // Update it
      const updateResult = await manager.updateSession(sessionId, {
        title: 'Updated Lifecycle Test',
      });
      expect(updateResult).toBe(true);

      // Delete it
      getActiveSessionIdSpy.mockReturnValue(sessionId);
      const deleteResult = await manager.deleteSession(sessionId);
      expect(deleteResult).toBe(true);
      expect(clearActiveSessionSpy).toHaveBeenCalled();
    });

    it('should handle multiple sessions', async () => {
      const session1 = await manager.createNewSession({ title: 'Session 1' });
      const session2 = await manager.createNewSession({ title: 'Session 2' });

      expect(session1).not.toBe(session2);

      await manager.switchSession(session1);
      await manager.switchSession(session2);

      expect(setActiveSessionSpy).toHaveBeenCalledTimes(4); // 2 creates + 2 switches
    });

    it('should handle rapid session creation', async () => {
      const sessions = await Promise.all([
        manager.createNewSession(),
        manager.createNewSession(),
        manager.createNewSession(),
      ]);

      expect(sessions.length).toBe(3);
      expect(new Set(sessions).size).toBe(3); // All unique

      for (const sessionId of sessions) {
        const session = await mockRepository.getSessionById(sessionId);
        expect(session).not.toBeNull();
      }
    });
  });
});

