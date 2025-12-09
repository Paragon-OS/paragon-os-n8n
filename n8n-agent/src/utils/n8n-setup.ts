/**
 * n8n Setup Utilities
 * 
 * Functions to set up n8n instances for testing, including user creation and session cookie setup
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
 * Set up n8n user and session cookie using direct HTTP API calls.
 * 
 * This function:
 * 1. Waits for DB migrations to complete
 * 2. Directly POSTs to /rest/owner/setup to create the initial user
 * 3. Logs in to get a session cookie
 * 
 * Note: API key creation is intentionally skipped as it fails due to scope
 * validation issues in n8n. Session cookies work perfectly for all operations
 * via /rest endpoints, which are automatically used when no API key is available.
 * 
 * @param containerName - Podman container name (for migration checking)
 * @param baseUrl - n8n base URL
 * @param user - User details (email, password, name)
 * @returns Object with sessionCookie (apiKey is always undefined)
 */
export async function setupN8nViaCliInContainer(
  containerName: string,
  baseUrl: string,
  user = DEFAULT_TEST_USER
): Promise<{ apiKey?: string; userId?: string; sessionCookie?: string }> {
  logger.info(`🔧 Setting up n8n user and session cookie at ${baseUrl}`);
  
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
        // Check if API key was returned (unlikely, but handle if present)
        const returnedApiKey = data.apiKey || data.api_key || data.key;
        if (returnedApiKey) {
          logger.info(`✅ User created with API key: ${userId || 'unknown'}`);
          return { apiKey: returnedApiKey, userId: userId || undefined };
        }
        
        if (userId) {
          logger.info(`✅ User created: ${userId}, will get session cookie...`);
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
        logger.info(`User already exists, proceeding to get session cookie...`);
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
  
  // Step 5: Login to get session cookie (API key creation skipped - not needed)
  logger.info(`Logging in to get session cookie...`);
  
  try {
    // Verify login endpoint is ready
    const loginEndpointCheck = await axios.get(`${baseUrl}/rest/login`, {
      timeout: 3000,
      validateStatus: () => true,
    });
    
    if (loginEndpointCheck.status === 404) {
      logger.warn(`Login endpoint not ready yet (404), waiting 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Login to get session cookie
    const loginResponse = await axios.post(
      `${baseUrl}/rest/login`,
      {
        emailOrLdapLoginId: user.email,
        password: user.password,
      },
      {
        timeout: 10000,
        validateStatus: () => true,
        withCredentials: true,
      }
    );

    if (loginResponse.status === 200) {
      const cookies = loginResponse.headers['set-cookie'];
      logger.info(`Cookies received: ${cookies ? cookies.length : 0} cookie(s)`);
      
      if (cookies && cookies.length > 0) {
        const sessionCookie = cookies.find(c => c.startsWith('n8n-auth=')) || cookies[0];
        logger.info(`✅ Session cookie obtained for authentication`);
        logger.info(`ℹ️  API key creation skipped - session cookie is sufficient for all operations via /rest endpoints`);
        return { sessionCookie, userId: undefined };
      } else {
        logger.warn(`No session cookie in login response`);
      }
    } else {
      logger.warn(`Login failed: status=${loginResponse.status}`);
    }
  } catch (error) {
    logger.error(`Failed to login and get session cookie: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  logger.warn(`⚠️  Failed to obtain session cookie`);
  return {};
}


/**
 * Setup n8n with user, session cookie, and credentials via CLI
 * 
 * This is the recommended approach for test environments as it:
 * 1. Creates user and gets session cookie via HTTP (reliable)
 * 2. Injects credentials via CLI (allows exact ID control)
 * 
 * Note: API key creation is intentionally skipped as it fails due to scope
 * validation issues. Session cookies work perfectly for all operations.
 * 
 * @param containerName - Podman container name
 * @param baseUrl - n8n base URL
 * @param dataDir - Host data directory (for credential file creation)
 * @param user - User details (optional)
 * @returns Object with sessionCookie (apiKey is always undefined)
 */
export async function setupN8nWithCredentials(
  containerName: string,
  baseUrl: string,
  dataDir: string,
  user = DEFAULT_TEST_USER
): Promise<{ apiKey?: string; sessionCookie?: string }> {
  logger.info(`🚀 Setting up n8n with user, session cookie, and credentials...`);
  
  // Step 1: Setup user and get session cookie via HTTP
  logger.info(`Step 1: Setting up user and session cookie...`);
  const { apiKey, sessionCookie } = await setupN8nViaCliInContainer(containerName, baseUrl, user);
  
  // apiKey is always undefined - this is intentional (API key creation skipped)
  if (sessionCookie) {
    logger.info(`✅ User and session cookie setup complete`);
    logger.info(`ℹ️  Using session cookie authentication (API key not needed)`);
  } else {
    logger.warn(`⚠️  Failed to obtain session cookie`);
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
  return { apiKey, sessionCookie };
}

