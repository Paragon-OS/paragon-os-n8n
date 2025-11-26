/**
 * Unit Tests for Message Validation
 */

import { describe, it, expect } from 'vitest';
import { validateMessage, validateMessages } from '../message-validation';

describe('validateMessage', () => {
  it('should validate message with parts array', () => {
    const msg = {
      id: 'msg-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
    };

    const result = validateMessage(msg);
    expect(result).toBeDefined();
    expect(result?.id).toBe('msg-1');
    expect(result?.role).toBe('user');
    expect(result?.parts).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('should convert content array to parts', () => {
    const msg = {
      id: 'msg-2',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi there' }],
    };

    const result = validateMessage(msg);
    expect(result).toBeDefined();
    expect(result?.parts).toEqual([{ type: 'text', text: 'Hi there' }]);
  });

  it('should convert string content to parts array', () => {
    const msg = {
      id: 'msg-3',
      role: 'user',
      content: 'Simple string',
    };

    const result = validateMessage(msg);
    expect(result).toBeDefined();
    expect(result?.parts).toEqual([{ type: 'text', text: 'Simple string' }]);
  });

  it('should reject message without id', () => {
    const msg = {
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
    };

    const result = validateMessage(msg);
    expect(result).toBeNull();
  });

  it('should reject message with invalid role', () => {
    const msg = {
      id: 'msg-4',
      role: 'invalid',
      parts: [{ type: 'text', text: 'Hello' }],
    };

    const result = validateMessage(msg);
    expect(result).toBeNull();
  });

  it('should reject message without content or parts', () => {
    const msg = {
      id: 'msg-5',
      role: 'user',
    };

    const result = validateMessage(msg);
    expect(result).toBeNull();
  });

  it('should accept message with tool invocations but no content', () => {
    const msg = {
      id: 'msg-6',
      role: 'assistant',
      parts: [],
      toolInvocations: [{ toolName: 'test', args: {} }],
    };

    const result = validateMessage(msg);
    expect(result).toBeDefined();
    expect(result?.toolInvocations).toBeDefined();
  });

  it('should prioritize parts over content', () => {
    const msg = {
      id: 'msg-7',
      role: 'user',
      parts: [{ type: 'text', text: 'From parts' }],
      content: [{ type: 'text', text: 'From content' }],
    };

    const result = validateMessage(msg);
    expect(result).toBeDefined();
    expect(result?.parts).toEqual([{ type: 'text', text: 'From parts' }]);
  });

  it('should not create duplicate content field', () => {
    const msg = {
      id: 'msg-8',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
    };

    const result = validateMessage(msg) as any;
    expect(result).toBeDefined();
    expect(result.parts).toBeDefined();
    expect(result.content).toBeUndefined(); // Should NOT have content field
  });
});

describe('validateMessages', () => {
  it('should validate array of messages', () => {
    const messages = [
      { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      { id: 'msg-2', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] },
    ];

    const result = validateMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('msg-1');
    expect(result[1].id).toBe('msg-2');
  });

  it('should filter out invalid messages', () => {
    const messages = [
      { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'No ID' }] }, // Invalid - no ID
      { id: 'msg-3', role: 'user', parts: [{ type: 'text', text: 'Valid' }] },
    ];

    const result = validateMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('msg-1');
    expect(result[1].id).toBe('msg-3');
  });

  it('should handle empty array', () => {
    const result = validateMessages([]);
    expect(result).toHaveLength(0);
  });
});


