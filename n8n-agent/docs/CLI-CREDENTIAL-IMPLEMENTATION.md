# CLI-Based Credential Injection Implementation

## Summary

We've successfully implemented a **CLI-based credential injection system** for n8n test containers. This approach uses `n8n import:credentials` to inject credentials with **exact IDs** that match the workflow JSON files, eliminating the need for workflow modification after import.

## Why CLI Instead of REST API?

### Previous Approach (REST API)
- ❌ n8n assigns random credential IDs
- ❌ Requires complex session management (login, cookies)
- ❌ Must update workflow JSON to match new credential IDs
- ❌ Error-prone and fragile

### New Approach (CLI)
- ✅ Can specify exact credential IDs
- ✅ Simple file creation + import
- ✅ No workflow modification needed
- ✅ Cleaner and more reliable
- ✅ Uses existing `execInContainer` infrastructure

## Implementation

### 1. Core Files Created

#### `src/utils/n8n-credentials.ts`
Main credential management module with:
- `TEST_CREDENTIALS` - All credential definitions with exact IDs
- `ESSENTIAL_CREDENTIALS` - List of required credentials
- `setupCredential()` - Setup single credential
- `setupEssentialCredentials()` - Setup all essential credentials
- `setupAllCredentials()` - Setup all credentials (including optional)
- `checkCliAvailability()` - Verify n8n CLI is available

**Key Features:**
- Reads credentials from environment variables
- Creates n8n-compatible credential JSON files
- Copies files into container
- Imports via `n8n import:credentials` CLI command
- Cleans up temporary files
- Provides detailed logging and error handling

#### `src/utils/n8n-setup.ts` (Updated)
Added new function:
- `setupN8nWithCredentials()` - Complete setup (user + API key + credentials)

**Integration:**
- Calls existing `setupN8nViaCliInContainer()` for user/API key
- Checks CLI availability
- Calls `setupEssentialCredentials()` to inject credentials
- Provides comprehensive error handling and logging

#### `src/utils/n8n-podman.ts` (Updated)
Modified `startN8nInstance()` to:
- Call `setupN8nWithCredentials()` instead of `setupN8nViaCliInContainer()`
- Automatically inject credentials during container startup
- No changes needed to test code

### 2. Documentation

#### `docs/CREDENTIALS.md`
Comprehensive guide covering:
- Why CLI approach is better
- How the system works
- Required vs optional credentials
- Environment variable setup
- Usage examples
- Troubleshooting
- Adding new credentials

#### `env.example`
Template environment file with:
- All credential environment variables
- Comments explaining each credential
- Grouping (essential vs optional)
- Setup instructions

#### `README.md` (Updated)
Added sections on:
- Credential configuration
- Integration test requirements
- Links to detailed documentation

### 3. Testing

#### `src/tests/integration/credential-setup.test.ts`
New test suite verifying:
- n8n instance starts with credentials
- n8n CLI is available
- Essential credentials are injected
- Credential IDs match expected values
- Manual credential setup works

## Credentials Supported

### Essential (Required for Core Tests)
1. **Google Gemini** (`NIhZoi9otQV2vaAP`) - Used by Dynamic RAG, Smart Agents
2. **Redis** (`I9K02BUMIbHYp1nQ`) - Used by Global Cache System
3. **Qdrant** (`ytBh4xOzWNQ347S5`) - Used by Dynamic RAG
4. **Qdrant Header Auth** (`S0nticGtHhYu1fe4`) - Used by Dynamic RAG

### Optional (LAB Workflows)
5. **Discord MCP** (`ZFofx3k2ze1wsifx`) - Discord workflows
6. **Telegram MCP** (`aiYCclLDUqob5iQ0`) - Telegram workflows
7. **Pinecone** (`AjwVKGbxaD6TrCuF`) - LAB: Pinecone Embeddings
8. **Anthropic** (`isyty1NtptrrMxOT`) - LAB: Discord MCP Client
9. **Gmail** (`YTo91hCU5KquQMnX`) - LAB: Email Sender
10. **Ollama** (`ocz8JdQXZuMEnepT`) - LAB: Email Sender

## How It Works

### Flow Diagram

```
startN8nInstance()
  ↓
setupN8nWithCredentials()
  ↓
  ├─→ setupN8nViaCliInContainer()  [User + API Key via HTTP]
  │     ↓
  │   ✅ User created, API key obtained
  │
  ├─→ checkCliAvailability()  [Verify n8n CLI]
  │     ↓
  │   ✅ n8n import:credentials available
  │
  └─→ setupEssentialCredentials()  [Inject credentials via CLI]
        ↓
        For each credential:
          ├─→ createCredentialFile()  [Create JSON file]
          ├─→ copyToContainer()  [Copy to container]
          ├─→ importCredentialViaCli()  [Import via CLI]
          └─→ cleanup temp files
        ↓
      ✅ Credentials ready with exact IDs
```

### Detailed Steps

1. **Start Container** (`n8n-podman.ts`)
   ```typescript
   const instance = await startN8nInstance({ timeout: 120000 });
   ```

2. **Setup User & API Key** (HTTP-based)
   - POST to `/rest/owner/setup` to create user
   - Login to get session cookie
   - Create API key via `/rest/api-keys`

3. **Check CLI Availability**
   ```bash
   podman exec container n8n --help
   # Check for "import:credentials" in output
   ```

4. **Create Credential Files**
   ```json
   {
     "id": "NIhZoi9otQV2vaAP",
     "name": "Google Gemini(PaLM) Api account",
     "type": "googlePalmApi",
     "data": { "apiKey": "..." },
     "createdAt": "2025-12-09T00:00:00.000Z",
     "updatedAt": "2025-12-09T00:00:00.000Z"
   }
   ```

