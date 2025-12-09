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
      
      // Session cookie should be available (API key may not be due to scope validation issues)
      expect(instance.sessionCookie).toBeDefined();
      expect(instance.sessionCookie?.length).toBeGreaterThan(0);

      console.log(`Session cookie: ${instance.sessionCookie?.substring(0, 50)}...`);

      // Try to access the API with session cookie (using /rest/workflows which is the correct endpoint)
      const response = await axios.get(`${instance.baseUrl}/rest/workflows`, {
        params: { limit: 1 },
        headers: {
          'Cookie': instance.sessionCookie!,
        },
        withCredentials: true,
        timeout: 10000,
        validateStatus: (status) => status < 500, // Don't throw on 4xx errors
      });
      
      console.log(`API response status: ${response.status}`);

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('data');
      expect(Array.isArray(response.data.data)).toBe(true);

      console.log(`✅ API accessible with session cookie: ${response.data.data.length} workflows found`);
      
      // Also test with API key if available
      if (instance.apiKey) {
        console.log(`✅ API key also available: ${instance.apiKey.substring(0, 10)}...`);
        
        const apiKeyResponse = await axios.get(`${instance.baseUrl}/rest/workflows`, {
          params: { limit: 1 },
          headers: {
            'X-N8N-API-KEY': instance.apiKey,
          },
          timeout: 10000,
        });
        
        expect(apiKeyResponse.status).toBe(200);
        console.log(`✅ API also accessible with API key`);
      } else {
        console.log(`ℹ️  API key not available (expected due to n8n scope validation), using session cookie`);
      }
    } finally {
      if (instance) {
        await stopN8nInstance(instance);
      }
    }
  }, testTimeout);
});

