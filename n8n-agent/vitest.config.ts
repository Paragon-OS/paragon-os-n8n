import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Workflow integration tests can take several minutes to execute
    testTimeout: 5 * 60 * 1000, // 5 minutes
    hookTimeout: 5 * 60 * 1000, // 5 minutes for beforeAll/afterAll hooks
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.spec.ts'],
    },
  },
});

