# n8n Credential Injection System - AI Context & Debugging Journal

> **Purpose:** This document provides context for AI assistants working on this project. It documents our debugging journey, successes, failures, and key learnings.

---

## 🎯 Project Overview

**Goal:** Implement CLI-based credential injection for n8n test containers with exact credential IDs matching workflow JSON files.

**Status:** ✅ Production-Ready (credential injection works perfectly)  
**Known Issue:** ⚠️ API key creation fails due to scope validation (workaround available)

---

## ✅ **WHAT WORKS (SUCCESSES)**

### 1. CLI-Based Credential Import ⭐ FINAL SOLUTION

**Implementation:**
```typescript
// File: src/utils/n8n-credentials.ts
// Credentials MUST be wrapped in an array
const credentialJson = [{
  id: "NIhZoi9otQV2vaAP",  // Exact ID from workflow JSON
  name: "Google Gemini(PaLM) Api account",
  type: "googlePalmApi",
  data: { apiKey: process.env.GOOGLE_GEMINI_API_KEY }
}];

// Import via CLI
podman exec container n8n import:credentials --input /tmp/cred.json
```

**Key Learnings:**
- ✅ n8n CLI requires credentials in **array format** `[{...}]`, not single object `{...}`
- ✅ Can specify exact credential IDs (no random IDs!)
- ✅ No workflow modification needed after import
- ✅ Cleaner and more reliable than REST API
- ✅ Works across n8n versions

**Result:** All 4 essential credentials inject successfully with exact IDs

### 2. Test Infrastructure

**Commands:**
```bash
npm run test:credentials        # Run credential tests
npm run test:credentials:log    # Run with logging
npm run test:cleanup            # Cleanup containers
npm run test:simple             # Quick smoke test
```

**Key Features:**
- Automatic cleanup before tests
- Background execution with logging
- Log files in `/tmp/n8n-tests/`
- Colored output and progress indicators

**Files:**
- `package.json` - npm scripts
- `scripts/test-integration.sh` - Enhanced test runner
- `docs/TESTING.md` - Full guide

### 3. Container Management

**Implementation:**
```typescript
// Auto-select available port
const port = await findAvailablePort();

// Cleanup in afterEach
afterEach(async () => {
  if (instance) {
    await stopN8nInstance(instance);
    instance = null;
  }
});
```

**Key Learnings:**
- Random port allocation prevents conflicts
- Cleanup in both `afterEach` AND `afterAll`
- Container names with timestamps prevent collisions
- Use `reject: false` in execa for graceful error handling

---

## ❌ **WHAT DOESN'T WORK (FAILURES & LESSONS)**

### 1. REST API Credential Creation ❌ ABANDONED

**What We Tried:**
```typescript
// Create credential via REST API
const response = await axios.post('/rest/credentials', {
  name: 'Google Gemini',
  type: 'googlePalmApi',
  data: { apiKey: '...' }
});
// Problem: n8n assigns RANDOM ID
```

