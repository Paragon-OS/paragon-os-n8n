/**
 * Streaming Store
 * In-memory state management for SSE connections and update history
 */

import { create } from "zustand";
import type { StreamUpdate } from "../n8n-client/types";

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

// Constants
const MAX_HISTORY = 100;
const COMPLETED_EXECUTION_TTL_MS = 60 * 60 * 1000; // 1 hour
const ACTIVE_EXECUTION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Store state interface
interface StreamingStoreState {
  connections: Map<string, Set<SSEConnection>>;
  updateHistory: Map<string, StreamUpdate[]>;
  executionMetadata: Map<string, ExecutionMetadata>;
  cleanupTimer: NodeJS.Timeout | null;
  
  // Actions
  addConnection: (executionId: string, connection: SSEConnection) => void;
  removeConnection: (executionId: string, connection: SSEConnection) => void;
  getConnections: (executionId: string) => Set<SSEConnection>;
  getConnectionCount: () => number;
  addUpdate: (update: StreamUpdate) => void;
  getHistory: (executionId: string) => StreamUpdate[];
  getTrackedExecutions: () => string[];
  getTrackedExecutionCount: () => number;
  broadcast: (update: StreamUpdate) => void;
  clearHistory: (executionId: string) => void;
  markCompleted: (executionId: string) => void;
  cleanupExecution: (executionId: string) => void;
  cleanupAll: () => void;
  getStats: () => {
    activeConnections: number;
    trackedExecutions: number;
    completedExecutions: number;
    activeExecutions: number;
    executionIds: string[];
    oldestExecutionAge: number | null;
  };
  shutdown: () => void;
  startPeriodicCleanup: () => void;
  stopPeriodicCleanup: () => void;
}

// Helper functions (previously private methods)
function getOrCreateMetadata(
  executionMetadata: Map<string, ExecutionMetadata>,
  executionId: string
): ExecutionMetadata {
  if (!executionMetadata.has(executionId)) {
    executionMetadata.set(executionId, {
      lastAccessTime: Date.now(),
      lastUpdateTime: Date.now(),
      isCompleted: false,
    });
  }
  return executionMetadata.get(executionId)!;
}

function markExecutionCompleted(
  executionMetadata: Map<string, ExecutionMetadata>,
  executionId: string
): void {
  const metadata = getOrCreateMetadata(executionMetadata, executionId);
  metadata.isCompleted = true;
  metadata.completedAt = Date.now();
  metadata.lastAccessTime = Date.now();
  console.log(`[streaming-store] Marked execution as completed: ${executionId}`);
}

function removeExecution(
  connections: Map<string, Set<SSEConnection>>,
  updateHistory: Map<string, StreamUpdate[]>,
  executionMetadata: Map<string, ExecutionMetadata>,
  executionId: string
): void {
  connections.delete(executionId);
  updateHistory.delete(executionId);
  executionMetadata.delete(executionId);
  console.log(`[streaming-store] Removed execution: ${executionId}`);
}

function getOldestExecutionAge(
  executionMetadata: Map<string, ExecutionMetadata>,
  now: number
): number | null {
  let oldest: number | null = null;
  for (const metadata of executionMetadata.values()) {
    const age = now - metadata.lastAccessTime;
    if (oldest === null || age > oldest) {
      oldest = age;
    }
  }
  return oldest;
}

function performCleanup(
  connections: Map<string, Set<SSEConnection>>,
  updateHistory: Map<string, StreamUpdate[]>,
  executionMetadata: Map<string, ExecutionMetadata>
): void {
  const now = Date.now();
  const executionsToRemove: string[] = [];

  // Check all tracked executions
  for (const [executionId, metadata] of executionMetadata.entries()) {
    const age = now - metadata.lastAccessTime;
    let shouldRemove = false;

    if (metadata.isCompleted && metadata.completedAt) {
      // Remove completed executions after TTL
      const completedAge = now - metadata.completedAt;
      if (completedAge > COMPLETED_EXECUTION_TTL_MS) {
        shouldRemove = true;
        console.log(`[streaming-store] Removing completed execution (age: ${Math.round(completedAge / 1000)}s): ${executionId}`);
      }
    } else {
      // Remove active executions that haven't been accessed in a while
      if (age > ACTIVE_EXECUTION_TTL_MS) {
        shouldRemove = true;
        console.log(`[streaming-store] Removing stale execution (age: ${Math.round(age / 1000)}s): ${executionId}`);
      }
    }

    // Also remove if no connections and no recent updates
    const hasConnections = connections.has(executionId) && 
                         connections.get(executionId)!.size > 0;
    const updateAge = now - metadata.lastUpdateTime;
    
    if (!hasConnections && updateAge > COMPLETED_EXECUTION_TTL_MS) {
      shouldRemove = true;
      console.log(`[streaming-store] Removing execution with no connections (last update: ${Math.round(updateAge / 1000)}s ago): ${executionId}`);
    }

    if (shouldRemove) {
      executionsToRemove.push(executionId);
    }
  }

  // Remove executions
  for (const executionId of executionsToRemove) {
    removeExecution(connections, updateHistory, executionMetadata, executionId);
  }

  if (executionsToRemove.length > 0) {
    console.log(`[streaming-store] Cleanup removed ${executionsToRemove.length} execution(s)`);
  }
}

