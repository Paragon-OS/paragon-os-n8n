/**
 * n8n Streaming Client
 * Manages WebSocket/SSE connections to streaming server for real-time workflow updates
 */

import type { StreamUpdate, StreamingCallbacks } from "./types";
import { getStreamingServerUrl, getStreamingConnectionType } from "./config";

// Simple logger utility for browser console
const logger = {
  info: (message: string, ...args: unknown[]) => {
    if (typeof window !== 'undefined') {
      console.log(`[n8n-streaming] ${message}`, ...args);
    }
  },
  error: (message: string, error?: unknown) => {
    if (typeof window !== 'undefined') {
      console.error(`[n8n-streaming] ${message}`, error);
    }
  },
  warn: (message: string, ...args: unknown[]) => {
    if (typeof window !== 'undefined') {
      console.warn(`[n8n-streaming] ${message}`, ...args);
    }
  },
};

/**
 * Subscription for a specific execution
 */
interface ExecutionSubscription {
  executionId: string;
  callbacks: StreamingCallbacks;
}

/**
 * Streaming client that connects to the streaming server
 */
export class StreamingClient {
  private ws: WebSocket | null = null;
  private eventSource: EventSource | null = null;
  private connectionType: "websocket" | "sse";
  private serverUrl: string;
  private subscriptions: Map<string, ExecutionSubscription> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnecting = false;
  private isConnected = false;

  constructor(serverUrl?: string, connectionType?: "websocket" | "sse") {
    this.serverUrl = serverUrl || getStreamingServerUrl();
    this.connectionType = connectionType || getStreamingConnectionType();
  }

  /**
   * Connect to the streaming server
   */
  async connect(): Promise<void> {
    if (this.isConnected || this.isConnecting) {
      logger.info("Already connected or connecting");
      return;
    }

    logger.info(`Attempting to connect to streaming server: ${this.serverUrl}`);
    logger.info(`Connection type: ${this.connectionType}`);
    this.isConnecting = true;

    try {
      if (this.connectionType === "websocket") {
        await this.connectWebSocket();
      } else {
        await this.connectSSE();
      }
      this.isConnected = true;
      this.reconnectAttempts = 0;
      logger.info("✅ Successfully connected to streaming server");
    } catch (error) {
      logger.error("❌ Failed to connect to streaming server:", error);
      this.isConnected = false;
      this.scheduleReconnect();
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Connect via WebSocket
   */
  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.serverUrl.replace(/^http/, "ws") + "/ws";
        logger.info(`🔌 Connecting to WebSocket: ${wsUrl}`);
        
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          logger.info("✅ WebSocket connection established");
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const update: StreamUpdate = JSON.parse(event.data);
            logger.info(`📨 Received WebSocket message for execution: ${update.executionId}`);
            this.handleUpdate(update);
          } catch (error) {
            logger.error("❌ Failed to parse WebSocket message:", error);
            logger.error("Raw message:", event.data);
          }
        };

        this.ws.onerror = (error) => {
          logger.error("❌ WebSocket error:", error);
          reject(error);
        };

