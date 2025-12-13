import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 120000, // 2 minutes for container tests
    hookTimeout: 120000,
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run tests sequentially
      },
    },
  },
})