// Create Zustand store
const useStreamingStore = create<StreamingStoreState>((set, get) => ({
  connections: new Map(),
  updateHistory: new Map(),
  executionMetadata: new Map(),
  cleanupTimer: null,

  startPeriodicCleanup: () => {
    const state = get();
    if (state.cleanupTimer) {
      return; // Already started
    }

    const timer = setInterval(() => {
      const currentState = get();
      performCleanup(
        currentState.connections,
        currentState.updateHistory,
        currentState.executionMetadata
      );
    }, CLEANUP_INTERVAL_MS);

    set({ cleanupTimer: timer });
    console.log(`[streaming-store] Started periodic cleanup (every ${CLEANUP_INTERVAL_MS / 1000}s)`);
  },

  stopPeriodicCleanup: () => {
    const state = get();
    if (state.cleanupTimer) {
      clearInterval(state.cleanupTimer);
      set({ cleanupTimer: null });
      console.log(`[streaming-store] Stopped periodic cleanup`);
    }
  },

  addConnection: (executionId: string, connection: SSEConnection) => {
    const state = get();
    const newConnections = new Map(state.connections);
    
    if (!newConnections.has(executionId)) {
      newConnections.set(executionId, new Set());
    }
    newConnections.get(executionId)!.add(connection);
    
    // Update access time
    const newMetadata = new Map(state.executionMetadata);
    const metadata = getOrCreateMetadata(newMetadata, executionId);
    metadata.lastAccessTime = Date.now();
    
    set({
      connections: newConnections,
      executionMetadata: newMetadata,
    });
    
    console.log(`[streaming-store] Added connection for execution: ${executionId}`);
    console.log(`[streaming-store] Total connections for ${executionId}: ${newConnections.get(executionId)!.size}`);
  },

  removeConnection: (executionId: string, connection: SSEConnection) => {
    const state = get();
    const execConnections = state.connections.get(executionId);
    
    if (execConnections) {
      const newConnections = new Map(state.connections);
      const newSet = new Set(execConnections);
      newSet.delete(connection);
      
      if (newSet.size === 0) {
        newConnections.delete(executionId);
        console.log(`[streaming-store] No more connections for ${executionId}, removed from map`);
        
        // If execution is completed and has no connections, schedule cleanup
        const metadata = state.executionMetadata.get(executionId);
        if (metadata?.isCompleted) {
          console.log(`[streaming-store] Execution ${executionId} is completed with no connections, will be cleaned up`);
        }
      } else {
        newConnections.set(executionId, newSet);
      }
      
      set({ connections: newConnections });
      
      console.log(`[streaming-store] Removed connection for execution: ${executionId}`);
      console.log(`[streaming-store] Remaining connections for ${executionId}: ${newSet.size}`);
    }
  },

  getConnections: (executionId: string) => {
    const state = get();
    return state.connections.get(executionId) || new Set();
  },

  getConnectionCount: () => {
    const state = get();
    let total = 0;
    for (const connections of state.connections.values()) {
      total += connections.size;
    }
    return total;
  },

  addUpdate: (update: StreamUpdate) => {
    const state = get();
    const { executionId } = update;
    
    const newHistory = new Map(state.updateHistory);
    if (!newHistory.has(executionId)) {
      newHistory.set(executionId, []);
    }
    
    const history = newHistory.get(executionId)!;
    const newHistoryArray = [...history, update];
    
    // Keep only last MAX_HISTORY updates
    if (newHistoryArray.length > MAX_HISTORY) {
      newHistoryArray.shift();
    }
    newHistory.set(executionId, newHistoryArray);
    
    // Update metadata
    const newMetadata = new Map(state.executionMetadata);
    const metadata = getOrCreateMetadata(newMetadata, executionId);
    metadata.lastUpdateTime = Date.now();
    metadata.lastAccessTime = Date.now();
    
    // Mark as completed if status indicates completion
    if (update.status === "completed" || update.status === "error") {
      if (!metadata.isCompleted) {
        markExecutionCompleted(newMetadata, executionId);
      }
    }
    
    set({
      updateHistory: newHistory,
      executionMetadata: newMetadata,
    });
    
    console.log(`[streaming-store] Added update for execution: ${executionId}, stage: ${update.stage}, status: ${update.status}`);
    console.log(`[streaming-store] History size for ${executionId}: ${newHistoryArray.length}`);
  },

  getHistory: (executionId: string) => {
    const state = get();
    
    // Update access time
    const newMetadata = new Map(state.executionMetadata);
    const metadata = newMetadata.get(executionId);
    if (metadata) {
      metadata.lastAccessTime = Date.now();
      set({ executionMetadata: newMetadata });
    }
    
    return state.updateHistory.get(executionId) || [];
  },

  getTrackedExecutions: () => {
    const state = get();
    return Array.from(state.updateHistory.keys());
  },

  getTrackedExecutionCount: () => {
    const state = get();
    return state.updateHistory.size;
  },

  broadcast: (update: StreamUpdate) => {
    const state = get();
    const { executionId } = update;
    
    // Broadcast to specific execution connections
    const execConnections = state.getConnections(executionId);
    
    // Also broadcast to 'default' connections (listening to all)
    const defaultConnections = state.getConnections('default');
    
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
  },

  clearHistory: (executionId: string) => {
    const state = get();
    const newHistory = new Map(state.updateHistory);
    newHistory.delete(executionId);
    set({ updateHistory: newHistory });
    console.log(`[streaming-store] Cleared history for execution: ${executionId}`);
  },

  markCompleted: (executionId: string) => {
    const state = get();
    const newMetadata = new Map(state.executionMetadata);
    markExecutionCompleted(newMetadata, executionId);
    set({ executionMetadata: newMetadata });
  },

  cleanupExecution: (executionId: string) => {
    const state = get();
    // Create new Maps and remove the execution
    const newConnections = new Map(state.connections);
    const newHistory = new Map(state.updateHistory);
    const newMetadata = new Map(state.executionMetadata);
    
    removeExecution(
      newConnections,
      newHistory,
      newMetadata,
      executionId
    );
    
    set({
      connections: newConnections,
      updateHistory: newHistory,
      executionMetadata: newMetadata,
    });
  },

  cleanupAll: () => {
    const state = get();
    // Create new Maps for cleanup to work on
    const newConnections = new Map(state.connections);
    const newHistory = new Map(state.updateHistory);
    const newMetadata = new Map(state.executionMetadata);
    
    performCleanup(
      newConnections,
      newHistory,
      newMetadata
    );
    
    // Update state with cleaned up Maps
    set({
      connections: newConnections,
      updateHistory: newHistory,
      executionMetadata: newMetadata,
    });
  },

  getStats: () => {
    const state = get();
    const now = Date.now();
    const completed = Array.from(state.executionMetadata.values()).filter(m => m.isCompleted).length;
    const active = Array.from(state.executionMetadata.values()).filter(m => !m.isCompleted).length;
    
    return {
      activeConnections: state.getConnectionCount(),
      trackedExecutions: state.getTrackedExecutionCount(),
      completedExecutions: completed,
      activeExecutions: active,
      executionIds: state.getTrackedExecutions(),
      oldestExecutionAge: getOldestExecutionAge(state.executionMetadata, now),
    };
  },

  shutdown: () => {
    const state = get();
    state.stopPeriodicCleanup();
    set({
      connections: new Map(),
      updateHistory: new Map(),
      executionMetadata: new Map(),
    });
    console.log(`[streaming-store] Shutdown complete`);
  },
}));

