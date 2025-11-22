<!-- a7902319-391f-4a90-8bc5-4ec537dce3ae aef03520-1cd8-4279-830a-5a64a8e4ec27 -->
# Refactor Chat Loading & Interactions

## Problem Analysis

The current implementation has several issues:

1. **Using `thread.append()` for historical messages**: This method is designed for adding NEW messages to active conversations, causing assistant-ui to trigger `reconnectToStream` for each appended message
2. **Complex blocking mechanism**: Multiple flags, sets, and timing hacks (`requestAnimationFrame`, `setTimeout`) that are fragile and hard to maintain
3. **Separation of concerns**: Message loading logic is split between `chat-session-loader.tsx` and `chat-transport.ts` with global state

## Solution Approach

### Option 1: Initialize Thread with Messages (Recommended)

Instead of appending messages one by one, initialize the thread with all messages at once when switching sessions. This requires checking if assistant-ui supports initial message state.

### Option 2: Simpler Blocking Strategy

Simplify the blocking mechanism to a single source of truth: block `reconnectToStream` unless explicitly triggered by a new user message.

### Option 3: Session-Based Runtime

Create a new runtime instance per session, but this may be expensive and lose state.

## Implementation Plan

### Phase 1: Investigate Assistant-UI API

1. Check if `useChatRuntime` accepts `initialMessages` or similar option
2. Check if `runtime.thread` has methods like `setMessages`, `loadMessages`, or `initialize`
3. Review assistant-ui documentation/types for proper initialization patterns

### Phase 2: Refactor Message Loading (Preferred Approach)

If assistant-ui supports initialization:

1. **Modify `chat-session-loader.tsx`**:

- Remove the `forEach` loop with `thread.append()`
- Instead, initialize the thread with all messages at once using the proper API
- Remove all timing hacks (`requestAnimationFrame`, `setTimeout`)

2. **Simplify `chat-transport.ts`**:

- Remove `isLoadingHistoricalMessages` flag and `loadingSessionId`
- Keep only `loadedHistoricalSessions` Set
- Simplify `reconnectToStream` to only check the Set
- Remove `setIsLoadingHistoricalMessages` function

3. **Update session tracking**:

- Mark session as historical when messages are loaded (not during loading)
- Remove session from Set only when user sends a new message

### Phase 3: Fallback - Simplified Blocking

If assistant-ui doesn't support initialization:

1. **Keep using `append()` but simplify blocking**:

- Remove all timing-based flags
- Use a single Set: `historicalSessions`
- Block `reconnectToStream` if session is in Set
- Mark session as historical immediately when starting to load
- Remove from Set only when `sendMessages` is called with a new user message

2. **Clean up `chat-session-loader.tsx`**:

- Remove `setIsLoadingHistoricalMessages` calls
- Remove all `requestAnimationFrame` and `setTimeout` delays
- Directly add session to `historicalSessions` Set before loading
- Use a simpler import: `markSessionAsHistorical(sessionId)`

### Phase 4: Code Cleanup

1. Remove unused functions and global state
2. Consolidate session tracking logic
3. Add clear comments explaining the blocking strategy
4. Remove debug console.logs or convert to proper logging

## Files to Modify

1. **`lib/chat-transport.ts`**:

- Simplify blocking logic
- Remove timing-based flags
- Export simpler functions: `markSessionAsHistorical()`, `markSessionAsActive()`

2. **`components/assistant-ui/chat-session-loader.tsx`**:

- Refactor message loading approach
- Remove timing hacks
- Simplify session tracking

3. **`components/assistant-ui/chat-sessions-context.tsx`**:

- Update to use simplified session marking functions

## Success Criteria

- No unwanted `reconnectToStream` calls when loading historical messages
- No unwanted calls when switching tabs
- No unwanted calls when clicking past conversations
- Code is simpler and easier to maintain
- New user messages still work correctly