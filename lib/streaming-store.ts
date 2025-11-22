/**
 * Streaming Store
 * In-memory state management for SSE connections and update history
 */

import type { StreamUpdate } from "./n8n-client/types";

// Type for SSE connection with encoder
interface SSEConnection {
  encoder: TextEncoder;
  controller: ReadableStreamDefaultController;
}

// Metadata for each execution
interface ExecutionMetadata {
  lastAccessTime: number;
  lastUpdateTime: number;
  isCompleted: boolean;
  completedAt?: number;
}

class StreamingStore {
  // Map of executionId -> Set of SSE connections
  private connections: Map<string, Set<SSEConnection>> = new Map();

  // Map of executionId -> Array of updates (last 100)
  private updateHistory: Map<string, StreamUpdate[]> = new Map();

  // Map of executionId -> Metadata
  private executionMetadata: Map<string, ExecutionMetadata> = new Map();

  // Maximum updates to keep per execution
  private readonly MAX_HISTORY = 100;

  // TTL for completed executions (1 hour)
  private readonly COMPLETED_EXECUTION_TTL_MS = 60 * 60 * 1000;

  // TTL for active executions (24 hours)
  private readonly ACTIVE_EXECUTION_TTL_MS = 24 * 60 * 60 * 1000;

  // Cleanup interval (every 5 minutes)
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

