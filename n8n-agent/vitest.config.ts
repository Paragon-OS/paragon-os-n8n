import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Force vitest to use project execa (9.6.1) instead of bundled version (8.0.1)
      execa: path.resolve(__dirname, 'node_modules/execa'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Workflow integration tests can take several minutes to execute
    testTimeout: 5 * 60 * 1000, // 5 minutes
    hookTimeout: 5 * 60 * 1000, // 5 minutes for beforeAll/afterAll hooks
    // Serialize test files to prevent conflicts when multiple workflow tests
    // try to modify the same Test Runner workflow in n8n simultaneously
    // This runs test files sequentially but still allows parallel execution within files
    fileParallelism: false,
    // Use forks pool for better process isolation with child processes (n8n CLI)
    // This prevents interference between test runs and ensures proper stdout/stderr capture
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        isolate: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.spec.ts'],
    },
    // Disable logger pretty printing to avoid interfering with stdout capture
    // Set VITEST env var for reliable test environment detection
    env: {
      LOG_PRETTY: 'false',
      NODE_ENV: 'test',
      VITEST: 'true',
    },
  },
});

