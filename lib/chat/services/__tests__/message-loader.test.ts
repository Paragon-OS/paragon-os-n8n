/**
 * Unit Tests for MessageLoaderService
 * Tests the message loading logic and thread management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageLoaderService, type Thread } from '../message-loader';
import type { ValidatedMessage } from '../../message-validation';

describe('MessageLoaderService', () => {
  let service: MessageLoaderService;
  let mockThread: Thread;
  let resetSpy: ReturnType<typeof vi.fn>;
  let importSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new MessageLoaderService();
    resetSpy = vi.fn();
    importSpy = vi.fn();
    
    mockThread = {
      reset: resetSpy,
      import: importSpy,
    } as unknown as Thread;
  });

  describe('shouldLoadMessages', () => {
    const createMessage = (id: string, role: 'user' | 'assistant' = 'user'): ValidatedMessage => ({
      id,
      role,
      content: `Message ${id}`,
    });

    it('should return true when switching sessions', () => {
      const current: ValidatedMessage[] = [createMessage('msg-1')];
      const incoming: ValidatedMessage[] = [createMessage('msg-2')];
      
      const result = service.shouldLoadMessages(
        current,
        incoming,
        'session-1',
        'session-2'
      );
      
      expect(result).toBe(true);
    });

    it('should return true on first load if there are messages', () => {
      const current: ValidatedMessage[] = [];
      const incoming: ValidatedMessage[] = [createMessage('msg-1')];
      
      const result = service.shouldLoadMessages(
        current,
        incoming,
        null,
        'session-1'
      );
      
      expect(result).toBe(true);
    });

    it('should return false on first load if there are no messages', () => {
      const current: ValidatedMessage[] = [];
      const incoming: ValidatedMessage[] = [];
      
      const result = service.shouldLoadMessages(
        current,
        incoming,
        null,
        'session-1'
      );
      
      expect(result).toBe(false);
    });

    it('should return false if same session and no incoming messages', () => {
      const current: ValidatedMessage[] = [createMessage('msg-1')];
      const incoming: ValidatedMessage[] = [];
      
      const result = service.shouldLoadMessages(
        current,
        incoming,
        'session-1',
        'session-1'
      );
      
      expect(result).toBe(false);
    });

    it('should return true if same session and new messages exist', () => {
      const current: ValidatedMessage[] = [createMessage('msg-1')];
      const incoming: ValidatedMessage[] = [
        createMessage('msg-1'),
        createMessage('msg-2'),
      ];
      
      const result = service.shouldLoadMessages(
        current,
        incoming,
        'session-1',
        'session-1'
      );
      
      expect(result).toBe(true);
    });

    it('should return false if same session and all messages already loaded', () => {
      const current: ValidatedMessage[] = [
        createMessage('msg-1'),
        createMessage('msg-2'),
      ];
      const incoming: ValidatedMessage[] = [
        createMessage('msg-1'),
        createMessage('msg-2'),
      ];
      
      const result = service.shouldLoadMessages(
        current,
        incoming,
        'session-1',
        'session-1'
      );
      
      expect(result).toBe(false);
    });

    it('should return true if same session but different message IDs', () => {
      const current: ValidatedMessage[] = [createMessage('msg-1')];
      const incoming: ValidatedMessage[] = [createMessage('msg-2')];
      
      const result = service.shouldLoadMessages(
        current,
        incoming,
        'session-1',
        'session-1'
      );
      
      expect(result).toBe(true);
    });

    it('should return true if same session but different number of messages', () => {
      const current: ValidatedMessage[] = [createMessage('msg-1')];
      const incoming: ValidatedMessage[] = [
        createMessage('msg-1'),
        createMessage('msg-2'),
        createMessage('msg-3'),
      ];
      
      const result = service.shouldLoadMessages(
        current,
        incoming,
        'session-1',
        'session-1'
      );
      
      expect(result).toBe(true);
    });

    it('should handle empty current messages correctly', () => {
      const current: ValidatedMessage[] = [];
      const incoming: ValidatedMessage[] = [createMessage('msg-1')];
      
      const result = service.shouldLoadMessages(
        current,
        incoming,
        'session-1',
        'session-1'
      );
      
      expect(result).toBe(true);
    });
  });

  describe('loadMessagesIntoThread', () => {
    const createMessage = (id: string, role: 'user' | 'assistant' = 'user'): ValidatedMessage => ({
      id,
      role,
      content: `Message ${id}`,
    });

    // Helper to convert messages to the format expected by thread.import()
    const toThreadMessages = (messages: ValidatedMessage[]) => 
      messages.map((msg, idx) => ({
        message: msg,
        parentId: idx > 0 ? messages[idx - 1].id : null,
      }));

    it('should throw error if thread does not support import', async () => {
      const invalidThread = {
        reset: vi.fn(),
      } as unknown as Thread;

      await expect(
        service.loadMessagesIntoThread(
          invalidThread,
          [createMessage('msg-1')],
          [],
          null,
          'session-1'
        )
      ).rejects.toThrow('Thread runtime does not support import()');
    });

    it('should reset thread when switching sessions', async () => {
      const current: ValidatedMessage[] = [createMessage('msg-1')];
      const incoming: ValidatedMessage[] = [createMessage('msg-2')];

      await service.loadMessagesIntoThread(
        mockThread,
        incoming,
        current,
        'session-1',
        'session-2'
      );

      expect(resetSpy).toHaveBeenCalledTimes(1);
      expect(importSpy).toHaveBeenCalledWith({ messages: toThreadMessages(incoming) });
    });

    it('should not reset thread when same session', async () => {
      const current: ValidatedMessage[] = [];
      const incoming: ValidatedMessage[] = [createMessage('msg-1')];

      await service.loadMessagesIntoThread(
        mockThread,
        incoming,
        current,
        'session-1',
        'session-1'
      );

      expect(resetSpy).not.toHaveBeenCalled();
      expect(importSpy).toHaveBeenCalledWith({ messages: toThreadMessages(incoming) });
    });

    it('should not reset thread on first load (null session)', async () => {
      const current: ValidatedMessage[] = [];
      const incoming: ValidatedMessage[] = [createMessage('msg-1')];

      await service.loadMessagesIntoThread(
        mockThread,
        incoming,
        current,
        null,
        'session-1'
      );

      expect(resetSpy).not.toHaveBeenCalled();
      expect(importSpy).toHaveBeenCalledWith({ messages: toThreadMessages(incoming) });
    });

    it('should skip import if all messages already loaded', async () => {
      const current: ValidatedMessage[] = [
        createMessage('msg-1'),
        createMessage('msg-2'),
      ];
      const incoming: ValidatedMessage[] = [
        createMessage('msg-1'),
        createMessage('msg-2'),
      ];

      await service.loadMessagesIntoThread(
        mockThread,
        incoming,
        current,
        'session-1',
        'session-1'
      );

      expect(importSpy).not.toHaveBeenCalled();
    });

    it('should import messages if there are new ones', async () => {
      const current: ValidatedMessage[] = [createMessage('msg-1')];
      const incoming: ValidatedMessage[] = [
        createMessage('msg-1'),
        createMessage('msg-2'),
      ];

      await service.loadMessagesIntoThread(
        mockThread,
        incoming,
        current,
        'session-1',
        'session-1'
      );

      expect(importSpy).toHaveBeenCalledWith({ messages: toThreadMessages(incoming) });
    });

    it('should import all messages on first load', async () => {
      const current: ValidatedMessage[] = [];
      const incoming: ValidatedMessage[] = [
        createMessage('msg-1'),
        createMessage('msg-2'),
      ];

      await service.loadMessagesIntoThread(
        mockThread,
        incoming,
        current,
        null,
        'session-1'
      );

      expect(importSpy).toHaveBeenCalledWith({ messages: toThreadMessages(incoming) });
    });

    it('should handle empty messages array', async () => {
      const current: ValidatedMessage[] = [];
      const incoming: ValidatedMessage[] = [];

      await service.loadMessagesIntoThread(
        mockThread,
        incoming,
        current,
        null,
        'session-1'
      );

      // Should not throw, but also should not import
      expect(importSpy).not.toHaveBeenCalled();
    });

    it('should handle messages with different content types', async () => {
      const messages: ValidatedMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Simple text',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: [{ type: 'text', text: 'Array content' }],
        },
        {
          id: 'msg-3',
          role: 'user',
          content: { type: 'custom', data: 'Object content' },
        },
      ];

      await service.loadMessagesIntoThread(
        mockThread,
        messages,
        [],
        null,
        'session-1'
      );

      expect(importSpy).toHaveBeenCalledWith({ messages: toThreadMessages(messages) });
    });

    it('should handle messages with tool invocations', async () => {
      const messages: ValidatedMessage[] = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Using tool',
          toolInvocations: [
            {
              id: 'tool-1',
              toolName: 'testTool',
              args: { param: 'value' },
            },
          ],
        },
      ];

      await service.loadMessagesIntoThread(
        mockThread,
        messages,
        [],
        null,
        'session-1'
      );

      expect(importSpy).toHaveBeenCalledWith({ messages: toThreadMessages(messages) });
    });

    it('should correctly compare message IDs when checking if already loaded', async () => {
      const current: ValidatedMessage[] = [
        createMessage('msg-1'),
        createMessage('msg-2'),
      ];
      const incoming: ValidatedMessage[] = [
        createMessage('msg-1'),
        createMessage('msg-2'),
        createMessage('msg-3'),
      ];

      await service.loadMessagesIntoThread(
        mockThread,
        incoming,
        current,
        'session-1',
        'session-1'
      );

      expect(importSpy).toHaveBeenCalledWith({ messages: toThreadMessages(incoming) });
    });
  });
});

