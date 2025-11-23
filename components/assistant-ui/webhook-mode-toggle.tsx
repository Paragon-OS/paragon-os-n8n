"use client";

import { useState, useEffect } from "react";
import { getWebhookMode, setWebhookMode, type WebhookMode } from "@/lib/stores/webhook-mode";

export function WebhookModeToggle() {
  // Initialize by reading from cookies immediately and ensure cookie is set
  // This ensures the initial state matches what the server will read
  const [mode, setMode] = useState<WebhookMode>(() => {
    if (typeof window !== "undefined") {
      const currentMode = getWebhookMode();
      // Ensure cookie is set immediately so server requests have the correct value
      setWebhookMode(currentMode);
      return currentMode;
    }
    return "test";
  });
  const [isLoading, setIsLoading] = useState(true);

  // Sync state after mount (in case cookie was changed elsewhere)
  useEffect(() => {
    const currentMode = getWebhookMode();
    setMode(currentMode);
    setIsLoading(false);
  }, []);

  const handleToggle = () => {
    const newMode: WebhookMode = mode === "test" ? "production" : "test";
    setMode(newMode);
    setWebhookMode(newMode);
  };

  if (isLoading) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleToggle}
        className={`px-3 py-1.5 text-xs rounded-md transition-colors font-medium ${
          mode === "test"
            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
        }`}
        title={`Current mode: ${mode === "test" ? "Test" : "Production"}. Click to switch.`}
      >
        {mode === "test" ? "🧪 Test" : "🚀 Production"}
      </button>
    </div>
  );
}

