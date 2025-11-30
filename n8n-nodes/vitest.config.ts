import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.spec.ts'],
		},
	},
	resolve: {
		alias: {
			'n8n-workflow': path.resolve(__dirname, 'node_modules/n8n-workflow/dist/index.js'),
		},
		conditions: ['node', 'require'],
	},
});

