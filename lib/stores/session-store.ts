/**
 * Session Store
 * Client-side Zustand store for tracking the currently active chat session
 * NO PERSISTENCE - sessions are ephemeral per page load
 */

import { create } from "zustand";

interface SessionStore {
  activeSessionId: string | null;
  activeSessionTitle: string | null;
  
  // Actions
  setActiveSession: (sessionId: string | null, title?: string | null) => void;
  clearActiveSession: () => void;
}

export const useSessionStore = create<SessionStore>()((set) => ({
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
}));

