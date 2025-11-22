/**
 * n8n Client Constants
 * Shared constants used across n8n client modules
 */

// Execution lookup constants
export const EXECUTION_LOOKUP_BUFFER_MS = 10000; // 10 seconds buffer for timing issues
export const MAX_WORKFLOW_ID_ATTEMPTS = 5;
export const MAX_TIME_BASED_ATTEMPTS = 3;

// Recursion depth limit for deep object searches
export const MAX_RECURSION_DEPTH = 5;

// Response timing threshold
export const SYNC_RESPONSE_THRESHOLD_MS = 5000; // Consider response sync if it took > 5s

