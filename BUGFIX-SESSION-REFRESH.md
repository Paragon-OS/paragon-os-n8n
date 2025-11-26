# Bug Fix: New Session Created on Every Refresh

## Problem

Every time the page refreshed, a new chat session was created, even though the previous session was stored in localStorage.

## Root Cause

The issue was a **race condition** between:
1. Zustand store hydration from localStorage (async)
2. React effect checking for active session (runs immediately)

### What Was Happening

```typescript
// app/assistant.tsx (BEFORE)
const effectiveSessionId = useSessionStore((state) => state.activeSessionId);

useEffect(() => {
  if (!effectiveSessionId) {
    // This ran BEFORE localStorage hydration completed!
    createNewSession();
  }
}, [effectiveSessionId]);
```

**Timeline:**
1. Page loads → Store initializes with `activeSessionId: null` (default)
2. Effect runs → Sees `null` → Creates new session
3. Store hydrates from localStorage → Too late, new session already created

## Solution

Added a `_hasHydrated` flag to track when the store has finished loading from localStorage:

### Changes Made

**1. Updated Session Store** (`lib/stores/session-store.ts`)

```typescript
interface SessionStore {
  activeSessionId: string | null;
  activeSessionTitle: string | null;
  _hasHydrated: boolean;  // ← NEW: Track hydration state
  
  setHasHydrated: (hasHydrated: boolean) => void;  // ← NEW
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      activeSessionId: null,
      activeSessionTitle: null,
      _hasHydrated: false,  // ← NEW: Starts false
      
      setHasHydrated: (hasHydrated: boolean) => {
        set({ _hasHydrated: hasHydrated });
      },
    }),
    {
      name: "session-store",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        // ← NEW: Mark as hydrated after rehydration completes
        state?.setHasHydrated(true);
      },
    }
  )
);
```

**2. Updated Assistant Component** (`app/assistant.tsx`)

```typescript
function AssistantContent() {
  const effectiveSessionId = useSessionStore((state) => state.activeSessionId);
  const hasHydrated = useSessionStore((state) => state._hasHydrated);  // ← NEW
  
  useEffect(() => {
    // ← NEW: Wait for hydration before checking
    if (!hasHydrated) {
      console.log("[assistant] Store not hydrated yet, waiting...");
      return;
    }
    
    // Only create new session if no session exists AFTER hydration
    if (!effectiveSessionId) {
      createNewSession();
    }
  }, [effectiveSessionId, createNewSession, hasHydrated]);  // ← Added hasHydrated
}
```

### New Timeline (Fixed)

1. Page loads → Store initializes with `activeSessionId: null`, `_hasHydrated: false`
2. Effect runs → Sees `_hasHydrated: false` → Returns early (waits)
3. Store hydrates from localStorage → Sets `activeSessionId: "session-123"`, `_hasHydrated: true`
4. Effect runs again → Sees `_hasHydrated: true` and `activeSessionId: "session-123"` → Does nothing ✅

OR if truly no session:

1. Page loads → Store initializes with `activeSessionId: null`, `_hasHydrated: false`
2. Effect runs → Sees `_hasHydrated: false` → Returns early (waits)
3. Store hydrates from localStorage → No session found → Sets `activeSessionId: null`, `_hasHydrated: true`
4. Effect runs again → Sees `_hasHydrated: true` and `activeSessionId: null` → Creates new session ✅

## Testing

To verify the fix:

1. **Test 1: Existing Session**
   - Open app → Session created
   - Refresh page → Same session loaded (no new session created) ✅

2. **Test 2: New User**
   - Clear localStorage
   - Open app → New session created
   - Refresh page → Same session loaded ✅

3. **Test 3: Session Switching**
   - Switch to different session
   - Refresh page → Switched session loaded ✅

## Key Takeaway

When using Zustand's `persist` middleware, always wait for hydration before making decisions based on persisted state:

```typescript
// ❌ BAD: Doesn't wait for hydration
const value = useStore((state) => state.value);
useEffect(() => {
  if (!value) doSomething();
}, [value]);

// ✅ GOOD: Waits for hydration
const value = useStore((state) => state.value);
const hasHydrated = useStore((state) => state._hasHydrated);
useEffect(() => {
  if (!hasHydrated) return;  // Wait!
  if (!value) doSomething();
}, [value, hasHydrated]);
```

## Related Files

- `lib/stores/session-store.ts` - Added hydration tracking
- `app/assistant.tsx` - Wait for hydration before creating session