        this.ws.onclose = (event) => {
          logger.warn(`🔌 WebSocket disconnected (code: ${event.code}, reason: ${event.reason || 'none'})`);
          this.isConnected = false;
          this.ws = null;
          this.scheduleReconnect();
        };
      } catch (error) {
        logger.error("❌ Failed to create WebSocket:", error);
        reject(error);
      }
    });
  }

  /**
   * Connect via Server-Sent Events
   */
  private async connectSSE(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const sseUrl = `${this.serverUrl}/sse/default`;
        logger.info(`🔌 Connecting to SSE: ${sseUrl}`);
        
        this.eventSource = new EventSource(sseUrl);

        this.eventSource.onopen = () => {
          logger.info("✅ SSE connection established");
          resolve();
        };

        this.eventSource.onmessage = (event) => {
          try {
            const update: StreamUpdate = JSON.parse(event.data);
            logger.info(`📨 Received SSE message for execution: ${update.executionId}`);
            this.handleUpdate(update);
          } catch (error) {
            logger.error("❌ Failed to parse SSE message:", error);
            logger.error("Raw message:", event.data);
          }
        };

        this.eventSource.onerror = (error) => {
          logger.error("❌ SSE error:", error);
          this.isConnected = false;
          this.eventSource?.close();
          this.eventSource = null;
          this.scheduleReconnect();
          reject(error);
        };
      } catch (error) {
        logger.error("❌ Failed to create EventSource:", error);
        reject(error);
      }
    });
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      logger.error("Please check that the streaming server is running at:", this.serverUrl);
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    logger.warn(`🔄 Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => {
      if (!this.isConnected && !this.isConnecting) {
        logger.info(`🔄 Attempting reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        this.connect();
      }
    }, delay);
  }

  /**
   * Handle incoming update
   */
  private handleUpdate(update: StreamUpdate): void {
    logger.info(`📬 Update received - Execution: ${update.executionId}, Stage: ${update.stage}, Status: ${update.status}`);
    logger.info(`   Message: ${update.message}`);
    if (update.data && Object.keys(update.data).length > 0) {
      logger.info(`   Data:`, update.data);
    }

    const subscription = this.subscriptions.get(update.executionId);
    if (!subscription) {
      logger.warn(`⚠️ No subscription found for execution: ${update.executionId}`);
      logger.info(`Active subscriptions: ${Array.from(this.subscriptions.keys()).join(', ') || 'none'}`);
      return;
    }

    const { callbacks } = subscription;

    // Call onUpdate callback
    if (callbacks.onUpdate) {
      try {
        logger.info(`🔔 Calling onUpdate callback for execution: ${update.executionId}`);
        callbacks.onUpdate(update);
      } catch (error) {
        logger.error("❌ Error in onUpdate callback:", error);
      }
    }

    // Handle completion
    if (update.status === "completed") {
      logger.info(`✅ Workflow completed: ${update.executionId}`);
      if (callbacks.onComplete) {
        try {
          logger.info(`🔔 Calling onComplete callback for execution: ${update.executionId}`);
          callbacks.onComplete(update.data, update.executionId);
        } catch (error) {
          logger.error("❌ Error in onComplete callback:", error);
        }
      }
      // Unsubscribe after completion
      this.unsubscribe(update.executionId);
    }

    // Handle errors
    if (update.status === "error") {
      logger.error(`❌ Workflow error: ${update.executionId} - ${update.message}`);
      if (callbacks.onError) {
        try {
          logger.info(`🔔 Calling onError callback for execution: ${update.executionId}`);
          callbacks.onError(update.message, update.executionId);
        } catch (error) {
          logger.error("❌ Error in onError callback:", error);
        }
      }
      // Unsubscribe after error
      this.unsubscribe(update.executionId);
    }
  }

  /**
   * Subscribe to updates for a specific execution
   */
  subscribe(executionId: string, callbacks: StreamingCallbacks): void {
    logger.info(`📝 Subscribing to execution: ${executionId}`);
    
    this.subscriptions.set(executionId, {
      executionId,
      callbacks,
    });

    logger.info(`Active subscriptions: ${this.subscriptions.size}`);

    // Ensure we're connected
    if (!this.isConnected && !this.isConnecting) {
      logger.info("Not connected, initiating connection...");
      this.connect();
    } else if (this.isConnected) {
      logger.info("Already connected to streaming server");
    } else {
      logger.info("Connection in progress...");
    }
  }

  /**
   * Unsubscribe from execution updates
   */
  unsubscribe(executionId: string): void {
    logger.info(`🗑️ Unsubscribing from execution: ${executionId}`);
    this.subscriptions.delete(executionId);
    logger.info(`Remaining subscriptions: ${this.subscriptions.size}`);
  }

  /**
   * Disconnect from streaming server
   */
  disconnect(): void {
    logger.info("🔌 Disconnecting from streaming server");
    
    if (this.ws) {
      logger.info("Closing WebSocket connection");
      this.ws.close();
      this.ws = null;
    }

    if (this.eventSource) {
      logger.info("Closing SSE connection");
      this.eventSource.close();
      this.eventSource = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
    
    const subCount = this.subscriptions.size;
    this.subscriptions.clear();
    
    logger.info(`✅ Disconnected. Cleared ${subCount} subscription(s)`);
  }

  /**
   * Check if client is connected
   */
  isClientConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get number of active subscriptions
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }
}

// Singleton instance
let globalStreamingClient: StreamingClient | null = null;

/**
 * Get or create the global streaming client instance
 */
export function getStreamingClient(): StreamingClient {
  if (!globalStreamingClient) {
    globalStreamingClient = new StreamingClient();
  }
  return globalStreamingClient;
}

/**
 * Create a new streaming client instance
 */
export function createStreamingClient(
  serverUrl?: string,
  connectionType?: "websocket" | "sse"
): StreamingClient {
  return new StreamingClient(serverUrl, connectionType);
}