**Why It Failed:**
- ❌ Random credential IDs (can't match workflow JSON)
- ❌ Complex session management (login, cookies)
- ❌ Must update workflow JSON with new IDs
- ❌ Error-prone and fragile

**Lesson:** ⚡ Use CLI for credential import, NOT REST API

### 2. Credential File Format ❌ FIXED

**Wrong Format:**
```json
{
  "id": "NIhZoi9otQV2vaAP",
  "name": "Google Gemini",
  ...
}
```

**Error:**
```
File does not seem to contain credentials. 
Make sure the credentials are contained in an array.
```

**Correct Format:**
```json
[{
  "id": "NIhZoi9otQV2vaAP",
  "name": "Google Gemini",
  ...
}]
```

**Lesson:** ⚡ n8n CLI expects array format, even for single credential

### 3. API Key Scopes ⚠️ ONGOING ISSUE

**Multiple Attempts Failed:**

```typescript
// Attempt 1: Full scopes (40+ scopes)
scopes: ['credential:create', 'credential:delete', ...]
// Error: "Invalid scopes for user role"

// Attempt 2: Empty array
scopes: []
// Error: "Array must contain at least 1 element(s)"

// Attempt 3: Minimal scopes
scopes: ['workflow:read', 'credential:read']
// Error: "Invalid scopes for user role"

// Attempt 4: Basic scopes
scopes: ['workflow:read', 'workflow:list', 'credential:read', 'credential:list']
// Error: "Invalid scopes for user role"
```

**Why It Fails:**
- n8n scope validation is **version-specific**
- Owner role has different valid scopes than member role
- Community vs Enterprise editions differ
- No clear documentation of valid scopes

**Impact:**
- ❌ API key creation fails
- ✅ Credentials still work via CLI (main goal achieved!)

**Workarounds:**
1. Use session cookie authentication
2. Create API key manually in n8n UI
3. Skip API key-dependent tests

**Lesson:** ⚡ Don't rely on API keys for credential injection - CLI works without them!

### 4. Port Conflicts ❌ FIXED

**Problem:**
```
Error: Port 50000 already in use
Multiple test containers running
```

**Solution:**
```bash
# Automatic cleanup before tests
npm run test:cleanup

# Cleanup in afterEach hooks
afterEach(async () => {
  if (instance) {
    await stopN8nInstance(instance);
  }
});
```

**Lesson:** ⚡ Always cleanup containers, even on test failure

### 5. Test Isolation ❌ FIXED

**Problem:** Tests shared same container instance

**Solution:**
```typescript
// Start fresh instance per test
beforeEach(async () => {
  instance = await startN8nInstance();
});

afterEach(async () => {
  if (instance) {
    await stopN8nInstance(instance);
    instance = null;
  }
});
```

**Lesson:** ⚡ Each test needs its own isolated container

### 6. Credential Setup Counting Bug ❌ FIXED (2025-01-09)

**Problem:**
```
📊 Credential Setup Summary:
  ✅ Successful: 4/4  // ❌ WRONG! Only 3 were actually set up
```

**Root Cause:**
```typescript
// In setupCredential function
if (!hasData) {
  logger.warn(`⚠️  Skipping ${credential.name} - no data available`);
  return; // ❌ Returns silently, caller thinks it succeeded!
}

// In setupEssentialCredentials
await setupCredential(...);
results.push({ credential: credKey, success: true }); // ❌ Always executes!
```

**Why It Failed:**
- `setupCredential` returned early (didn't throw) when skipping
- Caller always added `success: true` after the call
- Skipped credentials were counted as successful

**Fix:**
```typescript
// Make skipped credentials throw an error
if (!hasData) {
  const errorMsg = `Skipped - no data available in environment`;
  logger.warn(`⚠️  Skipping ${credential.name} - ${errorMsg}`);
  throw new Error(errorMsg); // ✅ Now properly caught and counted as failed
}
```

**Result:**
```
📊 Credential Setup Summary:
  ✅ Successful: 3/4
  ❌ Failed: 1/4
    - googleGemini: Skipped - no data available in environment
```

**Lesson:** ⚡ When a function skips work, it should throw an error (not return silently) so callers can properly track failures

### 7. Missing dotenv Import ❌ FIXED (2025-01-09)

**Problem:**
```
⚠️  Skipping Google Gemini(PaLM) Api account - no data available in environment
```
Even though `GOOGLE_GEMINI_API_KEY` exists in `.env` file.

**Root Cause:**
```typescript
// n8n-credentials.ts - Missing dotenv import!
export const TEST_CREDENTIALS = {
  googleGemini: {
    data: {
      apiKey: process.env.GOOGLE_GEMINI_API_KEY || '', // ❌ undefined - .env not loaded!
    },
  },
};
```

**Why It Failed:**
- `TEST_CREDENTIALS` is defined at module load time
- It reads `process.env.GOOGLE_GEMINI_API_KEY` immediately
- Without `dotenv/config`, the `.env` file hasn't been loaded yet
- `process.env.GOOGLE_GEMINI_API_KEY` is `undefined`, defaults to `''`
- Empty string fails the `hasData` check

**Fix:**
```typescript
// Load environment variables from .env file if it exists
import 'dotenv/config'; // ✅ Add this at the top!

export const TEST_CREDENTIALS = {
  // Now process.env is populated before this runs
};
```

**Result:**
```
📊 Credential Setup Summary:
  ✅ Successful: 4/4  // ✅ All credentials including Google Gemini!
```

**Key Learnings:**
- ⚡ **Always import `dotenv/config`** in files that read `process.env` at module load time
- ⚡ Files that define constants using `process.env` need dotenv loaded first
- ⚡ Other files like `n8n-api.ts` already had it, but `n8n-credentials.ts` was missing it
- ⚡ The import is safe to call multiple times (dotenv only loads once)

**Pattern to Follow:**
```typescript
// At the top of any file that uses process.env
import 'dotenv/config'; // Load .env before reading process.env
```

---

## 🔑 **CRITICAL INSIGHTS**

### 1. CLI > REST API for Credentials

| Aspect | CLI ✅ | REST API ❌ |
|--------|--------|-------------|
| ID Control | Exact IDs | Random IDs |
| Complexity | Simple | Complex (sessions) |
| Workflow Modification | None | Required |
| Reliability | High | Medium |

### 2. Credential Format Rules

```typescript
// ❌ WRONG - Single object
const cred = { id: "...", name: "...", ... };

// ✅ CORRECT - Array of objects
const cred = [{ id: "...", name: "...", ... }];
```

### 3. API Key Scopes Are Unreliable

- No universal scope list
- Version-specific validation
- Undocumented requirements
- **Solution:** Use session cookies instead

### 4. Container Cleanup is Critical

```bash
# Always cleanup before tests
podman ps -q --filter 'name=n8n-test' | xargs podman stop
podman ps -aq --filter 'name=n8n-test' | xargs podman rm -f
```

### 5. Test Isolation Prevents Flaky Tests

- One container per test
- Cleanup in `afterEach` AND `afterAll`
- Random ports prevent conflicts
- Timestamps in container names

### 6. Always Import dotenv/config for process.env

**Critical Pattern:**
```typescript
// ✅ CORRECT - Load .env before using process.env
import 'dotenv/config';

export const CONFIG = {
  apiKey: process.env.API_KEY || '', // Now works!
};
```

**Why It Matters:**
- Files that define constants using `process.env` at module load time need dotenv loaded first
- Without it, `process.env.VAR_NAME` is `undefined` even if it exists in `.env`
- The import is safe to call multiple times (dotenv only loads once)
- Files like `n8n-api.ts` already have it, but `n8n-credentials.ts` was missing it

**Files That Need It:**
- Any file that reads `process.env` at the top level (module load time)
- Files that define constants/objects using `process.env` values
- Files that don't have dotenv loaded by their dependencies

**Lesson:** ⚡ Always check if `dotenv/config` is imported when `process.env` values are undefined

### 7. Error Handling: Throw, Don't Return Silently

**Anti-Pattern:**
```typescript
if (!hasData) {
  logger.warn('Skipping...');
  return; // ❌ Caller thinks it succeeded!
}

// Caller code
await setupCredential(...);
results.push({ success: true }); // ❌ Always executes!
```

**Correct Pattern:**
```typescript
if (!hasData) {
  throw new Error('Skipped - no data available'); // ✅ Properly caught
}

// Caller code
try {
  await setupCredential(...);
  results.push({ success: true });
} catch (error) {
  results.push({ success: false, error: error.message }); // ✅ Counted as failed
}
```

**Lesson:** ⚡ When a function skips work, throw an error so callers can properly track failures

---

## 📋 **IMPLEMENTATION CHECKLIST**

When working with credential injection:

- [ ] Use CLI (`n8n import:credentials`), NOT REST API
- [ ] Wrap credentials in array `[{...}]`
- [ ] Use exact IDs from workflow JSON
- [ ] **Import `dotenv/config`** in files that read `process.env` at module load time
- [ ] Read credentials from environment variables
- [ ] Cleanup temp files after import
- [ ] Check CLI availability before import
- [ ] Handle missing environment variables gracefully (throw error, don't return silently)
- [ ] Log detailed progress for debugging
- [ ] Cleanup containers in `afterEach`
- [ ] Use random ports for containers
- [ ] Don't rely on API key creation

---

## 🐛 **DEBUGGING GUIDE**

### Credential Import Fails

1. **Check file format:**
   ```bash
   cat /tmp/credential.json
   # Should be: [{...}] not {...}
   ```

2. **Verify CLI availability:**
   ```bash
   podman exec container n8n --help | grep import
   ```

3. **Test import manually:**
   ```bash
   podman cp cred.json container:/tmp/cred.json
   podman exec container n8n import:credentials --input /tmp/cred.json
   ```

4. **Check container logs:**
   ```bash
   podman logs container-name | tail -50
   ```

### Tests Hang or Fail

1. **Check running containers:**
   ```bash
   podman ps --filter 'name=n8n-test'
   ```

2. **Force cleanup:**
   ```bash
   npm run test:cleanup
   ```

3. **Check port usage:**
   ```bash
   lsof -i :50000
   ```

4. **View test logs:**
   ```bash
   tail -100 /tmp/n8n-tests/test_*.log
   ```

### API Key Creation Fails

1. **Don't panic** - credentials still work via CLI!
2. **Use session cookie** for API authentication
3. **Create API key manually** in n8n UI if needed
4. **Skip API key tests** - focus on credential injection

---

## 📊 **PERFORMANCE METRICS**

| Operation | Duration | Notes |
|-----------|----------|-------|
| Container startup | 2-5s | First run slower (image pull) |
| n8n initialization | 3-5s | DB migrations |
| User creation | 1-2s | HTTP-based |
| API key creation | FAILS | Scope validation issue |
| Credential import (1) | 2-3s | Per credential via CLI |
| Credential import (4) | 8-12s | All essential credentials |
| Full test suite | 10-15min | All integration tests |

---

## 📁 **KEY FILES**

### Core Implementation
- `src/utils/n8n-credentials.ts` - Credential management (461 lines)
- `src/utils/n8n-setup.ts` - Setup orchestration (864 lines)
- `src/utils/n8n-podman.ts` - Container management (511 lines)

### Tests
- `src/tests/integration/credential-setup.test.ts` - Credential tests
- `src/tests/integration/backup-restore.test.ts` - Backup tests
- `src/tests/integration/simple-start.test.ts` - Smoke test

### Documentation
- `docs/CREDENTIALS.md` - User guide
- `docs/TESTING.md` - Test guide
- `docs/QUICK-START-TESTING.md` - Quick reference
- `docs/CLI-CREDENTIAL-IMPLEMENTATION.md` - Implementation details
- `docs/API-KEY-SCOPES-ISSUE.md` - Known issue
- `docs/CREDENTIAL-ARCHITECTURE.md` - Architecture diagrams

### Scripts
- `scripts/test-integration.sh` - Enhanced test runner
- `package.json` - npm scripts

---

## 🎯 **PRODUCTION STATUS**

### ✅ Working & Production-Ready

- Credential injection via CLI
- Exact credential ID control
- Container management
- Test automation
- Cleanup mechanisms
- Logging and debugging

### ⚠️ Known Limitations

- API key creation (scope validation fails)
- Requires manual API key for some tests
- Session cookie authentication needed for API tests

### 🚀 Ready to Use

```bash
# Set environment variables
export GOOGLE_GEMINI_API_KEY="your-key"
export QDRANT_URL="https://your-instance.cloud.qdrant.io:6333"
export QDRANT_API_KEY="your-key"

# Run tests
npm run test:credentials

# Result: ✅ All 4 credentials injected with exact IDs!
```

---

## 💡 **TIPS FOR AI ASSISTANTS**

### Do's ✅

1. **Use CLI** for credential import (`n8n import:credentials`)
2. **Wrap credentials** in array format `[{...}]`
3. **Import dotenv/config** in files using `process.env` at module load time
4. **Throw errors** when skipping work (don't return silently)
5. **Cleanup containers** before and after tests
6. **Use random ports** to prevent conflicts
7. **Log everything** for debugging
8. **Check this document** before attempting fixes

### Don'ts ❌

1. **Don't use REST API** for credential creation
2. **Don't retry** API key scope combinations (all fail)
3. **Don't skip cleanup** - it causes 90% of issues
4. **Don't share containers** between tests
5. **Don't block on API keys** - credentials work without them

### Quick Wins 🎯

1. **Read logs:** `tail -100 /tmp/n8n-tests/test_*.log`
2. **Cleanup:** `npm run test:cleanup`
3. **Test specific:** `npm run test:credentials`
4. **Debug mode:** `npm run test:credentials:log`

---

## 🔮 **FUTURE IMPROVEMENTS**

### High Priority
1. Solve API key scopes (find valid scopes for owner role)
2. Implement session cookie auth as alternative
3. Auto-detect valid scopes per n8n version

### Medium Priority
1. Credential validation before import
2. Bulk credential operations
3. Credential templates

### Low Priority
1. Encrypted credential storage
2. Automatic credential rotation
3. Parallel test execution

---

## 📝 **QUICK REFERENCE**

### Essential Commands
```bash
# Run tests
npm run test:credentials        # Credential tests (~2 min)
npm run test:simple             # Smoke test (~1 min)
npm run test:integration        # All tests (~10 min)

# With logging
npm run test:credentials:log    # Background + logs

# Cleanup
npm run test:cleanup            # Stop & remove containers

# Debug
tail -f /tmp/n8n-tests/test_*.log
podman ps --filter 'name=n8n-test'
podman logs container-name
```

### Essential Environment Variables
```bash
export GOOGLE_GEMINI_API_KEY="your-key"
export QDRANT_URL="https://xxx.cloud.qdrant.io:6333"
export QDRANT_API_KEY="your-key"
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
```

### Common Issues & Fixes
```bash
# Port conflict
npm run test:cleanup

# Container won't stop
podman rm -f $(podman ps -aq --filter 'name=n8n-test')

# Test hangs
# Ctrl+C, then: npm run test:cleanup

# Check logs
ls -lh /tmp/n8n-tests/
tail -100 /tmp/n8n-tests/test_*.log
```

---

## 🎓 **LESSONS LEARNED**

1. **CLI > REST API** for credential management
2. **Array format** is required for n8n CLI
3. **API key scopes** are version-specific and undocumented
4. **Container cleanup** prevents 90% of test issues
5. **Test isolation** prevents flaky tests
6. **Logging** is essential for debugging async operations
7. **Don't block** on API key issues - credentials work without them!
8. **Always check** this document before attempting fixes

---

## 🏆 **SUCCESS METRICS**

When tests pass, you'll see:

```
✓ src/tests/integration/credential-setup.test.ts (5)
  ✓ Credential Setup Tests (5)
    ✓ should start n8n instance with credentials
    ✓ should have n8n CLI available
    ✓ should have injected essential credentials
    ✓ should allow manual credential setup
    ✓ should have credentials with correct IDs

Test Files  1 passed (1)
     Tests  5 passed (5)
```

And in logs:
```
✅ Google Gemini(PaLM) Api account setup complete
✅ Redis account setup complete
✅ QdrantApi account setup complete
✅ Header Auth account setup complete
📊 Credential Setup Summary: ✅ Successful: 4/4
```

---

**Last Updated:** December 9, 2025  
**Status:** ✅ Production-Ready  
**Next Session:** Start by reading this document!

---

*This document is maintained in `.cursor/ai-context.md` for AI assistant context.*