  // Cleanup timer
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic cleanup
    this.startPeriodicCleanup();
  }

  /**
   * Start periodic cleanup task
   */
  private startPeriodicCleanup(): void {
    if (this.cleanupTimer) {
      return; // Already started
    }

    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, this.CLEANUP_INTERVAL_MS);

    console.log(`[streaming-store] Started periodic cleanup (every ${this.CLEANUP_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Stop periodic cleanup task
   */
  private stopPeriodicCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.log(`[streaming-store] Stopped periodic cleanup`);
    }
  }

  /**
   * Get or create metadata for an execution
   */
  private getOrCreateMetadata(executionId: string): ExecutionMetadata {
    if (!this.executionMetadata.has(executionId)) {
      this.executionMetadata.set(executionId, {
        lastAccessTime: Date.now(),
        lastUpdateTime: Date.now(),
        isCompleted: false,
      });
    }
    return this.executionMetadata.get(executionId)!;
  }

  /**
   * Mark execution as completed
   */
  private markExecutionCompleted(executionId: string): void {
    const metadata = this.getOrCreateMetadata(executionId);
    metadata.isCompleted = true;
    metadata.completedAt = Date.now();
    metadata.lastAccessTime = Date.now();
    console.log(`[streaming-store] Marked execution as completed: ${executionId}`);
  }

  /**
   * Perform cleanup of old and completed executions
   */
  private performCleanup(): void {
    const now = Date.now();
    const executionsToRemove: string[] = [];

    // Check all tracked executions
    for (const [executionId, metadata] of this.executionMetadata.entries()) {
      const age = now - metadata.lastAccessTime;
      let shouldRemove = false;

      if (metadata.isCompleted && metadata.completedAt) {
        // Remove completed executions after TTL
        const completedAge = now - metadata.completedAt;
        if (completedAge > this.COMPLETED_EXECUTION_TTL_MS) {
          shouldRemove = true;
          console.log(`[streaming-store] Removing completed execution (age: ${Math.round(completedAge / 1000)}s): ${executionId}`);
        }
      } else {
        // Remove active executions that haven't been accessed in a while
        if (age > this.ACTIVE_EXECUTION_TTL_MS) {
          shouldRemove = true;
          console.log(`[streaming-store] Removing stale execution (age: ${Math.round(age / 1000)}s): ${executionId}`);
        }
      }

      // Also remove if no connections and no recent updates
      const hasConnections = this.connections.has(executionId) && 
                           this.connections.get(executionId)!.size > 0;
      const updateAge = now - metadata.lastUpdateTime;
      
      if (!hasConnections && updateAge > this.COMPLETED_EXECUTION_TTL_MS) {
        shouldRemove = true;
        console.log(`[streaming-store] Removing execution with no connections (last update: ${Math.round(updateAge / 1000)}s ago): ${executionId}`);
      }

      if (shouldRemove) {
        executionsToRemove.push(executionId);
      }
    }

    // Remove executions
    for (const executionId of executionsToRemove) {
      this.removeExecution(executionId);
    }

    if (executionsToRemove.length > 0) {
      console.log(`[streaming-store] Cleanup removed ${executionsToRemove.length} execution(s)`);
    }
  }

  /**
   * Remove an execution completely (history, connections, metadata)
   */
  private removeExecution(executionId: string): void {
    // Remove connections
    this.connections.delete(executionId);
    
    // Remove history
    this.updateHistory.delete(executionId);
    
    // Remove metadata
    this.executionMetadata.delete(executionId);
    
    console.log(`[streaming-store] Removed execution: ${executionId}`);
  }

  /**
   * Add a new SSE connection
   */
  addConnection(executionId: string, connection: SSEConnection): void {
    if (!this.connections.has(executionId)) {
      this.connections.set(executionId, new Set());
    }
    this.connections.get(executionId)!.add(connection);
    
    // Update access time
    const metadata = this.getOrCreateMetadata(executionId);
    metadata.lastAccessTime = Date.now();
    
    console.log(`[streaming-store] Added connection for execution: ${executionId}`);
    console.log(`[streaming-store] Total connections for ${executionId}: ${this.connections.get(executionId)!.size}`);
  }

  /**
   * Remove an SSE connection
   */
  removeConnection(executionId: string, connection: SSEConnection): void {
    const execConnections = this.connections.get(executionId);
    if (execConnections) {
      execConnections.delete(connection);
      console.log(`[streaming-store] Removed connection for execution: ${executionId}`);
      console.log(`[streaming-store] Remaining connections for ${executionId}: ${execConnections.size}`);
      
      if (execConnections.size === 0) {
        this.connections.delete(executionId);
        console.log(`[streaming-store] No more connections for ${executionId}, removed from map`);
        
        // If execution is completed and has no connections, schedule cleanup
        const metadata = this.executionMetadata.get(executionId);
        if (metadata?.isCompleted) {
          // Will be cleaned up in next periodic cleanup
          console.log(`[streaming-store] Execution ${executionId} is completed with no connections, will be cleaned up`);
        }
      }
    }
  }

  /**
   * Get all connections for an execution ID
   */
  getConnections(executionId: string): Set<SSEConnection> {
    return this.connections.get(executionId) || new Set();
  }

  /**
   * Get total number of active connections
   */
  getConnectionCount(): number {
    let total = 0;
    for (const connections of this.connections.values()) {
      total += connections.size;
    }
    return total;
  }

  /**
   * Add an update to history
   */
  addUpdate(update: StreamUpdate): void {
    const { executionId } = update;
    
    if (!this.updateHistory.has(executionId)) {
      this.updateHistory.set(executionId, []);
    }
    
    const history = this.updateHistory.get(executionId)!;
    history.push(update);
    
    // Keep only last MAX_HISTORY updates
    if (history.length > this.MAX_HISTORY) {
      history.shift();
    }
    
    // Update metadata
    const metadata = this.getOrCreateMetadata(executionId);
    metadata.lastUpdateTime = Date.now();
    metadata.lastAccessTime = Date.now();
    
    // Mark as completed if status indicates completion
    if (update.status === "completed" || update.status === "error") {
      if (!metadata.isCompleted) {
        this.markExecutionCompleted(executionId);
      }
    }
    
    console.log(`[streaming-store] Added update for execution: ${executionId}, stage: ${update.stage}, status: ${update.status}`);
    console.log(`[streaming-store] History size for ${executionId}: ${history.length}`);
  }

  /**
   * Get update history for an execution
   */
  getHistory(executionId: string): StreamUpdate[] {
    // Update access time
    const metadata = this.executionMetadata.get(executionId);
    if (metadata) {
      metadata.lastAccessTime = Date.now();
    }
    
    return this.updateHistory.get(executionId) || [];
  }

  /**
   * Get all execution IDs being tracked
   */
  getTrackedExecutions(): string[] {
    return Array.from(this.updateHistory.keys());
  }

  /**
   * Get number of tracked executions
   */
  getTrackedExecutionCount(): number {
    return this.updateHistory.size;
  }

  /**
   * Broadcast update to all connections for an execution
   */
  broadcast(update: StreamUpdate): void {
    const { executionId } = update;
    
    // Broadcast to specific execution connections
    const execConnections = this.getConnections(executionId);
    
    // Also broadcast to 'default' connections (listening to all)
    const defaultConnections = this.getConnections('default');
    
    const allConnections = new Set([...execConnections, ...defaultConnections]);
    
    console.log(`[streaming-store] Broadcasting update for ${executionId} to ${allConnections.size} connection(s)`);
    
    const data = `data: ${JSON.stringify(update)}\n\n`;
    
    allConnections.forEach((connection) => {
      try {
        connection.controller.enqueue(connection.encoder.encode(data));
      } catch (error) {
        console.error(`[streaming-store] Error sending to connection:`, error);
        // Connection might be closed, will be cleaned up on next request
      }
    });
  }

  /**
   * Clear history for a specific execution (optional cleanup)
   */
  clearHistory(executionId: string): void {
    this.updateHistory.delete(executionId);
    console.log(`[streaming-store] Cleared history for execution: ${executionId}`);
  }

  /**
   * Manually mark an execution as completed (useful for external cleanup)
   */
  markCompleted(executionId: string): void {
    this.markExecutionCompleted(executionId);
  }

  /**
   * Force cleanup of a specific execution
   */
  cleanupExecution(executionId: string): void {
    this.removeExecution(executionId);
  }

  /**
   * Force cleanup of all old executions (manual trigger)
   */
  cleanupAll(): void {
    this.performCleanup();
  }

  /**
   * Get statistics
   */
  getStats() {
    const now = Date.now();
    const completed = Array.from(this.executionMetadata.values()).filter(m => m.isCompleted).length;
    const active = Array.from(this.executionMetadata.values()).filter(m => !m.isCompleted).length;
    
    return {
      activeConnections: this.getConnectionCount(),
      trackedExecutions: this.getTrackedExecutionCount(),
      completedExecutions: completed,
      activeExecutions: active,
      executionIds: this.getTrackedExecutions(),
      oldestExecutionAge: this.getOldestExecutionAge(now),
    };
  }

  /**
   * Get age of oldest execution in milliseconds
   */
  private getOldestExecutionAge(now: number): number | null {
    let oldest: number | null = null;
    for (const metadata of this.executionMetadata.values()) {
      const age = now - metadata.lastAccessTime;
      if (oldest === null || age > oldest) {
        oldest = age;
      }
    }
    return oldest;
  }

  /**
   * Cleanup on shutdown (call this when the process is shutting down)
   */
  shutdown(): void {
    this.stopPeriodicCleanup();
    this.connections.clear();
    this.updateHistory.clear();
    this.executionMetadata.clear();
    console.log(`[streaming-store] Shutdown complete`);
  }
}

// Export singleton instance
export const streamingStore = new StreamingStore();

