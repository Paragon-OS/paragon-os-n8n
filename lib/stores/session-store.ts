/**
 * Session Store
 * Client-side Zustand store for tracking the currently active chat session
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SessionStore {
  activeSessionId: string | null;
  activeSessionTitle: string | null;
  _hasHydrated: boolean;
  
  // Actions
  setActiveSession: (sessionId: string | null, title?: string | null) => void;
  clearActiveSession: () => void;
  setHasHydrated: (hasHydrated: boolean) => void;
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      activeSessionId: null,
      activeSessionTitle: null,
      _hasHydrated: false,

      setActiveSession: (sessionId, title = null) => {
        set({
          activeSessionId: sessionId,
          activeSessionTitle: title,
        });
      },

      clearActiveSession: () => {
        set({
          activeSessionId: null,
          activeSessionTitle: null,
        });
      },

      setHasHydrated: (hasHydrated) => {
        set({
          _hasHydrated: hasHydrated,
        });
      },
    }),
    {
      name: "session-store", // localStorage key
      onRehydrateStorage: () => (state, error) => {
        // Called after rehydration completes (or fails)
        // Always mark as hydrated so the app can proceed even if hydration failed
        if (state) {
          state.setHasHydrated(true);
        }
        if (error) {
          console.warn("[session-store] Error during hydration:", error);
        }
      },
    }
  )
);

/**
 * Hook to check if the session store has finished hydrating from localStorage
 */
export function useSessionStoreHydrated() {
  return useSessionStore((state) => state._hasHydrated);
}

