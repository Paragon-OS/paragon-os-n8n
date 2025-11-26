import { defineConfig } from 'vitest/config';
import path from 'path';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local (Next.js convention)
const envLocalPath = resolve(process.cwd(), '.env.local');
const envPath = resolve(process.cwd(), '.env');

config({ path: envLocalPath });
config({ path: envPath });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/__tests__/**',
        '**/*.config.*',
        '**/mock-*.ts',
      ],
    },
    include: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**/*.ts', '**/__tests__/**/*.tsx'],
    exclude: ['node_modules', 'dist', '.next', '**/__tests__/**/test-helpers.ts', '**/__tests__/**/*.helper.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});

