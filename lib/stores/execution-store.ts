/**
 * Execution Tracking Store
 * Client-side Zustand store for tracking n8n execution metadata
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { StreamUpdate } from "../n8n-client/types";

export type ExecutionStatus = "pending" | "running" | "completed" | "error";

export interface ExecutionMetadata {
  id: string; // executionId
  workflowId?: string;
  status: ExecutionStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  lastUpdateStage?: string;
  lastUpdateMessage?: string;
  // Link to stream updates - store count and latest update timestamp
  updateCount?: number;
  latestUpdateTimestamp?: string;
}

interface ExecutionStore {
  executions: Record<string, ExecutionMetadata>;
  
  // Actions
  registerExecution: (executionId: string, metadata?: Partial<ExecutionMetadata>) => void;
  updateExecution: (executionId: string, updates: Partial<ExecutionMetadata>) => void;
  updateFromStreamUpdate: (update: StreamUpdate) => void;
  getExecution: (executionId: string) => ExecutionMetadata | undefined;
  getExecutionsByWorkflow: (workflowId: string) => ExecutionMetadata[];
  getAllExecutions: () => ExecutionMetadata[];
  clearExecution: (executionId: string) => void;
  clearAll: () => void;
  
  // Statistics
  getStats: () => {
    total: number;
    pending: number;
    running: number;
    completed: number;
    error: number;
  };
}

const getStatusFromStreamUpdate = (update: StreamUpdate): ExecutionStatus => {
  switch (update.status) {
    case "completed":
      return "completed";
    case "error":
      return "error";
    case "in_progress":
      return "running";
    default:
      return "running";
  }
};

export const useExecutionStore = create<ExecutionStore>()(
  persist(
    (set, get) => ({
      executions: {},

      registerExecution: (executionId, metadata = {}) => {
        const existing = get().executions[executionId];
        if (existing) {
          // Update existing execution
          get().updateExecution(executionId, {
            ...metadata,
            updatedAt: Date.now(),
          });
          return;
        }

        // Create new execution
        const now = Date.now();
        const newExecution: ExecutionMetadata = {
          id: executionId,
          status: "pending",
          createdAt: now,
          updatedAt: now,
          ...metadata,
        };

        set((state) => ({
          executions: {
            ...state.executions,
            [executionId]: newExecution,
          },
        }));
      },

      updateExecution: (executionId, updates) => {
        const existing = get().executions[executionId];
        if (!existing) {
          // If execution doesn't exist, register it first
          get().registerExecution(executionId, updates);
          return;
        }

        const updated: ExecutionMetadata = {
          ...existing,
          ...updates,
          updatedAt: Date.now(),
          // Set completedAt if status changed to completed or error
          completedAt:
            (updates.status === "completed" || updates.status === "error") &&
            existing.status !== "completed" &&
            existing.status !== "error"
              ? Date.now()
              : existing.completedAt,
        };

        set((state) => ({
          executions: {
            ...state.executions,
            [executionId]: updated,
          },
        }));
      },

      updateFromStreamUpdate: (update) => {
        const { executionId } = update;
        if (!executionId) return;

        const existing = get().executions[executionId];
        const status = getStatusFromStreamUpdate(update);

        if (!existing) {
          // Register new execution from stream update
          get().registerExecution(executionId, {
            status,
            lastUpdateStage: update.stage,
            lastUpdateMessage: update.message,
            updateCount: 1,
            latestUpdateTimestamp: update.timestamp,
          });
        } else {
          // Update existing execution
          get().updateExecution(executionId, {
            status,
            lastUpdateStage: update.stage,
            lastUpdateMessage: update.message,
            updateCount: (existing.updateCount || 0) + 1,
            latestUpdateTimestamp: update.timestamp,
          });
        }
      },

      getExecution: (executionId) => {
        return get().executions[executionId];
      },

      getExecutionsByWorkflow: (workflowId) => {
        return Object.values(get().executions).filter(
          (exec) => exec.workflowId === workflowId
        );
      },

      getAllExecutions: () => {
        return Object.values(get().executions);
      },

      clearExecution: (executionId) => {
        set((state) => {
          const { [executionId]: _removed, ...rest } = state.executions;
          return { executions: rest };
        });
      },

      clearAll: () => {
        set({ executions: {} });
      },

      getStats: () => {
        const executions = Object.values(get().executions);
        return {
          total: executions.length,
          pending: executions.filter((e) => e.status === "pending").length,
          running: executions.filter((e) => e.status === "running").length,
          completed: executions.filter((e) => e.status === "completed").length,
          error: executions.filter((e) => e.status === "error").length,
        };
      },
    }),
    {
      name: "execution-store", // localStorage key
      // Only persist essential fields to avoid storing too much data
      partialize: (state) => ({
        executions: Object.fromEntries(
          Object.entries(state.executions).map(([id, exec]) => [
            id,
            {
              id: exec.id,
              workflowId: exec.workflowId,
              status: exec.status,
              createdAt: exec.createdAt,
              updatedAt: exec.updatedAt,
              completedAt: exec.completedAt,
              // Don't persist update-related fields as they're transient
            },
          ])
        ),
      }),
    }
  )
);

