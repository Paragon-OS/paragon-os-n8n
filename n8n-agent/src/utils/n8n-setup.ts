/**
 * n8n Setup Utilities
 * 
 * Functions to set up n8n instances for testing, including user creation and API key setup
 */

import axios from 'axios';
import { execa } from 'execa';
import { logger } from './logger';
import { setupEssentialCredentials, checkCliAvailability } from './n8n-credentials';

const DEFAULT_TEST_USER = {
  email: 'test@n8n.test',
  firstName: 'Test',
  lastName: 'User',
  password: 'TestPassword123', // Must contain uppercase
};

/**
 * Execute a command inside a podman container safely
 */
async function execInContainer(
  containerName: string,
  command: string[],
  options: {
    timeout?: number;
    parseJson?: boolean;
  } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number; parsed?: any }> {
  const timeout: number = options.timeout ?? 30000;
  
  try {
    const result = await execa(
      'podman',
      ['exec', '-u', 'node', containerName, ...command],
      { timeout, reject: false }
    );
    
    const exitCode = result.exitCode ?? (result.failed ? 1 : 0);
    
    let parsed;
    if (options.parseJson && result.stdout) {
      try {
        parsed = JSON.parse(result.stdout);
      } catch (e) {
        logger.warn(`Failed to parse JSON output: ${result.stdout.substring(0, 200)}`);
      }
    }
    
    return { 
      stdout: result.stdout || '', 
      stderr: result.stderr || '', 
      exitCode, 
      parsed 
    };
  } catch (error) {
    logger.error(`Failed to execute command in container: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Wait for n8n database migrations to complete
 */
async function waitForDbMigrations(
  containerName: string,
  timeout: number = 90000 // Increased default to 90 seconds
): Promise<boolean> {
  const startTime = Date.now();
  let lastProgressLog = 0;
  
  logger.info(`⏳ Waiting for n8n DB migrations to complete (timeout: ${timeout}ms)...`);
  
  while (Date.now() - startTime < timeout) {
    const elapsed = Date.now() - startTime;
    
    // Log progress every 15 seconds
    if (elapsed - lastProgressLog >= 15000) {
      logger.info(`⏳ Still waiting for migrations... (${Math.floor(elapsed / 1000)}s elapsed)`);
      lastProgressLog = elapsed;
    }
    
    try {
      // Check container logs for migration completion (optimized: reduced tail and check interval)
      const { stdout } = await execa(
        'podman',
        ['logs', '--tail', '50', containerName], // Reduced from 100 to 50 lines (faster)
        { timeout: 3000, reject: false } // Reduced timeout from 5s to 3s
      );
      
      // Look for migration completion message
      if (stdout.includes('Editor is now accessible via:') ||
          (stdout.includes('Finished migration') && !stdout.includes('Starting migration')) ||
          stdout.includes('Server ready')) { // Added another success indicator
        const elapsed = Date.now() - startTime;
        logger.info(`✅ DB migrations complete (took ${Math.floor(elapsed / 1000)}s)`);
        return true;
      }
    } catch (error) {
      // Continue waiting
      logger.debug(`Migration check error: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1500)); // Reduced from 3s to 1.5s (check more frequently)
  }
  
  logger.warn(`⚠️  DB migrations may not be complete after ${timeout}ms`);
  return false;
}

/**
 * Set up n8n user and API key using direct HTTP API calls.
 * 
 * This function:
 * 1. Waits for DB migrations to complete
 * 2. Directly POSTs to /rest/owner/setup to create the initial user
 * 3. Logs in to get a session cookie
 * 4. Creates an API key via REST API
 * 
 * @param containerName - Podman container name (for migration checking)
 * @param baseUrl - n8n base URL
 * @param user - User details (email, password, name)
 * @returns Object with apiKey and userId if successful
 */
