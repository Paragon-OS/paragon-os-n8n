/**
 * n8n Setup Utilities
 * 
 * Functions to set up n8n instances for testing, including user creation and API key setup
 */

import axios from 'axios';
import { logger } from './logger';

const DEFAULT_TEST_USER = {
  email: 'test@n8n.test',
  firstName: 'Test',
  lastName: 'User',
  password: 'Test123456789', // Must contain uppercase
};

/**
 * Check if n8n setup is required (no users exist)
 */
export async function isSetupRequired(baseUrl: string): Promise<boolean> {
  try {
    // Try the setup endpoint - it might be at /rest/owner/setup or /rest/setup
    let response = await axios.get(`${baseUrl}/rest/owner/setup`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    
    logger.debug(`Setup endpoint (/rest/owner/setup) response: status=${response.status}`);
    
    // If setup endpoint returns 200, setup is required
    if (response.status === 200) {
      return true;
    }
    
    // Try alternative endpoint
    response = await axios.get(`${baseUrl}/rest/setup`, {
      timeout: 5000,
      validateStatus: () => true,
    });
    
    logger.debug(`Setup endpoint (/rest/setup) response: status=${response.status}`);
    
    return response.status === 200;
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
    logger.info(`Logging in to create API key...`);
    // Login to get session - n8n expects emailOrLdapLoginId, not email
    const loginResponse = await axios.post(
      `${baseUrl}/rest/login`,
      {
        emailOrLdapLoginId: email,
        password,
      },
      {
        timeout: 5000,
        validateStatus: () => true,
        withCredentials: true,
      }
    );

    logger.info(`Login response: status=${loginResponse.status}`);
    
    if (loginResponse.status !== 200) {
      logger.warn(`Login failed: status=${loginResponse.status}, data=${JSON.stringify(loginResponse.data).substring(0, 500)}`);
      // If 401, the user might not be ready yet - wait and retry
      if (loginResponse.status === 401) {
        logger.info(`Login returned 401, waiting 3 seconds for user to be fully ready...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      // Try waiting a bit longer and retry
      logger.info(`Waiting 2 seconds and retrying login...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const retryLoginResponse = await axios.post(
        `${baseUrl}/rest/login`,
        {
          emailOrLdapLoginId: email,
          password,
        },
        {
          timeout: 5000,
          validateStatus: () => true,
          withCredentials: true,
        }
      );
      
      logger.info(`Retry login response: status=${retryLoginResponse.status}`);
      
      if (retryLoginResponse.status !== 200) {
        logger.warn(`Retry login also failed: status=${retryLoginResponse.status}, data=${JSON.stringify(retryLoginResponse.data).substring(0, 500)}`);
        return undefined;
      }
      
      // Use retry response
      const cookies = retryLoginResponse.headers['set-cookie'];
      if (!cookies || cookies.length === 0) {
        logger.warn(`No session cookie in retry login response`);
        return undefined;
      }
      
      const sessionCookie = cookies.find(c => c.startsWith('n8n-auth=')) || cookies[0];
      logger.info(`Using session cookie from retry: ${sessionCookie.substring(0, 50)}...`);
      
      // Continue with API key creation using retry session
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
        const data = apiKeyResponse.data as { apiKey?: string; key?: string; id?: string };
        const apiKey = data.apiKey || data.key;
        if (apiKey) {
          logger.info(`✅ API key created: ${apiKey.substring(0, 10)}...`);
          return apiKey;
        } else {
          logger.warn(`API key response missing apiKey field. Full response: ${JSON.stringify(data)}`);
        }
      } else {
        logger.warn(`API key creation failed: status=${apiKeyResponse.status}, data=${JSON.stringify(apiKeyResponse.data).substring(0, 500)}`);
      }
      
      return undefined;
    }

    // Extract session cookie
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
        // expiresAt is optional - omit it for no expiration
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
      const data = apiKeyResponse.data as { apiKey?: string; key?: string; id?: string };
      const apiKey = data.apiKey || data.key;
      if (apiKey) {
        logger.info(`✅ API key created: ${apiKey.substring(0, 10)}...`);
        return apiKey;
      } else {
        logger.warn(`API key response missing apiKey field. Full response: ${JSON.stringify(data)}`);
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
    
    logger.debug(`Setup response data: ${JSON.stringify(data).substring(0, 500)}`);
    
    // Extract user ID and API key from response
    const userId = data.id || data.user?.id || '';
    let apiKey = data.apiKey;
    
    // If no API key in response, try to create one via login + API
    if (!apiKey && userId) {
      logger.debug(`No API key in setup response, creating one via API...`);
      // Wait a bit for user to be fully created
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      apiKey = await createApiKey(baseUrl, user.email, user.password);
    }
    
    logger.debug(`User created: ${userId}, API key: ${apiKey ? 'yes' : 'no'}`);
    
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
 * Wait for n8n to be fully ready (including API access)
 */
export async function waitForN8nApiReady(
  baseUrl: string,
  timeout: number = 60000
): Promise<{ apiKey?: string }> {
  const startTime = Date.now();
  
  logger.debug(`Waiting for n8n API to be ready at ${baseUrl}...`);

  while (Date.now() - startTime < timeout) {
    try {
      // Check if setup is required
      logger.debug(`Checking if setup is required...`);
      const needsSetup = await isSetupRequired(baseUrl);
      logger.debug(`Setup required: ${needsSetup}`);
      
      if (needsSetup) {
        logger.info('n8n requires setup, creating initial user...');
        try {
          const setupResult = await createInitialUser(baseUrl);
          logger.info(`User created: ${setupResult.userId}, API key: ${setupResult.apiKey ? 'yes' : 'no'}`);
          
          // Wait a bit for user to be fully created and database to be ready
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // If we got an API key, return it
          if (setupResult.apiKey) {
            logger.info(`✅ Got API key from setup: ${setupResult.apiKey.substring(0, 10)}...`);
            return { apiKey: setupResult.apiKey };
          }
          
          // If no API key, try to create one
          logger.info('No API key from setup, creating one via API...');
          const apiKey = await createApiKey(baseUrl, DEFAULT_TEST_USER.email, DEFAULT_TEST_USER.password);
          if (apiKey) {
            logger.info(`✅ Created API key: ${apiKey.substring(0, 10)}...`);
            return { apiKey };
          }
          
          logger.warn('⚠️  Could not create API key, tests will need to handle authentication');
          return {};
        } catch (setupError) {
          logger.error(`Setup failed: ${setupError instanceof Error ? setupError.message : String(setupError)}`);
          // Continue trying
        }
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
            
            // Wait a bit for user to be fully created
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Try to create API key
            const apiKey = await createApiKey(baseUrl, DEFAULT_TEST_USER.email, DEFAULT_TEST_USER.password);
            if (apiKey) {
              logger.info(`✅ Created API key: ${apiKey.substring(0, 10)}...`);
              return { apiKey };
            }
          } catch (setupError) {
            logger.error(`Setup failed: ${setupError instanceof Error ? setupError.message : String(setupError)}`);
          }
        } else {
          // User exists but we need API key
          logger.info('User exists, creating API key...');
          const apiKey = await createApiKey(baseUrl, DEFAULT_TEST_USER.email, DEFAULT_TEST_USER.password);
          if (apiKey) {
            logger.info(`✅ Created API key: ${apiKey.substring(0, 10)}...`);
            return { apiKey };
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

