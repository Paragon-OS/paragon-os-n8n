/**
 * Session Store
 * Client-side Zustand store for tracking the currently active chat session
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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

      setHasHydrated: (hasHydrated: boolean) => {
        set({ _hasHydrated: hasHydrated });
      },
    }),
    {
      name: "session-store", // localStorage key
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        // Mark as hydrated after rehydration completes
        state?.setHasHydrated(true);
      },
    }
  )
);