export async function setupN8nViaCliInContainer(
  containerName: string,
  baseUrl: string,
  user = DEFAULT_TEST_USER
): Promise<{ apiKey?: string; userId?: string }> {
  logger.info(`🔧 Setting up n8n user and API key at ${baseUrl}`);
  
  // Step 1: Wait for DB migrations
  const migrationsReady = await waitForDbMigrations(containerName, 90000); // Increase to 90 seconds
  if (!migrationsReady) {
    logger.warn(`Proceeding despite migration uncertainty...`);
  }
  
  // Step 2: Quick check if REST API is responding (with short timeout)
  logger.info(`Checking if REST API is responding...`);
  try {
    const setupCheck = await axios.get(`${baseUrl}/rest/owner/setup`, {
      timeout: 2000,
      validateStatus: () => true,
    });
    
    if (setupCheck.status !== 404 && 
        !(typeof setupCheck.data === 'string' && setupCheck.data.includes('starting up'))) {
      logger.info(`✅ REST API is responding`);
    } else {
      logger.debug(`REST API not fully ready yet, but proceeding (will retry on failure)`);
    }
  } catch (error) {
    logger.debug(`REST API check failed, proceeding anyway (will retry on failure)`);
  }
  
  // Step 3: Brief wait for system stability (reduced from 3s to 1s)
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Step 4: Try to create user via POST /rest/owner/setup (don't check first, just try)
  logger.info(`Creating initial user: ${user.email}`);
  let setupResponse;
  let userCreated = false;
  
  // Retry user creation up to 3 times
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      logger.info(`User creation attempt ${attempt}/3...`);
      setupResponse = await axios.post(
        `${baseUrl}/rest/owner/setup`,
        {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          password: user.password,
        },
        {
          timeout: 20000, // Increase timeout to 20 seconds
          validateStatus: () => true, // Don't throw on any status
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      
      logger.info(`Setup response: status=${setupResponse.status}`);
      logger.debug(`Setup response data: ${JSON.stringify(setupResponse.data).substring(0, 500)}`);
      
      if (setupResponse.status === 200 || setupResponse.status === 201) {
        const data = setupResponse.data as any;
        // Try multiple possible response formats
        const userId = data.id || data.user?.id || data.userId || '';
        const apiKey = data.apiKey || data.api_key || data.key;
        
        if (apiKey) {
          logger.info(`✅ User created with API key: ${userId || 'unknown'}`);
          return { apiKey, userId: userId || undefined };
        }
        
        if (userId) {
          logger.info(`✅ User created: ${userId}, will create API key...`);
          userCreated = true;
          break; // Exit retry loop
        } else {
          logger.warn(`User creation response missing user ID, but status was ${setupResponse.status}`);
          logger.warn(`Response structure: ${Object.keys(data || {}).join(', ')}`);
          // Assume user was created even without ID
          userCreated = true;
          break;
        }
      } else if (setupResponse.status === 400 && 
                 (setupResponse.data as any)?.message?.includes('already exists')) {
        logger.info(`User already exists, proceeding to API key creation...`);
        userCreated = true;
        break;
      } else {
        logger.warn(`Setup endpoint returned unexpected status: ${setupResponse.status}`);
        logger.warn(`Response: ${JSON.stringify(setupResponse.data).substring(0, 300)}`);
        
        if (attempt < 3) {
          const waitTime = attempt * 5000; // 5s, 10s
          logger.info(`Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    } catch (error) {
      logger.error(`User creation attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`);
      
      if (attempt < 3) {
        const waitTime = attempt * 5000;
        logger.info(`Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        logger.error(`Failed to create user after ${attempt} attempts`);
        return {};
      }
    }
  }
  
  if (!userCreated) {
    logger.error(`Failed to create user after all attempts`);
    return {};
  }
  
  // Wait briefly for user to be persisted (reduced from 5s to 2s)
  logger.info(`Waiting 2 seconds for user to be persisted...`);
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Step 5: Create API key via login + REST API (with retries)
  logger.info(`Creating API key via login...`);
  let apiKey: string | undefined;
  
  for (let attempt = 1; attempt <= 5; attempt++) {
    logger.info(`API key creation attempt ${attempt}/5...`);
    apiKey = await createApiKey(baseUrl, user.email, user.password);
    
    if (apiKey) {
      logger.info(`✅ API key created successfully: ${apiKey.substring(0, 10)}...`);
      return { apiKey };
    }
    
    if (attempt < 5) {
      const waitTime = attempt * 3000; // 3s, 6s, 9s, 12s
      logger.info(`API key creation failed, waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  logger.error(`Failed to create API key after 5 attempts`);
  return {};
}

/**
 * Check if n8n setup is required (no users exist)
 * @deprecated This HTTP-based approach is unreliable. Use setupN8nViaCliInContainer instead.
 */
export async function isSetupRequired(baseUrl: string): Promise<boolean> {
  try {
    // Try the setup endpoint - it might be at /rest/owner/setup or /rest/setup
    let response = await axios.get(`${baseUrl}/rest/owner/setup`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    
    logger.info(`Setup endpoint (/rest/owner/setup) response: status=${response.status}, data type=${typeof response.data}, data=${typeof response.data === 'string' ? response.data.substring(0, 100) : JSON.stringify(response.data).substring(0, 100)}`);
    
    // If response is a string saying "starting up", n8n is not ready yet
    if (typeof response.data === 'string' && response.data.includes('starting up')) {
      logger.info(`n8n is still starting up, not ready for setup yet`);
      return false; // Return false to indicate we should wait
    }
    
    // If setup endpoint returns 200 with proper data, setup is required
    if (response.status === 200 && typeof response.data === 'object') {
      return true;
    }
    
    // Try alternative endpoint
    response = await axios.get(`${baseUrl}/rest/setup`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    
    logger.debug(`Setup endpoint (/rest/setup) response: status=${response.status}, data type=${typeof response.data}`);
    
    // Check for "starting up" message
    if (typeof response.data === 'string' && response.data.includes('starting up')) {
      logger.debug(`n8n is still starting up, not ready for setup yet`);
      return false;
    }
    
    return response.status === 200 && typeof response.data === 'object';
  } catch (error) {
    logger.debug(`Setup check failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Create initial user in n8n
 */
/**
 * Create API key for a user (requires login session)
 */
async function createApiKey(
  baseUrl: string,
  email: string,
  password: string
): Promise<string | undefined> {
  try {
    // First verify login endpoint is ready
    logger.info(`Verifying login endpoint is ready...`);
    const loginEndpointCheck = await axios.get(`${baseUrl}/rest/login`, {
      timeout: 3000,
      validateStatus: () => true,
    });
    
    if (loginEndpointCheck.status === 404) {
      logger.warn(`Login endpoint not ready yet (404), waiting 5 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Retry endpoint check
      const retryCheck = await axios.get(`${baseUrl}/rest/login`, {
        timeout: 3000,
        validateStatus: () => true,
      });
      
      if (retryCheck.status === 404) {
        logger.warn(`Login endpoint still not ready after wait`);
        return undefined;
      }
    }
    
    logger.info(`Logging in to create API key with email: ${email}...`);
    // Login to get session - n8n expects emailOrLdapLoginId, not email
    let loginResponse = await axios.post(
      `${baseUrl}/rest/login`,
      {
        emailOrLdapLoginId: email,
        password,
      },
      {
        timeout: 10000,
        validateStatus: () => true,
        withCredentials: true,
      }
    );

    logger.info(`Login response: status=${loginResponse.status}`);
    
    // Retry login if it fails (up to 2 retries)
    if (loginResponse.status !== 200) {
      logger.warn(`Login failed: status=${loginResponse.status}, data=${JSON.stringify(loginResponse.data).substring(0, 500)}`);
      
      for (let retry = 1; retry <= 2; retry++) {
        const waitTime = retry * 5000; // 5s, 10s
        logger.info(`Waiting ${waitTime}ms before login retry ${retry}/2...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        logger.info(`Retrying login (attempt ${retry + 1})...`);
        loginResponse = await axios.post(
          `${baseUrl}/rest/login`,
          {
            emailOrLdapLoginId: email,
            password,
          },
          {
            timeout: 10000,
            validateStatus: () => true,
            withCredentials: true,
          }
        );
        
        logger.info(`Retry login response: status=${loginResponse.status}`);
        
        if (loginResponse.status === 200) {
          break; // Success!
        }
      }
      
      if (loginResponse.status !== 200) {
        logger.warn(`Login failed after all retries: status=${loginResponse.status}, data=${JSON.stringify(loginResponse.data).substring(0, 500)}`);
        return undefined;
      }
    }

    // Extract session cookie from successful login
    const cookies = loginResponse.headers['set-cookie'];
    logger.info(`Cookies received: ${cookies ? cookies.length : 0} cookie(s)`);
    
    if (!cookies || cookies.length === 0) {
      logger.warn(`No session cookie in login response`);
      return undefined;
    }

    const sessionCookie = cookies.find(c => c.startsWith('n8n-auth=')) || cookies[0];
    logger.info(`Using session cookie: ${sessionCookie.substring(0, 50)}...`);

    // Create API key with proper format (label, scopes, expiresAt)
    logger.info(`Creating API key at ${baseUrl}/rest/api-keys...`);
    const apiKeyResponse = await axios.post(
      `${baseUrl}/rest/api-keys`,
      {
        label: 'test-api-key',
        scopes: [
          'credential:create',
          'credential:delete',
          'credential:move',
          'project:create',
          'project:delete',
          'project:list',
          'project:update',
          'securityAudit:generate',
          'sourceControl:pull',
          'tag:create',
          'tag:delete',
          'tag:list',
          'tag:read',
          'tag:update',
          'user:changeRole',
          'user:create',
          'user:delete',
          'user:enforceMfa',
          'user:list',
          'user:read',
          'variable:create',
          'variable:delete',
          'variable:list',
          'variable:update',
          'workflow:create',
          'workflow:delete',
          'workflow:list',
          'workflow:move',
          'workflow:read',
          'workflow:update',
          'workflowTags:update',
          'workflowTags:list',
          'workflow:activate',
          'workflow:deactivate',
          'execution:delete',
          'execution:read',
          'execution:retry',
          'execution:list',
        ],
        expiresAt: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year from now (Unix timestamp in seconds)
      },
      {
        timeout: 5000,
        validateStatus: () => true,
        headers: {
          'Cookie': sessionCookie,
          'Content-Type': 'application/json',
        },
        withCredentials: true,
      }
    );

    logger.info(`API key creation response: status=${apiKeyResponse.status}`);
    logger.info(`API key response data: ${JSON.stringify(apiKeyResponse.data).substring(0, 500)}`);

    if (apiKeyResponse.status === 200 || apiKeyResponse.status === 201) {
      const response = apiKeyResponse.data as any;
      // Response can be wrapped in { data: { rawApiKey: "...", ... } } or direct { rawApiKey: "...", ... }
      const data = response.data || response;
      const apiKey = data.rawApiKey || data.apiKey || data.key;
      if (apiKey) {
        logger.info(`✅ API key created: ${apiKey.substring(0, 15)}...`);
        return apiKey;
      } else {
        logger.warn(`API key response missing apiKey field. Full response: ${JSON.stringify(response).substring(0, 500)}`);
      }
    } else {
      logger.warn(`API key creation failed: status=${apiKeyResponse.status}, data=${JSON.stringify(apiKeyResponse.data).substring(0, 500)}`);
    }

    return undefined;
  } catch (error) {
    logger.debug(`Failed to create API key: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export async function createInitialUser(
  baseUrl: string,
  user = DEFAULT_TEST_USER
): Promise<{ userId: string; apiKey?: string }> {
  try {
    // Try /rest/owner/setup first (newer n8n versions)
    let response = await axios.post(
      `${baseUrl}/rest/owner/setup`,
      {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        password: user.password,
      },
      {
        timeout: 10000,
        validateStatus: () => true,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    logger.debug(`Setup POST (/rest/owner/setup) response: status=${response.status}`);

    // If that didn't work, try /rest/setup
    if (response.status !== 200 && response.status !== 201) {
      logger.debug(`Trying /rest/setup endpoint...`);
      response = await axios.post(
        `${baseUrl}/rest/setup`,
        {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          password: user.password,
        },
        {
          timeout: 10000,
          validateStatus: () => true,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      logger.debug(`Setup POST (/rest/setup) response: status=${response.status}`);
    }

    if (response.status !== 200 && response.status !== 201) {
      const errorData = response.data as { message?: string; code?: string };
      const errorMsg = errorData?.message || JSON.stringify(response.data);
      logger.error(`Setup failed: status=${response.status}, error=${errorMsg}`);
      throw new Error(`Failed to create user: ${response.status} ${errorMsg}`);
    }

    const data = response.data as { id?: string; apiKey?: string; user?: { id?: string }; apiKeys?: Array<{ id?: string }> };
    
    // Log the actual response structure to diagnose the issue
    logger.info(`Setup response status: ${response.status}`);
    logger.info(`Setup response data: ${JSON.stringify(data).substring(0, 500)}`);
    logger.info(`Setup response keys: ${Object.keys(data || {}).join(', ')}`);
    
    // Extract user ID and API key from response
    const userId = data.id || data.user?.id || '';
    let apiKey = data.apiKey;
    
    logger.info(`Extracted userId: "${userId}", apiKey: ${apiKey ? 'yes' : 'no'}`);
    
    // If no API key in response, try to create one via login + API
    // Note: We try to create API key even if userId is empty, as the user might still be created
    if (!apiKey) {
      logger.info(`No API key in setup response, will attempt to create one via API...`);
      // Wait longer for user to be fully created, database to be ready, and services to sync
      logger.info(`Waiting 5 seconds for user to be fully persisted and services to sync...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      apiKey = await createApiKey(baseUrl, user.email, user.password);
    }
    
    logger.info(`User creation complete - userId: "${userId}", API key: ${apiKey ? 'yes' : 'no'}`);
    
    return {
      userId,
      apiKey,
    };
  } catch (error) {
    logger.error(`Failed to create initial user`, error);
    throw error;
  }
}

/**
 * Verify that critical n8n endpoints are ready
 */
async function verifyEndpointsReady(baseUrl: string): Promise<boolean> {
  try {
    // Check if login endpoint exists (indicates REST API is ready)
    const loginCheck = await axios.get(`${baseUrl}/rest/login`, {
      timeout: 3000,
      validateStatus: () => true,
    });
    
    // 405 Method Not Allowed is actually good - it means the endpoint exists
    // 404 means it doesn't exist yet
    if (loginCheck.status === 404) {
      logger.debug(`Login endpoint not ready yet (404)`);
      return false;
    }
    
    // Also check setup endpoint
    const setupCheck = await axios.get(`${baseUrl}/rest/owner/setup`, {
      timeout: 3000,
      validateStatus: () => true,
    });
    
    if (typeof setupCheck.data === 'string' && setupCheck.data.includes('starting up')) {
      logger.debug(`Setup endpoint still returning "starting up"`);
      return false;
    }
    
    return true;
  } catch (error) {
    logger.debug(`Endpoint check failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Wait for n8n to be fully ready (including API access)
 */
export async function waitForN8nApiReady(
  baseUrl: string,
  timeout: number = 60000
): Promise<{ apiKey?: string }> {
  const startTime = Date.now();
  let lastProgressLog = 0;
  
  logger.info(`⏳ Waiting for n8n API to be ready at ${baseUrl} (timeout: ${timeout}ms)...`);

  while (Date.now() - startTime < timeout) {
    const elapsed = Date.now() - startTime;
    
    // Log progress every 10 seconds
    if (elapsed - lastProgressLog >= 10000) {
      logger.info(`⏳ Still waiting... (${Math.floor(elapsed / 1000)}s elapsed)`);
      lastProgressLog = elapsed;
    }
    try {
      // First check if n8n is still starting up
      const setupCheckResponse = await axios.get(`${baseUrl}/rest/owner/setup`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      
      if (typeof setupCheckResponse.data === 'string' && setupCheckResponse.data.includes('starting up')) {
        logger.info(`n8n still starting up, waiting 5 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }
      
      // Also wait if we get a 404 (endpoint not ready yet)
      if (setupCheckResponse.status === 404) {
        logger.info(`Setup endpoint not ready yet (404), waiting 5 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }
      
      // CRITICAL: Wait for all endpoints to be fully initialized
      logger.info(`n8n appears ready, verifying all endpoints are initialized...`);
      let endpointsReady = false;
      for (let check = 0; check < 6; check++) {
        endpointsReady = await verifyEndpointsReady(baseUrl);
        if (endpointsReady) {
          logger.info(`✅ All endpoints verified ready, proceeding with setup...`);
          break;
        }
        logger.info(`Endpoints not ready yet (check ${check + 1}/6), waiting 3 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      if (!endpointsReady) {
        logger.warn(`Endpoints still not ready after 18 seconds, continuing anyway...`);
      }
      
      // Check if setup is required
      logger.info(`Checking if setup is required...`);
      const needsSetup = await isSetupRequired(baseUrl);
      logger.info(`Setup required: ${needsSetup}`);
      
      if (needsSetup) {
        logger.info('n8n requires setup, creating initial user...');
        
        // Retry user creation up to 3 times
        let setupResult: { userId: string; apiKey?: string } | null = null;
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            logger.info(`User creation attempt ${attempt}/3...`);
            setupResult = await createInitialUser(baseUrl);
            logger.info(`✅ User created: ${setupResult.userId}, API key: ${setupResult.apiKey ? 'yes' : 'no'}`);
            break; // Success, exit retry loop
          } catch (setupError) {
            lastError = setupError instanceof Error ? setupError : new Error(String(setupError));
            logger.warn(`User creation attempt ${attempt} failed: ${lastError.message}`);
            
            if (attempt < 3) {
              const waitTime = attempt * 5000; // 5s, 10s, 15s
              logger.info(`Waiting ${waitTime}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }
          }
        }
        
        if (!setupResult) {
          logger.error(`Failed to create user after 3 attempts: ${lastError?.message}`);
          // Continue waiting, maybe it will work on next iteration
          await new Promise(resolve => setTimeout(resolve, 10000));
          continue;
        }
        
        // Wait for user to be fully persisted and all services to sync
        logger.info(`Waiting 8 seconds for user to be fully persisted and services to sync...`);
        await new Promise(resolve => setTimeout(resolve, 8000));
        
        // If we got an API key, return it
        if (setupResult.apiKey) {
          logger.info(`✅ Got API key from setup: ${setupResult.apiKey.substring(0, 10)}...`);
          return { apiKey: setupResult.apiKey };
        }
        
        // If no API key, try to create one with retries
        logger.info('No API key from setup, creating one via API...');
        let apiKey: string | undefined;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
          logger.info(`API key creation attempt ${attempt}/3...`);
          apiKey = await createApiKey(baseUrl, DEFAULT_TEST_USER.email, DEFAULT_TEST_USER.password);
          if (apiKey) {
            logger.info(`✅ Created API key: ${apiKey.substring(0, 10)}...`);
            return { apiKey };
          }
          
          if (attempt < 3) {
            const waitTime = attempt * 5000;
            logger.info(`API key creation failed, waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
        
        logger.warn('⚠️  Could not create API key after 3 attempts, tests will need to handle authentication');
        return {};
      }
      
      // Try to access the API (with or without key)
      logger.debug(`Testing API access...`);
      const testResponse = await axios.get(`${baseUrl}/api/v1/workflows`, {
        timeout: 2000,
        validateStatus: () => true,
        params: { limit: 1 },
      });
      
      logger.debug(`API test response: status=${testResponse.status}`);
      
      // 200 = API works, 401 = needs auth (but API exists), 404 = API doesn't exist yet
      if (testResponse.status === 200) {
        logger.info(`✅ n8n API is ready (no auth required)`);
        return {};
      } else if (testResponse.status === 401) {
        // API exists but needs auth - check if we need to create user
        const stillNeedsSetup = await isSetupRequired(baseUrl);
        logger.debug(`After 401, setup still required: ${stillNeedsSetup}`);
        
        if (stillNeedsSetup) {
          logger.info('API requires auth and setup is needed, creating user...');
          try {
            const setupResult = await createInitialUser(baseUrl);
            logger.info(`User created: ${setupResult.userId}`);
            
            // Wait longer for user to be fully created and services to sync
            logger.info(`Waiting 8 seconds for user to be fully persisted...`);
            await new Promise(resolve => setTimeout(resolve, 8000));
            
            // Try to create API key with retries
            let apiKey: string | undefined;
            for (let attempt = 1; attempt <= 3; attempt++) {
              logger.info(`API key creation attempt ${attempt}/3...`);
              apiKey = await createApiKey(baseUrl, DEFAULT_TEST_USER.email, DEFAULT_TEST_USER.password);
              if (apiKey) {
                logger.info(`✅ Created API key: ${apiKey.substring(0, 10)}...`);
                return { apiKey };
              }
              
              if (attempt < 3) {
                const waitTime = attempt * 5000;
                logger.info(`API key creation failed, waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
              }
            }
          } catch (setupError) {
            logger.error(`Setup failed: ${setupError instanceof Error ? setupError.message : String(setupError)}`);
          }
        } else {
          // User exists but we need API key
          logger.info('User exists, creating API key...');
          
          // Wait a bit to ensure user is fully ready
          logger.info(`Waiting 5 seconds to ensure user is fully ready...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Try to create API key with retries
          let apiKey: string | undefined;
          for (let attempt = 1; attempt <= 3; attempt++) {
            logger.info(`API key creation attempt ${attempt}/3...`);
            apiKey = await createApiKey(baseUrl, DEFAULT_TEST_USER.email, DEFAULT_TEST_USER.password);
            if (apiKey) {
              logger.info(`✅ Created API key: ${apiKey.substring(0, 10)}...`);
              return { apiKey };
            }
            
            if (attempt < 3) {
              const waitTime = attempt * 5000;
              logger.info(`API key creation failed, waiting ${waitTime}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }
          }
        }
        
        logger.warn('⚠️  Could not get API key, tests will need to handle authentication');
        return {};
      }
    } catch (error) {
      // Not ready yet, continue waiting
      if (axios.isAxiosError(error) && error.code !== 'ECONNREFUSED') {
        logger.debug(`API readiness check error (will retry): ${error.message}`);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error(`n8n API failed to become ready within ${timeout}ms`);
}

/**
 * Setup n8n with user, API key, and credentials via CLI
 * 
 * This is the recommended approach for test environments as it:
 * 1. Creates user and API key via HTTP (reliable)
 * 2. Injects credentials via CLI (allows exact ID control)
 * 
 * @param containerName - Podman container name
 * @param baseUrl - n8n base URL
 * @param dataDir - Host data directory (for credential file creation)
 * @param user - User details (optional)
 * @returns Object with apiKey
 */
export async function setupN8nWithCredentials(
  containerName: string,
  baseUrl: string,
  dataDir: string,
  user = DEFAULT_TEST_USER
): Promise<{ apiKey?: string }> {
  logger.info(`🚀 Setting up n8n with user, API key, and credentials...`);
  
  // Step 1: Setup user and API key via HTTP
  logger.info(`Step 1: Setting up user and API key...`);
  const { apiKey } = await setupN8nViaCliInContainer(containerName, baseUrl, user);
  
  if (!apiKey) {
    logger.warn(`⚠️  No API key created, some operations may fail`);
  } else {
    logger.info(`✅ User and API key setup complete`);
  }
  
  // Step 2: Check if CLI is available for credential import
  logger.info(`Step 2: Checking n8n CLI availability...`);
  const cliAvailable = await checkCliAvailability(containerName);
  
  if (!cliAvailable) {
    logger.warn(`⚠️  n8n CLI import:credentials not available, skipping credential setup`);
    logger.warn(`   Workflows requiring credentials will fail`);
    return { apiKey };
  }
  
  logger.info(`✅ n8n CLI is available`);
  
  // Step 3: Setup credentials via CLI
  logger.info(`Step 3: Setting up credentials via CLI...`);
  try {
    await setupEssentialCredentials(containerName, dataDir);
    logger.info(`✅ Credentials setup complete`);
  } catch (error) {
    logger.error(`Failed to setup credentials: ${error instanceof Error ? error.message : String(error)}`);
    logger.warn(`⚠️  Some workflows may fail due to missing credentials`);
  }
  
  logger.info(`🎉 n8n setup complete!`);
  return { apiKey };
}

