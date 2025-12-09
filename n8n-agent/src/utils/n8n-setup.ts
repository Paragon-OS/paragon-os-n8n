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
): Promise<{ apiKey?: string; userId?: string; sessionCookie?: string }> {
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
  let sessionCookie: string | undefined;
  
  for (let attempt = 1; attempt <= 5; attempt++) {
    logger.info(`API key creation attempt ${attempt}/5...`);
    const result = await createApiKey(baseUrl, user.email, user.password);
    
    if (result.apiKey) {
      logger.info(`✅ API key created successfully: ${result.apiKey.substring(0, 10)}...`);
      return { apiKey: result.apiKey, sessionCookie: result.sessionCookie };
    }
    
    // Store session cookie even if API key creation failed
    if (result.sessionCookie) {
      sessionCookie = result.sessionCookie;
      logger.info(`✅ Session cookie obtained (API key creation failed)`);
    }
    
    if (attempt < 5) {
      const waitTime = attempt * 3000; // 3s, 6s, 9s, 12s
      logger.info(`API key creation failed, waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  logger.error(`Failed to create API key after 5 attempts`);
  
  // Return session cookie even if API key creation failed
  if (sessionCookie) {
    logger.warn(`⚠️  No API key created, but session cookie is available for authentication`);
    return { sessionCookie };
  }
  
  return {};
}

/**
 * Create API key for a user (requires login session)
 * Returns both the API key and session cookie for authentication
 */
async function createApiKey(
  baseUrl: string,
  email: string,
  password: string
): Promise<{ apiKey?: string; sessionCookie?: string }> {
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
        return {};
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
        return {};
      }
    }

    // Extract session cookie from successful login
    const cookies = loginResponse.headers['set-cookie'];
    logger.info(`Cookies received: ${cookies ? cookies.length : 0} cookie(s)`);
    
    if (!cookies || cookies.length === 0) {
      logger.warn(`No session cookie in login response`);
      return {};
    }

    const sessionCookie = cookies.find(c => c.startsWith('n8n-auth=')) || cookies[0];
    logger.info(`Using session cookie: ${sessionCookie.substring(0, 50)}...`);

    // Create API key with proper format (label, scopes, expiresAt)
    logger.info(`Creating API key at ${baseUrl}/rest/api-keys...`);
    const apiKeyResponse = await axios.post(
      `${baseUrl}/rest/api-keys`,
      {
        label: 'test-api-key',
        // Use basic scopes - just workflow and credential read/list
        scopes: ['workflow:read', 'credential:read'],
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
        return { apiKey, sessionCookie };
      } else {
        logger.warn(`API key response missing apiKey field. Full response: ${JSON.stringify(response).substring(0, 500)}`);
      }
    } else {
      logger.warn(`API key creation failed: status=${apiKeyResponse.status}, data=${JSON.stringify(apiKeyResponse.data).substring(0, 500)}`);
    }

    // Even if API key creation failed, return the session cookie as it can be used for authentication
    logger.info(`Returning session cookie even though API key creation failed`);
    return { sessionCookie };
  } catch (error) {
    logger.debug(`Failed to create API key: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
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
): Promise<{ apiKey?: string; sessionCookie?: string }> {
  logger.info(`🚀 Setting up n8n with user, API key, and credentials...`);
  
  // Step 1: Setup user and API key via HTTP
  logger.info(`Step 1: Setting up user and API key...`);
  const { apiKey, sessionCookie } = await setupN8nViaCliInContainer(containerName, baseUrl, user);
  
  if (!apiKey) {
    logger.warn(`⚠️  No API key created, some operations may fail`);
  } else {
    logger.info(`✅ User and API key setup complete`);
  }
  
  if (sessionCookie) {
    logger.info(`✅ Session cookie available for authentication`);
  }
  
  // Step 2: Check if CLI is available for credential import
  logger.info(`Step 2: Checking n8n CLI availability...`);
  const cliAvailable = await checkCliAvailability(containerName);
  
  if (!cliAvailable) {
    logger.warn(`⚠️  n8n CLI import:credentials not available, skipping credential setup`);
    logger.warn(`   Workflows requiring credentials will fail`);
    return { apiKey, sessionCookie };
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
  if (!apiKey && sessionCookie) {
    logger.warn(`⚠️  Could not obtain API key, tests may fail`);
  }
  return { apiKey, sessionCookie };
}

