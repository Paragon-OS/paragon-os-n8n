/**
 * Simple test to verify n8n instance starts correctly
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { startN8nInstance, stopN8nInstance, checkPodmanAvailable, type N8nInstance } from '../../utils/n8n-podman';
import axios from 'axios';

describe('Simple n8n Start Test', () => {
  const testTimeout = 5 * 60 * 1000; // 5 minutes

  beforeAll(async () => {
    const podmanAvailable = await checkPodmanAvailable();
    if (!podmanAvailable) {
      throw new Error('Podman is not available');
    }
  });

  it('should start n8n and access API with authentication', async () => {
    let instance: N8nInstance | null = null;

    try {
      // Start n8n instance
      instance = await startN8nInstance({
        timeout: 120000,
      });

      expect(instance).toBeDefined();
      expect(instance.baseUrl).toContain('http://localhost:');
      expect(instance.apiKey).toBeDefined();
      expect(instance.apiKey?.length).toBeGreaterThan(0);

      // Try to access the API with API key
      const response = await axios.get(`${instance.baseUrl}/api/v1/workflows`, {
        params: { limit: 1 },
        headers: {
          'X-N8N-API-KEY': instance.apiKey!,
        },
        timeout: 10000,
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('data');
      expect(Array.isArray(response.data.data)).toBe(true);

      console.log(`✅ API accessible: ${response.data.data.length} workflows found`);
    } finally {
      if (instance) {
        await stopN8nInstance(instance);
      }
    }
  }, testTimeout);
});