5. **Copy to Container**
   ```bash
   podman cp credential.json container:/tmp/credential-xxx.json
   ```

6. **Import via CLI**
   ```bash
   podman exec container n8n import:credentials --input /tmp/credential-xxx.json
   ```

7. **Cleanup**
   - Remove temp file from container
   - Remove credential files from host

## Usage

### Automatic (Integration Tests)

Just run tests - credentials are automatically injected:

```bash
npm run test:integration
```

### Manual Setup

```typescript
import { setupEssentialCredentials } from './utils/n8n-credentials';

await setupEssentialCredentials('container-name', '/path/to/data-dir');
```

### Environment Variables

```bash
# Minimal setup
export GOOGLE_GEMINI_API_KEY="your-key"
export QDRANT_URL="https://your-instance.cloud.qdrant.io:6333"
export QDRANT_API_KEY="your-key"
export REDIS_HOST="localhost"
export REDIS_PORT="6379"

# Run tests
npm run test:integration
```

## Benefits

### 1. **ID Preservation**
Credentials have exact IDs matching workflow JSON:
```json
// Workflow JSON
"credentials": {
  "googlePalmApi": {
    "id": "NIhZoi9otQV2vaAP"  // ✅ Matches imported credential
  }
}
```

### 2. **No Workflow Modification**
Workflows can be imported as-is without updating credential references.

### 3. **Cleaner Code**
```typescript
// Old approach (REST API)
const cred = await createCredential(apiKey, data);  // Random ID
await updateWorkflow(workflowId, { credId: cred.id });  // Update workflow

// New approach (CLI)
await setupCredential('googleGemini');  // Uses exact ID from definition
// Workflow already has correct ID, no update needed
```

### 4. **Better Error Handling**
- Skips credentials with missing environment variables
- Provides detailed logging
- Continues on non-critical failures
- Clear error messages

### 5. **Extensibility**
Easy to add new credentials:
```typescript
// 1. Add to TEST_CREDENTIALS
newCred: {
  id: 'abc123',
  name: 'New Credential',
  type: 'newType',
  data: { apiKey: process.env.NEW_API_KEY || '' }
}

// 2. Add env var
export NEW_API_KEY="your-key"

// 3. Done! Automatically injected
```

## Comparison: Before vs After

### Before (REST API Approach)

```typescript
// Create credential via REST API
const response = await axios.post('/rest/credentials', {
  name: 'Google Gemini',
  type: 'googlePalmApi',
  data: { apiKey: process.env.GOOGLE_GEMINI_API_KEY }
}, {
  headers: { Cookie: sessionCookie }  // Need session management
});

const credId = response.data.id;  // Random ID assigned by n8n

// Update workflow to use new credential ID
const workflow = await getWorkflow(workflowId);
workflow.nodes.forEach(node => {
  if (node.credentials?.googlePalmApi) {
    node.credentials.googlePalmApi.id = credId;  // Update ID
  }
});
await updateWorkflow(workflowId, workflow);
```

**Problems:**
- ❌ Session management complexity
- ❌ Random credential IDs
- ❌ Must update workflow JSON
- ❌ Error-prone
- ❌ Fragile

### After (CLI Approach)

```typescript
// Setup credential via CLI
await setupCredential('container', '/data', 'googleGemini');

// That's it! Credential has exact ID from TEST_CREDENTIALS
// Workflow JSON already has matching ID, no update needed
```

**Benefits:**
- ✅ No session management
- ✅ Exact credential IDs
- ✅ No workflow modification
- ✅ Reliable
- ✅ Simple

## Future Enhancements

### Potential Improvements

1. **Fallback to REST API**
   - If CLI not available, use REST API
   - Update workflow IDs automatically

2. **Credential Validation**
   - Test credentials before import
   - Verify API keys are valid

3. **Encrypted Storage**
   - Store credentials encrypted at rest
   - Decrypt only during import

4. **Credential Rotation**
   - Support automatic credential rotation
   - Update credentials without restart

5. **Bulk Operations**
   - Export all credentials
   - Import from backup

6. **Credential Templates**
   - Pre-defined credential sets
   - Quick setup for common scenarios

## Testing

### Run Credential Tests

```bash
npm run test:integration -- credential-setup
```

### Verify Credentials

```bash
# Start instance
const instance = await startN8nInstance();

# Check credentials via API
curl -H "X-N8N-API-KEY: $API_KEY" \
  http://localhost:5678/rest/credentials
```

### Debug Credential Import

```bash
# Check if CLI is available
podman exec container n8n --help

# Manually import credential
podman cp credential.json container:/tmp/cred.json
podman exec container n8n import:credentials --input /tmp/cred.json

# Verify in n8n UI
open http://localhost:5678
# Navigate to: Settings → Credentials
```

## Troubleshooting

### CLI Not Available

**Error**: `n8n: command not found`

**Solution**: 
- Verify n8n version supports CLI
- Check container has n8n binary
- Fall back to REST API (not implemented yet)

### Import Fails

**Error**: `Credential import failed`

**Solution**:
- Check credential JSON format
- Verify credential type is valid
- Check n8n logs: `podman logs container`

### Workflow Still Fails

**Error**: `Credential not found`

**Solution**:
- Verify credential ID matches workflow JSON
- Check credential was actually imported
- Verify environment variable is set

## Conclusion

The CLI-based credential injection system provides a **clean, reliable, and maintainable** way to manage credentials in test environments. It eliminates the complexity of REST API session management and ensures workflow compatibility by using exact credential IDs.

**Key Advantages:**
- ✅ Simple implementation
- ✅ Reliable operation
- ✅ No workflow modification
- ✅ Easy to extend
- ✅ Well documented
- ✅ Comprehensive testing

This approach is **production-ready** and can be used immediately for all integration tests.

