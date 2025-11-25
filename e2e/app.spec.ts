import { test, expect } from '@playwright/test';

test.describe('App Integration Tests', () => {
  test('should open the app without console errors', async ({ page }) => {
    // Collect console errors
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];

    // Listen for console errors and warnings
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error') {
        consoleErrors.push(text);
      } else if (msg.type() === 'warning') {
        consoleWarnings.push(text);
      }
    });

    // Listen for page errors
    page.on('pageerror', (error) => {
      consoleErrors.push(`Page error: ${error.message}`);
    });

    // Navigate to the app
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Wait for the app to initialize (it shows "Loading session..." or "Initializing session..." initially)
    // Wait for either the sidebar or the main content to appear, indicating the app has loaded
    await page.waitForSelector('header, [role="main"], aside', { timeout: 30000 });

    // Wait a bit more to catch any delayed errors
    await page.waitForTimeout(1000);

    // Check that there are no console errors
    if (consoleErrors.length > 0) {
      console.error('Console errors found:', consoleErrors);
    }
    expect(consoleErrors).toHaveLength(0);

    // Log warnings if any (but don't fail the test)
    if (consoleWarnings.length > 0) {
      console.log('Console warnings found:', consoleWarnings);
    }

    // Verify the page loaded successfully by checking for a basic element
    await expect(page).toHaveTitle(/ParagonOS/i);
  });

  test('should load without critical errors', async ({ page }) => {
    const errors: string[] = [];

    // Listen for console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(`Console error: ${msg.text()}`);
      }
    });

    // Listen for page errors (unhandled exceptions)
    page.on('pageerror', (error) => {
      errors.push(`Page error: ${error.message}`);
    });

    // Listen for failed requests (but allow some network failures)
    const failedRequests: string[] = [];
    page.on('requestfailed', (request) => {
      // Only track critical failures (not 404s, etc.)
      const failure = request.failure();
      if (failure && failure.errorText !== 'net::ERR_ABORTED') {
        failedRequests.push(`Request failed: ${request.url()} - ${failure.errorText}`);
      }
    });

    // Navigate to the app
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Wait for the app to initialize
    await page.waitForSelector('header, [role="main"], aside', { timeout: 30000 });
    await page.waitForTimeout(1000);

    // Check that there are no critical errors
    if (errors.length > 0) {
      console.error('Errors found:', errors);
    }
    expect(errors).toHaveLength(0);
  });
});

