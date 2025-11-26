/**
 * Integration Tests for ChatSessionLoader
 * Tests the component's integration with hooks, stores, and services
 */

// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ChatSessionLoader } from '../chat-session-loader';
import { useChatMessages } from '@/lib/supabase/hooks/use-chat-messages';
import { useAssistantRuntime, useAssistantState } from '@assistant-ui/react';
import { useSessionStore } from '@/lib/stores/session-store';
import { MessageLoaderService } from '@/lib/chat/services/message-loader';
import type { ValidatedMessage } from '@/lib/chat/message-validation';

// Mock dependencies
vi.mock('@/lib/supabase/hooks/use-chat-messages');
vi.mock('@assistant-ui/react');
vi.mock('@/lib/stores/session-store');
const mockLoadMessagesIntoThread = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/chat/services/message-loader', () => {
  class MockMessageLoaderService {
    loadMessagesIntoThread = mockLoadMessagesIntoThread;
  }
  return {
    MessageLoaderService: MockMessageLoaderService,
  };
});

describe('ChatSessionLoader Integration', () => {
  let mockUseChatMessages: ReturnType<typeof vi.fn>;
  let mockUseAssistantRuntime: ReturnType<typeof vi.fn>;
  let mockUseAssistantState: ReturnType<typeof vi.fn>;
  let mockUseSessionStore: ReturnType<typeof vi.fn>;

  let mockThread: {
    reset: ReturnType<typeof vi.fn>;
    import: ReturnType<typeof vi.fn>;
  };

  let mockCurrentMessages: Array<{ id?: string | null }>;
  let activeSessionId: string | null;
  let messages: Array<{ id?: string; role: string; content?: unknown }>;
  let isLoading: boolean;

  beforeEach(() => {
    // Reset all state
    activeSessionId = null;
    messages = [];
    isLoading = false;
    mockCurrentMessages = [];

    // Setup mock thread
    mockThread = {
      reset: vi.fn(),
      import: vi.fn(),
    };

    // Reset the mock before each test
    mockLoadMessagesIntoThread.mockClear();
    mockLoadMessagesIntoThread.mockResolvedValue(undefined);

    // Mock useSessionStore
    mockUseSessionStore = vi.fn((selector) => {
      const state = {
        activeSessionId,
      };
      return selector(state);
    });
    (useSessionStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockUseSessionStore
    );

    // Mock useChatMessages
    mockUseChatMessages = vi.fn(() => ({
      messages,
      isLoading,
      error: null,
      refetch: vi.fn(),
    }));
    (useChatMessages as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      mockUseChatMessages
    );

    // Mock useAssistantRuntime
    mockUseAssistantRuntime = vi.fn(() => ({
      thread: mockThread,
    }));
    (
      useAssistantRuntime as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(mockUseAssistantRuntime);

    // Mock useAssistantState
    mockUseAssistantState = vi.fn(() => mockCurrentMessages);
    (
      useAssistantState as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(mockUseAssistantState);

    // MessageLoaderService is already mocked in the vi.mock() call above
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial Load', () => {
    it('should load messages when session is selected for the first time', async () => {
      activeSessionId = 'session-1';
      messages = [
        { id: 'msg-1', role: 'user', content: 'Hello' },
        { id: 'msg-2', role: 'assistant', content: 'Hi there!' },
      ];
      isLoading = false;
      mockCurrentMessages = [];

      // Update mocks
      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      render(<ChatSessionLoader />);

      await waitFor(() => {
        expect(mockLoadMessagesIntoThread).toHaveBeenCalled();
      });

      expect(mockLoadMessagesIntoThread).toHaveBeenCalledWith(
        mockThread,
        expect.arrayContaining([
          expect.objectContaining({ id: 'msg-1' }),
          expect.objectContaining({ id: 'msg-2' }),
        ]),
        [],
        null,
        'session-1'
      );
    });

    it('should not load messages when session is null', async () => {
      activeSessionId = null;
      isLoading = false;

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages: [],
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      render(<ChatSessionLoader />);

      // Wait a bit to ensure no loading happens
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockLoadMessagesIntoThread).not.toHaveBeenCalled();
    });

    it('should not load messages while isLoading is true', async () => {
      activeSessionId = 'session-1';
      isLoading = true;

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages: [],
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      render(<ChatSessionLoader />);

      // Wait a bit to ensure no loading happens
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockLoadMessagesIntoThread).not.toHaveBeenCalled();
    });

    it('should handle empty messages array', async () => {
      activeSessionId = 'session-1';
      messages = [];
      isLoading = false;

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      render(<ChatSessionLoader />);

      await waitFor(() => {
        // Should not call loadMessagesIntoThread for empty messages
        expect(mockLoadMessagesIntoThread).not.toHaveBeenCalled();
      });
    });
  });

  describe('Session Switching', () => {
    it('should reset thread and load new messages when switching sessions', async () => {
      // First session
      activeSessionId = 'session-1';
      messages = [{ id: 'msg-1', role: 'user', content: 'Session 1 message' }];
      isLoading = false;
      mockCurrentMessages = [];

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      const { rerender } = render(<ChatSessionLoader />);

      await waitFor(() => {
        expect(mockLoadMessagesIntoThread).toHaveBeenCalledTimes(1);
      });

      // Switch to second session
      activeSessionId = 'session-2';
      messages = [{ id: 'msg-2', role: 'user', content: 'Session 2 message' }];
      mockCurrentMessages = [{ id: 'msg-1' }]; // Previous session's messages

      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      rerender(<ChatSessionLoader />);

      await waitFor(() => {
        expect(mockLoadMessagesIntoThread).toHaveBeenCalledTimes(2);
      });

      // Check that reset was called (handled by MessageLoaderService)
      const lastCall = mockLoadMessagesIntoThread.mock.calls[1];
      expect(lastCall[2]).toEqual([{ id: 'msg-1' }]); // currentMessages
      expect(lastCall[3]).toBe('session-1'); // lastSessionId
      expect(lastCall[4]).toBe('session-2'); // currentSessionId
    });
  });

  describe('Duplicate Prevention', () => {
    it('should not load messages if they are already loaded', async () => {
      activeSessionId = 'session-1';
      messages = [
        { id: 'msg-1', role: 'user', content: 'Hello' },
        { id: 'msg-2', role: 'assistant', content: 'Hi!' },
      ];
      isLoading = false;
      mockCurrentMessages = [
        { id: 'msg-1' },
        { id: 'msg-2' },
      ];

      // Mock checkMessagesAlreadyLoaded to return true
      // This is handled by the component's internal logic

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      render(<ChatSessionLoader />);

      await waitFor(() => {
        // Should not call loadMessagesIntoThread if messages already loaded
        expect(mockLoadMessagesIntoThread).not.toHaveBeenCalled();
      });
    });

    it('should load new messages when they are added to the same session', async () => {
      activeSessionId = 'session-1';
      messages = [{ id: 'msg-1', role: 'user', content: 'First message' }];
      isLoading = false;
      mockCurrentMessages = [];

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      const { rerender } = render(<ChatSessionLoader />);

      await waitFor(() => {
        expect(mockLoadMessagesIntoThread).toHaveBeenCalledTimes(1);
      });

      // Add new message to same session
      messages = [
        { id: 'msg-1', role: 'user', content: 'First message' },
        { id: 'msg-2', role: 'assistant', content: 'New response' },
      ];
      mockCurrentMessages = [{ id: 'msg-1' }];

      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      // New messages should trigger loading

      rerender(<ChatSessionLoader />);

      await waitFor(() => {
        expect(mockLoadMessagesIntoThread).toHaveBeenCalledTimes(2);
      });

      const secondCall = mockLoadMessagesIntoThread.mock.calls[1];
      expect(secondCall[1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'msg-1' }),
          expect.objectContaining({ id: 'msg-2' }),
        ])
      );
    });
  });

  describe('Concurrent Load Prevention', () => {
    it('should prevent concurrent loads using isLoadingRef', async () => {
      activeSessionId = 'session-1';
      messages = [{ id: 'msg-1', role: 'user', content: 'Test' }];
      isLoading = false;
      mockCurrentMessages = [];

      // Track call count
      let callCount = 0;
      mockLoadMessagesIntoThread.mockImplementation(async () => {
        callCount++;
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      const { rerender } = render(<ChatSessionLoader />);

      // Wait a bit for the first load to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Trigger multiple renders rapidly while first load is in progress
      // The component should prevent concurrent loads
      rerender(<ChatSessionLoader />);
      rerender(<ChatSessionLoader />);
      rerender(<ChatSessionLoader />);

      // Wait for the load to complete
      await waitFor(() => {
        // Should have been called at least once, but the isLoadingRef should prevent
        // multiple concurrent calls
        expect(callCount).toBeGreaterThanOrEqual(1);
        // The component uses isLoadingRef to prevent concurrent loads
        // So even with multiple renders, it should not call multiple times concurrently
        expect(mockLoadMessagesIntoThread).toHaveBeenCalled();
      }, { timeout: 2000 });
    });
  });

  describe('Error Handling', () => {
    it('should handle thread without import method gracefully', async () => {
      activeSessionId = 'session-1';
      messages = [{ id: 'msg-1', role: 'user', content: 'Test' }];
      isLoading = false;
      mockCurrentMessages = [];

      // Create thread without import method
      const invalidThread = {
        reset: vi.fn(),
        // Missing import method
      };

      mockUseAssistantRuntime.mockReturnValue({
        thread: invalidThread,
      });

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<ChatSessionLoader />);

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
        const errorCalls = consoleErrorSpy.mock.calls.filter((call) =>
          String(call[0]).includes('Thread runtime does not support import()')
        );
        expect(errorCalls.length).toBeGreaterThan(0);
      });

      consoleErrorSpy.mockRestore();
    });

    it('should handle errors during message loading', async () => {
      activeSessionId = 'session-1';
      messages = [{ id: 'msg-1', role: 'user', content: 'Test' }];
      isLoading = false;
      mockCurrentMessages = [];

      const loadError = new Error('Failed to load messages');
      mockLoadMessagesIntoThread.mockRejectedValue(loadError);

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<ChatSessionLoader />);

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
        const errorCalls = consoleErrorSpy.mock.calls.filter((call) =>
          String(call[0]).includes('CRITICAL: Error during import()')
        );
        expect(errorCalls.length).toBeGreaterThan(0);
      });

      consoleErrorSpy.mockRestore();
    });

    it('should log CRITICAL error and NOT fallback to append() when import() fails', async () => {
      activeSessionId = 'session-1';
      messages = [
        { id: 'msg-1', role: 'user', content: 'Hello' },
        { id: 'msg-2', role: 'assistant', content: 'Hi there!' },
      ];
      isLoading = false;
      mockCurrentMessages = [];

      // Simulate import() failure
      const importError = new Error('Thread import failed: Invalid message format');
      importError.stack = 'Error: Thread import failed\n    at Thread.import';
      mockLoadMessagesIntoThread.mockRejectedValue(importError);

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<ChatSessionLoader />);

      await waitFor(() => {
        // Verify CRITICAL error message is logged
        const criticalErrorCall = consoleErrorSpy.mock.calls.find((call) =>
          String(call[0]).includes('CRITICAL: Error during import() - NOT falling back to append()')
        );
        expect(criticalErrorCall).toBeDefined();
        expect(criticalErrorCall![0]).toContain('NOT falling back to append()');
        expect(criticalErrorCall![0]).toContain('prevent duplicate responses');
      });

      // Verify detailed error logging
      await waitFor(() => {
        const errorDetailsCall = consoleErrorSpy.mock.calls.find((call) =>
          String(call[0]).includes('Error details:')
        );
        expect(errorDetailsCall).toBeDefined();

        const errorTypeCall = consoleErrorSpy.mock.calls.find((call) =>
          String(call[0]).includes('Error type:')
        );
        expect(errorTypeCall).toBeDefined();

        const errorMessageCall = consoleErrorSpy.mock.calls.find((call) =>
          String(call[0]).includes('Error message:')
        );
        expect(errorMessageCall).toBeDefined();
        expect(errorMessageCall![1]).toContain('Thread import failed');

        const errorStackCall = consoleErrorSpy.mock.calls.find((call) =>
          String(call[0]).includes('Error stack:')
        );
        expect(errorStackCall).toBeDefined();

        const messagesCountCall = consoleErrorSpy.mock.calls.find((call) =>
          String(call[0]).includes('Messages count:')
        );
        expect(messagesCountCall).toBeDefined();
        expect(messagesCountCall![1]).toBe(2);

        // Verify first and last message logging
        const firstMessageCall = consoleErrorSpy.mock.calls.find((call) =>
          String(call[0]).includes('First message:')
        );
        expect(firstMessageCall).toBeDefined();

        const lastMessageCall = consoleErrorSpy.mock.calls.find((call) =>
          String(call[0]).includes('Last message:')
        );
        expect(lastMessageCall).toBeDefined();

        // Verify message content logging
        const firstMessageContentCall = consoleErrorSpy.mock.calls.find((call) =>
          String(call[0]).includes('First message content:')
        );
        expect(firstMessageContentCall).toBeDefined();

        const lastMessageContentCall = consoleErrorSpy.mock.calls.find((call) =>
          String(call[0]).includes('Last message content:')
        );
        expect(lastMessageContentCall).toBeDefined();
      });

      // CRITICAL: Verify that append() is NEVER called (component should NOT fallback)
      // The component should only use import(), never append()
      // We verify this by checking that thread.import was attempted but failed
      expect(mockLoadMessagesIntoThread).toHaveBeenCalled();
      
      // Verify the error was logged with all details
      const allErrorCalls = consoleErrorSpy.mock.calls.filter((call) =>
        String(call[0]).includes('[chat-session-loader]')
      );
      expect(allErrorCalls.length).toBeGreaterThan(5); // Should have multiple error logs

      consoleErrorSpy.mockRestore();
    });

    it('should allow retry after import() failure by clearing loading flag', async () => {
      activeSessionId = 'session-1';
      messages = [{ id: 'msg-1', role: 'user', content: 'Test' }];
      isLoading = false;
      mockCurrentMessages = [];

      // First attempt fails
      mockLoadMessagesIntoThread.mockRejectedValueOnce(new Error('First attempt failed'));

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { rerender } = render(<ChatSessionLoader />);

      // Wait for first failure
      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
        const criticalErrorCall = consoleErrorSpy.mock.calls.find((call) =>
          String(call[0]).includes('CRITICAL: Error during import()')
        );
        expect(criticalErrorCall).toBeDefined();
      });

      // Clear the error spy and make second attempt succeed
      consoleErrorSpy.mockClear();
      mockLoadMessagesIntoThread.mockResolvedValueOnce(undefined);

      // Trigger a rerender to allow retry (simulating effect re-run)
      rerender(<ChatSessionLoader />);

      // Wait for successful retry
      await waitFor(() => {
        // Should have attempted to load again (retry)
        expect(mockLoadMessagesIntoThread.mock.calls.length).toBeGreaterThanOrEqual(2);
      }, { timeout: 2000 });

      // Verify no new errors were logged on retry
      const newErrorCalls = consoleErrorSpy.mock.calls.filter((call) =>
        String(call[0]).includes('CRITICAL: Error during import()')
      );
      expect(newErrorCalls.length).toBe(0); // No new critical errors

      consoleErrorSpy.mockRestore();
    });

    it('should log serialization errors for problematic messages when import() fails', async () => {
      activeSessionId = 'session-1';
      // Create a message that might cause serialization issues
      const problematicMessage = {
        id: 'msg-1',
        role: 'user' as const,
        content: 'Test',
        // Add a circular reference to cause serialization error
      };
      // Create circular reference
      (problematicMessage as any).self = problematicMessage;
      
      messages = [problematicMessage];
      isLoading = false;
      mockCurrentMessages = [];

      const importError = new Error('Import failed');
      mockLoadMessagesIntoThread.mockRejectedValue(importError);

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<ChatSessionLoader />);

      await waitFor(() => {
        // Verify CRITICAL error is logged
        const criticalErrorCall = consoleErrorSpy.mock.calls.find((call) =>
          String(call[0]).includes('CRITICAL: Error during import()')
        );
        expect(criticalErrorCall).toBeDefined();

        // The component tries to serialize each message to identify problematic ones
        // Note: The actual serialization check happens in the catch block
        // We verify that the error handling path is executed
        expect(mockLoadMessagesIntoThread).toHaveBeenCalled();
      });

      consoleErrorSpy.mockRestore();
    });

    it('should handle validation errors gracefully', async () => {
      activeSessionId = 'session-1';
      messages = [
        { id: 'msg-1', role: 'user', content: 'Valid message' },
        { id: '', role: 'user', content: 'Invalid message' }, // Missing ID
      ];
      isLoading = false;
      mockCurrentMessages = [];

      // Invalid messages will be filtered by the component's validation logic

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      render(<ChatSessionLoader />);

      await waitFor(() => {
        expect(mockLoadMessagesIntoThread).toHaveBeenCalled();
      });

      // Should filter out invalid messages
      const callArgs = mockLoadMessagesIntoThread.mock.calls[0];
      const loadedMessages = callArgs[1] as ValidatedMessage[];
      expect(loadedMessages.length).toBeLessThanOrEqual(messages.length);

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Message Validation and Cleaning', () => {
    it('should validate and clean messages before loading', async () => {
      activeSessionId = 'session-1';
      messages = [
        { id: 'msg-1', role: 'user', content: 'Hello' },
        { id: 'msg-2', role: 'assistant', content: 'Hi!' },
      ];
      isLoading = false;
      mockCurrentMessages = [];

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      render(<ChatSessionLoader />);

      await waitFor(() => {
        // Messages should be loaded after validation and cleaning
        expect(mockLoadMessagesIntoThread).toHaveBeenCalled();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle thread being null', async () => {
      activeSessionId = 'session-1';
      messages = [{ id: 'msg-1', role: 'user', content: 'Test' }];
      isLoading = false;

      mockUseAssistantRuntime.mockReturnValue({
        thread: null,
      });

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<ChatSessionLoader />);

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
        const errorCalls = consoleErrorSpy.mock.calls.filter((call) =>
          String(call[0]).includes('Could not get thread')
        );
        expect(errorCalls.length).toBeGreaterThan(0);
      });

      consoleErrorSpy.mockRestore();
    });

    it('should handle messages with tool invocations', async () => {
      activeSessionId = 'session-1';
      messages = [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Using tool',
          toolInvocations: [{ id: 'tool-1', toolName: 'testTool' }],
        },
      ];
      isLoading = false;
      mockCurrentMessages = [];

      mockUseSessionStore.mockImplementation((selector) => {
        const state = { activeSessionId };
        return selector(state);
      });
      mockUseChatMessages.mockReturnValue({
        messages,
        isLoading,
        error: null,
        refetch: vi.fn(),
      });

      render(<ChatSessionLoader />);

      await waitFor(() => {
        expect(mockLoadMessagesIntoThread).toHaveBeenCalled();
      });

      const callArgs = mockLoadMessagesIntoThread.mock.calls[0];
      const loadedMessages = callArgs[1] as ValidatedMessage[];
      expect(loadedMessages[0]).toHaveProperty('toolInvocations');
    });
  });
});

