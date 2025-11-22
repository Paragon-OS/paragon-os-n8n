"use client";

import { useState, useEffect } from "react";
import { getWebhookMode, setWebhookMode, type WebhookMode } from "@/lib/webhook-mode";

export function WebhookModeToggle() {
  const [mode, setMode] = useState<WebhookMode>("test");
  const [isLoading, setIsLoading] = useState(true);

  // Load mode from cookies on mount
  useEffect(() => {
    const currentMode = getWebhookMode();
    setMode(currentMode);
    setIsLoading(false);
  }, []);

  const handleToggle = () => {
    const newMode: WebhookMode = mode === "test" ? "production" : "test";
    setMode(newMode);
    setWebhookMode(newMode);
    console.log(`[WebhookModeToggle] Switched to ${newMode} mode. Send a new message to use this mode.`);
  };

  if (isLoading) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Mode:</span>
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

