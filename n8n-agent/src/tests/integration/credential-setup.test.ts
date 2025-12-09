/**
 * Credential Setup Integration Tests
 * 
 * Tests the CLI-based credential injection system
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { 
  startN8nInstance, 
  stopN8nInstance, 
  checkPodmanAvailable,
  type N8nInstance 
} from '../../utils/n8n-podman';
import { 
  checkCliAvailability,
  setupCredential,
  TEST_CREDENTIALS,
  ESSENTIAL_CREDENTIALS
} from '../../utils/n8n-credentials';
import axios from 'axios';

describe('Credential Setup Tests', () => {
  let instance: N8nInstance | null = null;
  const testTimeout = 5 * 60 * 1000; // 5 minutes

  beforeAll(async () => {
    // Check if podman is available
    const podmanAvailable = await checkPodmanAvailable();
    if (!podmanAvailable) {
      throw new Error(
        'Podman is not available. Please install podman to run integration tests.\n' +
        'Install: https://podman.io/getting-started/installation'
      );
    }
  }, testTimeout);

  afterAll(async () => {
    if (instance) {
      await stopN8nInstance(instance);
    }
  }, testTimeout);

  it('should start n8n instance with credentials', async () => {
    // Start instance (credentials are automatically injected)
    instance = await startN8nInstance({
      timeout: 120000, // 2 minutes
    });

    expect(instance).toBeDefined();
    expect(instance.containerName).toBeDefined();
    expect(instance.baseUrl).toBeDefined();
    expect(instance.apiKey).toBeDefined();
  }, testTimeout);

  it('should have n8n CLI available', async () => {
    if (!instance) throw new Error('Instance not initialized');

    const cliAvailable = await checkCliAvailability(instance.containerName);
    expect(cliAvailable).toBe(true);
  }, testTimeout);

  it('should have injected essential credentials', async () => {
    if (!instance || !instance.apiKey) {
      throw new Error('Instance not initialized or no API key');
    }

    // Check credentials via REST API
    const response = await axios.get(`${instance.baseUrl}/rest/credentials`, {
      headers: {
        'X-N8N-API-KEY': instance.apiKey,
      },
      validateStatus: () => true,
    });

    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
    expect(Array.isArray(response.data.data)).toBe(true);

    const credentials = response.data.data;
    
    // Check that we have at least some credentials
    expect(credentials.length).toBeGreaterThan(0);

    // Check for essential credentials (only those with env vars set)
    const availableEssentialCreds = ESSENTIAL_CREDENTIALS.filter(credKey => {
      const cred = TEST_CREDENTIALS[credKey];
      return Object.values(cred.data).some(value => {
        if (typeof value === 'string') return value !== '';
        if (typeof value === 'number') return true;
        return false;
      });
    });

    // Verify each available essential credential was imported
    for (const credKey of availableEssentialCreds) {
      const expectedCred = TEST_CREDENTIALS[credKey];
      const found = credentials.find((c: any) => c.id === expectedCred.id);
      
      expect(found).toBeDefined();
      expect(found.name).toBe(expectedCred.name);
      expect(found.type).toBe(expectedCred.type);
    }
  }, testTimeout);

  it('should allow manual credential setup', async () => {
    if (!instance) throw new Error('Instance not initialized');

    // Try to setup a test credential (will skip if env var not set)
    const testCredKey = 'googleGemini';
    const testCred = TEST_CREDENTIALS[testCredKey];
    
    // Check if credential data is available
    const hasData = Object.values(testCred.data).some(value => {
      if (typeof value === 'string') return value !== '';
      if (typeof value === 'number') return true;
      return false;
    });

    if (!hasData) {
      console.log(`Skipping manual setup test - ${testCredKey} has no data`);
      return;
    }

    // Setup should succeed (or skip if already exists)
    await expect(
      setupCredential(instance.containerName, instance.dataDir, testCredKey)
    ).resolves.not.toThrow();
  }, testTimeout);

  it('should have credentials with correct IDs', async () => {
    if (!instance || !instance.apiKey) {
      throw new Error('Instance not initialized or no API key');
    }

    // Get all credentials
    const response = await axios.get(`${instance.baseUrl}/rest/credentials`, {
      headers: {
        'X-N8N-API-KEY': instance.apiKey,
      },
    });

    const credentials = response.data.data;

    // Verify IDs match our TEST_CREDENTIALS
    for (const cred of credentials) {
      const expectedCred = Object.values(TEST_CREDENTIALS).find(
        tc => tc.id === cred.id
      );
      
      if (expectedCred) {
        expect(cred.id).toBe(expectedCred.id);
        expect(cred.name).toBe(expectedCred.name);
        expect(cred.type).toBe(expectedCred.type);
      }
    }
  }, testTimeout);
});

