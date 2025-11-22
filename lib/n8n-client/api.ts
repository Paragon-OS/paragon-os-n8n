/**
 * n8n Local API Client
 * Handles calling n8n workflows via local API
 */

import type { N8nWorkflowResponse } from "./types";
import { DEFAULT_TIMEOUT, getN8nBaseUrl, getApiKey } from "./config";

/**
 * Call an n8n workflow via local API
 */
export async function callLocalApi(
  workflowId: string,
  method: "GET" | "POST",
  payload?: Record<string, unknown>,
  timeout: number = DEFAULT_TIMEOUT,
): Promise<N8nWorkflowResponse> {
  const baseUrl = getN8nBaseUrl();
  const apiUrl = `${baseUrl}/api/v1/workflows/${workflowId}/execute`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const options: RequestInit = {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: payload || {},
      }),
    };

    // Add authentication if available
    const apiKey = getApiKey();
    if (apiKey) {
      options.headers = {
        ...options.headers,
        "X-N8N-API-KEY": apiKey,
      };
    }

    const response = await fetch(apiUrl, options);
    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();

    return {
      success: true,
      data,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          success: false,
          error: "Request timeout - workflow took too long to respond",
        };
      }
      return {
        success: false,
        error: error.message,
      };
    }
    return {
      success: false,
      error: "Unknown error occurred",
    };
  }
}

