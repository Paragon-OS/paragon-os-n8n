# n8n Credential Management

This document explains how credentials are managed in the test environment using the n8n CLI.

## Overview

The test system uses **n8n CLI commands** to inject credentials into containers with **exact IDs** that match the workflow JSON files. This is cleaner and more reliable than using the REST API.

## Why CLI Instead of REST API?

| Aspect | CLI Approach | REST API Approach |
|--------|-------------|-------------------|
| **ID Control** | ✅ Can specify exact IDs | ❌ n8n assigns random IDs |
| **Complexity** | ✅ Simple file + import | ❌ Session management needed |
| **Workflow Compatibility** | ✅ No workflow modification | ❌ Must update credential IDs |
| **Infrastructure** | ✅ Uses `execInContainer` | ✅ Already have API client |
| **Version Compatibility** | ✅ `import:credentials` is stable | ⚠️ API endpoints may vary |

## How It Works

### 1. Credential Definition

Credentials are defined in `src/utils/n8n-credentials.ts` with their exact IDs from the workflow files:

```typescript
export const TEST_CREDENTIALS: Record<string, CredentialDefinition> = {
  googleGemini: {
    id: 'NIhZoi9otQV2vaAP',  // Must match workflow JSON
    name: 'Google Gemini(PaLM) Api account',
    type: 'googlePalmApi',
    data: {
      apiKey: process.env.GOOGLE_GEMINI_API_KEY || '',
    },
  },
  // ... more credentials
};
```

### 2. Credential File Creation

The system creates n8n-compatible credential JSON files:

```json
{
  "id": "NIhZoi9otQV2vaAP",
  "name": "Google Gemini(PaLM) Api account",
  "type": "googlePalmApi",
  "data": {
    "apiKey": "your-api-key-here"
  },
  "createdAt": "2025-12-09T00:00:00.000Z",
  "updatedAt": "2025-12-09T00:00:00.000Z"
}
```

### 3. CLI Import

The credential file is copied into the container and imported using:

```bash
podman exec n8n-container n8n import:credentials --input /tmp/credential-xxx.json
```

This creates the credential with the **exact ID** specified in the file.

### 4. Workflow Compatibility

Since the credential IDs match exactly, workflows can be imported without modification:

```json
{
  "nodes": [
    {
      "credentials": {
        "googlePalmApi": {
          "id": "NIhZoi9otQV2vaAP",  // Matches imported credential
          "name": "Google Gemini(PaLM) Api account"
        }
      }
    }
  ]
}
```

## Required Credentials

### Essential Credentials (Core Workflows)

These are required for the main test workflows:

| Credential | ID | Type | Environment Variable | Used By |
|-----------|-----|------|---------------------|---------|
| **Google Gemini** | `NIhZoi9otQV2vaAP` | `googlePalmApi` | `GOOGLE_GEMINI_API_KEY` | Dynamic RAG, Smart Agents |
| **Redis** | `I9K02BUMIbHYp1nQ` | `redis` | `REDIS_HOST`, `REDIS_PORT` | Global Cache System |
| **Qdrant** | `ytBh4xOzWNQ347S5` | `qdrantApi` | `QDRANT_URL`, `QDRANT_API_KEY` | Dynamic RAG |
| **Qdrant Header Auth** | `S0nticGtHhYu1fe4` | `httpHeaderAuth` | `QDRANT_API_KEY` | Dynamic RAG |

### Optional Credentials (LAB Workflows)

These are only needed for experimental workflows:

| Credential | ID | Type | Environment Variable | Used By |
|-----------|-----|------|---------------------|---------|
| **Discord MCP** | `ZFofx3k2ze1wsifx` | `mcpClientApi` | `DISCORD_MCP_COMMAND` | Discord workflows |
| **Telegram MCP** | `aiYCclLDUqob5iQ0` | `mcpClientApi` | `TELEGRAM_MCP_COMMAND` | Telegram workflows |
| **Pinecone** | `AjwVKGbxaD6TrCuF` | `pineconeApi` | `PINECONE_API_KEY` | LAB: Pinecone Embeddings |
| **Anthropic** | `isyty1NtptrrMxOT` | `anthropicApi` | `ANTHROPIC_API_KEY` | LAB: Discord MCP Client |
| **Gmail** | `YTo91hCU5KquQMnX` | `gmailOAuth2` | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | LAB: Email Sender |
| **Ollama** | `ocz8JdQXZuMEnepT` | `ollamaApi` | `OLLAMA_BASE_URL` | LAB: Email Sender |

## Environment Variables

### Minimal Setup (Core Tests)

```bash
# Google Gemini (required for RAG)
export GOOGLE_GEMINI_API_KEY="your-gemini-api-key"

# Redis (auto-configured for localhost)
export REDIS_HOST="localhost"
export REDIS_PORT="6379"

# Qdrant (required for vector search)
export QDRANT_URL="https://your-qdrant-instance.cloud.qdrant.io:6333"
export QDRANT_API_KEY="your-qdrant-api-key"
```

### Full Setup (All Workflows)

