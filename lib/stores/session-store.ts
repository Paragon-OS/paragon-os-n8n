/**
 * Session Store
 * Client-side Zustand store for tracking the currently active chat session
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SessionStore {
  activeSessionId: string | null;
  activeSessionTitle: string | null;
  
  // Actions
  setActiveSession: (sessionId: string | null, title?: string | null) => void;
  clearActiveSession: () => void;
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      activeSessionId: null,
      activeSessionTitle: null,

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
    }),
    {
      name: "session-store", // localStorage key
    }
  )
);