// Initialize cleanup timer (equivalent to constructor behavior)
useStreamingStore.getState().startPeriodicCleanup();

// Export singleton instance with same API as before
export const streamingStore = {
  addConnection: (executionId: string, connection: SSEConnection) => 
    useStreamingStore.getState().addConnection(executionId, connection),
  removeConnection: (executionId: string, connection: SSEConnection) => 
    useStreamingStore.getState().removeConnection(executionId, connection),
  getConnections: (executionId: string) => 
    useStreamingStore.getState().getConnections(executionId),
  getConnectionCount: () => 
    useStreamingStore.getState().getConnectionCount(),
  addUpdate: (update: StreamUpdate) => 
    useStreamingStore.getState().addUpdate(update),
  getHistory: (executionId: string) => 
    useStreamingStore.getState().getHistory(executionId),
  getTrackedExecutions: () => 
    useStreamingStore.getState().getTrackedExecutions(),
  getTrackedExecutionCount: () => 
    useStreamingStore.getState().getTrackedExecutionCount(),
  broadcast: (update: StreamUpdate) => 
    useStreamingStore.getState().broadcast(update),
  clearHistory: (executionId: string) => 
    useStreamingStore.getState().clearHistory(executionId),
  markCompleted: (executionId: string) => 
    useStreamingStore.getState().markCompleted(executionId),
  cleanupExecution: (executionId: string) => 
    useStreamingStore.getState().cleanupExecution(executionId),
  cleanupAll: () => 
    useStreamingStore.getState().cleanupAll(),
  getStats: () => 
    useStreamingStore.getState().getStats(),
  shutdown: () => 
    useStreamingStore.getState().shutdown(),
};