```bash
# Essential
export GOOGLE_GEMINI_API_KEY="your-gemini-api-key"
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
export QDRANT_URL="https://your-qdrant-instance.cloud.qdrant.io:6333"
export QDRANT_API_KEY="your-qdrant-api-key"

# Optional (MCP Clients)
export DISCORD_MCP_COMMAND="node"
export DISCORD_MCP_ARGS="/path/to/discord-mcp/index.js"
export TELEGRAM_MCP_COMMAND="node"
export TELEGRAM_MCP_ARGS="/path/to/telegram-mcp/index.js"

# Optional (LAB workflows)
export PINECONE_API_KEY="your-pinecone-api-key"
export PINECONE_ENVIRONMENT="us-east-1-aws"
export ANTHROPIC_API_KEY="your-anthropic-api-key"
export GMAIL_CLIENT_ID="your-gmail-client-id"
export GMAIL_CLIENT_SECRET="your-gmail-client-secret"
export GMAIL_REFRESH_TOKEN="your-gmail-refresh-token"
export OLLAMA_BASE_URL="http://localhost:11434"
```

## Usage

### Automatic Setup (Integration Tests)

When you run integration tests, credentials are automatically injected:

```bash
npm run test:integration
```

The `startN8nInstance()` function in `n8n-podman.ts` automatically calls `setupN8nWithCredentials()` which:
1. Creates user and API key via HTTP
2. Checks if n8n CLI is available
3. Injects essential credentials via CLI

### Manual Setup

You can also manually setup credentials for a running container:

```typescript
import { setupEssentialCredentials, setupAllCredentials } from './utils/n8n-credentials';

// Setup only essential credentials
await setupEssentialCredentials('n8n-container-name', '/path/to/data-dir');

// Or setup all credentials (including optional)
await setupAllCredentials('n8n-container-name', '/path/to/data-dir');
```

### Setup Individual Credential

```typescript
import { setupCredential } from './utils/n8n-credentials';

await setupCredential('n8n-container-name', '/path/to/data-dir', 'googleGemini');
```

## Adding New Credentials

To add a new credential:

1. **Find the credential ID** in the workflow JSON:
   ```json
   "credentials": {
     "newCredentialType": {
       "id": "abc123xyz",
       "name": "New Credential"
     }
   }
   ```

2. **Add to `TEST_CREDENTIALS`** in `src/utils/n8n-credentials.ts`:
   ```typescript
   newCred: {
     id: 'abc123xyz',
     name: 'New Credential',
     type: 'newCredentialType',
     data: {
       apiKey: process.env.NEW_CRED_API_KEY || '',
     },
   },
   ```

3. **Add to `ESSENTIAL_CREDENTIALS`** if required for core workflows:
   ```typescript
   export const ESSENTIAL_CREDENTIALS = [
     'googleGemini',
     'redis',
     'qdrant',
     'qdrantHeaderAuth',
     'newCred',  // Add here
   ];
   ```

4. **Document the environment variable** in this README

5. **Set the environment variable** in your shell or CI/CD:
   ```bash
   export NEW_CRED_API_KEY="your-api-key"
   ```

## Troubleshooting

### Credential Import Fails

**Error**: `Credential import failed: n8n: command not found`

**Solution**: The n8n CLI is not available in the container. This shouldn't happen with official n8n images, but if it does:
- Check n8n version: `podman exec container n8n --version`
- Fall back to REST API approach (not implemented yet)

### Credential ID Mismatch

**Error**: Workflow fails with "Credential not found"

**Solution**: The credential ID in the workflow doesn't match the imported credential:
1. Check the workflow JSON for the credential ID
2. Update `TEST_CREDENTIALS` to use the correct ID
3. Re-run the setup

### Missing Environment Variable

**Warning**: `⚠️  Skipping Google Gemini(PaLM) Api account - no data available in environment`

**Solution**: Set the required environment variable:
```bash
export GOOGLE_GEMINI_API_KEY="your-api-key"
```

### Workflow Still Fails

If a workflow fails even after credential setup:
1. Check the logs: `podman logs n8n-container-name`
2. Verify credential was imported: Check n8n UI → Credentials
3. Test credential: Run a simple workflow using the credential
4. Check environment variables are correctly set

## CLI Availability

The system automatically checks if `n8n import:credentials` is available:

```typescript
const cliAvailable = await checkCliAvailability(containerName);
if (!cliAvailable) {
  logger.warn('n8n CLI not available, skipping credential setup');
}
```

If the CLI is not available, credentials won't be injected and workflows requiring them will fail.

## Security Notes

- **Never commit credentials** to version control
- **Use environment variables** for all sensitive data
- **Credential files are temporary** and cleaned up after import
- **Container isolation** ensures credentials don't leak between tests
- **API keys are masked** in logs (only first 10 characters shown)

## Future Improvements

- [ ] Fallback to REST API if CLI is unavailable
- [ ] Credential validation before import
- [ ] Encrypted credential storage
- [ ] Credential rotation support
- [ ] Bulk credential export/import

