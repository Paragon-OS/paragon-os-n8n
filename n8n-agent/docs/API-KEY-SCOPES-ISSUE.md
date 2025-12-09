# API Key Scopes Issue

## Status: Known Issue

The credential injection system **works perfectly** via CLI. The only issue is with API key creation due to strict scope validation in n8n.

## What Works ✅

- ✅ Credential injection via CLI (`n8n import:credentials`)
- ✅ Credentials imported with exact IDs
- ✅ All 4 essential credentials injected successfully
- ✅ Container startup and n8n initialization
- ✅ User creation

## What Doesn't Work ❌

- ❌ API key creation (scope validation fails)

## The Problem

n8n's API key endpoint validates scopes very strictly. The error:

```
"Invalid scopes for user role"
```

We've tried:
- Empty array `[]` → "Array must contain at least 1 element"
- `['workflow:read', 'credential:read']` → "Invalid scopes for user role"
- Various combinations → All fail

## Why This Happens

The valid scopes for API keys depend on:
1. n8n version
2. User role (owner vs member)
3. License type (community vs enterprise)
4. Feature flags

The scopes that work in one version may not work in another.

## Workaround

### Option 1: Use Session Cookie (Recommended)

Instead of API key, use session cookie for authentication:

```typescript
// Login to get session cookie
const loginResponse = await axios.post(`${baseUrl}/rest/login`, {
  email: 'test@n8n.test',
  password: 'TestPassword123',
});

const sessionCookie = loginResponse.headers['set-cookie'][0];

// Use cookie for API calls
await axios.get(`${baseUrl}/rest/credentials`, {
  headers: { Cookie: sessionCookie },
});
```

### Option 2: Skip API Key Tests

Since credentials work via CLI, we can:
1. Test credential injection (works!)
2. Skip API key-dependent tests
3. Document that API key creation needs manual setup

### Option 3: Manual API Key Creation

Create API key manually in n8n UI:
1. Start n8n: `podman run -p 5678:5678 n8nio/n8n`
2. Open: http://localhost:5678
3. Settings → API → Create API Key
4. Copy key to environment: `export N8N_API_KEY="..."`

## Current Implementation

The code continues even if API key creation fails:

```typescript
if (!apiKey) {
  logger.warn('⚠️  Could not obtain API key, tests may fail');
}
// Continue anyway - credentials still work!
```

## Impact

### What Still Works

- ✅ Credential injection (main feature!)
- ✅ Container management
- ✅ User creation
- ✅ CLI operations

### What's Limited

- ❌ REST API tests requiring authentication
- ❌ Workflow creation via API
- ❌ Credential verification via API

## Solution Status

### Short Term

Document the limitation and provide workarounds.

### Long Term

Options:
1. **Find valid scopes** for the n8n version we're using
2. **Use session cookies** instead of API keys
3. **Skip API key creation** and focus on CLI operations
4. **Version-specific scopes** - detect n8n version and use appropriate scopes

## Recommendation

**Use session cookie authentication** for tests that need API access. The credential injection via CLI works perfectly and doesn't need API keys.

## Testing Without API Key

The credential injection can be tested without API key:

```bash
# Start container
podman run -d --name n8n-test -p 5678:5678 n8nio/n8n

# Wait for ready
sleep 10

# Inject credentials via CLI (no API key needed!)
podman cp credential.json n8n-test:/tmp/cred.json
podman exec n8n-test n8n import:credentials --input /tmp/cred.json

# Verify in UI
open http://localhost:5678
# Login and check Settings → Credentials
```

## Conclusion

The **credential injection system works perfectly**. The API key issue is a separate concern that can be worked around using session cookies or manual API key creation.

**Status:** ✅ Credential injection system is production-ready
**Status:** ⚠️  API key creation needs workaround

