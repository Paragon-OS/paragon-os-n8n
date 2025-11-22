/**
 * Webhook Mode Management
 * Handles switching between test (/webhook-test) and production (/webhook) modes
 */

export type WebhookMode = "test" | "production";

const WEBHOOK_MODE_COOKIE = "paragon_webhook_mode";
const DEFAULT_MODE: WebhookMode = "test";

/**
 * Get webhook mode from cookies (client-side only)
 */
export function getWebhookMode(): WebhookMode {
  if (typeof window === "undefined") {
    return DEFAULT_MODE;
  }

  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === WEBHOOK_MODE_COOKIE) {
      return (value === "production" ? "production" : "test") as WebhookMode;
    }
  }

  return DEFAULT_MODE;
}

/**
 * Set webhook mode in cookies (client-side only)
 * Cookie expires in 1 year
 */
export function setWebhookMode(mode: WebhookMode): void {
  if (typeof window === "undefined") {
    return;
  }

  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);
  
  document.cookie = `${WEBHOOK_MODE_COOKIE}=${mode}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`;
}

/**
 * Get webhook mode from cookie header string (server-side)
 */
export function getWebhookModeFromCookieHeader(cookieHeader: string | null): WebhookMode {
  if (!cookieHeader) {
    return DEFAULT_MODE;
  }

  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === WEBHOOK_MODE_COOKIE) {
      return (value === "production" ? "production" : "test") as WebhookMode;
    }
  }

  return DEFAULT_MODE;
}

/**
 * Build webhook prefix based on mode
 */
export function getWebhookPrefix(mode: WebhookMode): string {
  return mode === "production" ? "/webhook" : "/webhook-test";
}

