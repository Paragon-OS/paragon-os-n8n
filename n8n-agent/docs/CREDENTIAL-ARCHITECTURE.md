# Credential Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Integration Test Suite                       │
│                    (npm run test:integration)                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    startN8nInstance()                            │
│                   (n8n-podman.ts)                                │
│                                                                   │
│  1. Create container                                             │
│  2. Start n8n                                                    │
│  3. Wait for ready                                               │
│  4. Call setupN8nWithCredentials() ────────────────┐            │
└────────────────────────────────────────────────────┼────────────┘
                                                      │
                                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              setupN8nWithCredentials()                           │
│                  (n8n-setup.ts)                                  │
│                                                                   │
│  Step 1: Setup User & API Key (HTTP)                            │
│  ├─ POST /rest/owner/setup                                      │
│  ├─ Login to get session                                        │
│  └─ Create API key                                              │
│                                                                   │
│  Step 2: Check CLI Availability                                 │
│  └─ podman exec container n8n --help                            │
│                                                                   │
│  Step 3: Setup Credentials (CLI) ──────────────┐                │
└────────────────────────────────────────────────┼────────────────┘
                                                  │
                                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│           setupEssentialCredentials()                            │
│              (n8n-credentials.ts)                                │
│                                                                   │
│  For each essential credential:                                  │
│                                                                   │
│  1. Check environment variable                                   │
│     ├─ GOOGLE_GEMINI_API_KEY                                    │
│     ├─ QDRANT_URL, QDRANT_API_KEY                               │
│     └─ REDIS_HOST, REDIS_PORT                                   │
│                                                                   │
│  2. Create credential JSON file                                  │
│     {                                                             │
│       "id": "NIhZoi9otQV2vaAP",  ← Exact ID from workflow       │
│       "name": "Google Gemini...",                                │
│       "type": "googlePalmApi",                                   │
│       "data": { "apiKey": "..." }                                │
│     }                                                             │
│                                                                   │
│  3. Copy file to container                                       │
│     podman cp cred.json container:/tmp/cred.json                │
│                                                                   │
│  4. Import via CLI                                               │
│     podman exec container \                                      │
│       n8n import:credentials --input /tmp/cred.json             │
│                                                                   │
│  5. Cleanup temp files                                           │
│                                                                   │
│  Result: ✅ Credentials ready with exact IDs                    │
└─────────────────────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    n8n Container                                 │
│                                                                   │
│  Database: ~/.n8n/database.sqlite                               │
│  ├─ Users                                                        │
│  │  └─ test@n8n.test (with API key)                            │
│  │                                                               │
│  └─ Credentials                                                  │
│     ├─ NIhZoi9otQV2vaAP (Google Gemini)                        │
│     ├─ I9K02BUMIbHYp1nQ (Redis)                                 │
│     ├─ ytBh4xOzWNQ347S5 (Qdrant)                                │
│     └─ S0nticGtHhYu1fe4 (Qdrant Header Auth)                   │
│                                                                   │
│  Workflows can now use these credentials!                        │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Environment Variables → Credential Definitions

```
Environment                     TEST_CREDENTIALS
┌──────────────────────┐       ┌──────────────────────┐
│ GOOGLE_GEMINI_API_KEY│──────▶│ googleGemini: {      │
│ = "sk-abc123..."     │       │   id: "NIhZoi..."    │
└──────────────────────┘       │   type: "googlePalm" │
                               │   data: {            │
                               │     apiKey: env.var  │
                               │   }                  │
                               │ }                    │
                               └──────────────────────┘
```

### 2. Credential Definition → JSON File

```
TEST_CREDENTIALS              Credential File
┌──────────────────────┐     ┌──────────────────────┐
│ googleGemini: {      │     │ {                    │
│   id: "NIhZoi..."    │────▶│   "id": "NIhZoi..."  │
│   name: "Google..."  │     │   "name": "Google..."│
│   type: "googlePalm" │     │   "type": "google..."│
│   data: {...}        │     │   "data": {...}      │
│ }                    │     │ }                    │
└──────────────────────┘     └──────────────────────┘
                                       │
                                       ▼
                             /tmp/credential-xxx.json
```

### 3. JSON File → Container → n8n Database

```
Host                    Container                 n8n Database
┌──────────────┐       ┌──────────────┐         ┌──────────────┐
│ credential-  │       │ /tmp/cred-   │         │ credentials  │
│ NIhZoi.json  │──────▶│ xxx.json     │────────▶│ table        │
└──────────────┘       └──────────────┘         │              │
  podman cp              n8n import:creds        │ id: NIhZoi.. │
                                                 │ name: Google │
                                                 │ type: google │
                                                 │ data: {...}  │
                                                 └──────────────┘
```

### 4. Workflow → Credential Lookup

```
Workflow JSON                  n8n Database
┌──────────────────────┐      ┌──────────────────────┐
│ "credentials": {     │      │ SELECT * FROM        │
│   "googlePalmApi": { │      │ credentials          │
│     "id": "NIhZoi..."│─────▶│ WHERE id = "NIhZoi..."│
│   }                  │      │                      │
│ }                    │      │ ✅ Found! Use this   │
└──────────────────────┘      └──────────────────────┘
```

## Component Interaction

```
┌─────────────────────────────────────────────────────────────────┐
│                        Test Code                                 │
│                                                                   │
│  const instance = await startN8nInstance();                     │
│  // Credentials automatically available!                         │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ calls
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    n8n-podman.ts                                 │
│                                                                   │
│  • Container lifecycle management                                │
│  • Port allocation                                               │
│  • Volume mounting                                               │
│  • Calls setupN8nWithCredentials()                              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ calls
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    n8n-setup.ts                                  │
│                                                                   │
│  • User creation (HTTP)                                          │
│  • API key creation (HTTP)                                       │
│  • CLI availability check                                        │
│  • Calls setupEssentialCredentials()                            │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     │ calls
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                  n8n-credentials.ts                              │
│                                                                   │
│  • Credential definitions (TEST_CREDENTIALS)                     │
│  • Environment variable reading                                  │
│  • JSON file creation                                            │
│  • Container file operations                                     │
│  • CLI import execution                                          │
│  • Cleanup                                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Credential Lifecycle

```
1. DEFINE
   ├─ Credential added to TEST_CREDENTIALS
   ├─ Environment variable documented
   └─ Workflow JSON references credential ID

2. CONFIGURE
   ├─ User sets environment variable
   └─ export GOOGLE_GEMINI_API_KEY="..."

3. CREATE
   ├─ Test starts
   ├─ startN8nInstance() called
   └─ Credential JSON file created

4. INJECT
   ├─ File copied to container
   ├─ n8n import:credentials executed
   └─ Credential stored in database

5. USE
   ├─ Workflow imported
   ├─ Workflow references credential by ID
   └─ n8n finds credential in database

6. CLEANUP
   ├─ Test completes
   ├─ Container removed
   └─ Temp files deleted
```

## Error Handling Flow

```
setupEssentialCredentials()
  │
  ├─ For each credential:
  │   │
  │   ├─ Check environment variable
  │   │   ├─ ✅ Set → Continue
  │   │   └─ ❌ Not set → ⚠️  Skip with warning
  │   │
  │   ├─ Create credential file
  │   │   ├─ ✅ Success → Continue
  │   │   └─ ❌ Failed → ❌ Throw error
  │   │
  │   ├─ Copy to container
  │   │   ├─ ✅ Success → Continue
  │   │   └─ ❌ Failed → ❌ Throw error
  │   │
  │   ├─ Import via CLI
  │   │   ├─ ✅ Success → ✅ Credential ready
  │   │   └─ ❌ Failed → ❌ Throw error
  │   │
  │   └─ Cleanup temp files
  │       ├─ ✅ Success → Done
  │       └─ ❌ Failed → ⚠️  Log warning
  │
  └─ Summary
      ├─ All succeeded → ✅ Continue
      ├─ Some failed → ⚠️  Continue with warning
      └─ All failed → ❌ Throw error
```

## Comparison: CLI vs REST API

### CLI Approach (Current)

```
1. Create JSON file with exact ID
   {
     "id": "NIhZoi9otQV2vaAP",  ← Exact ID
     "name": "Google Gemini",
     "type": "googlePalmApi",
     "data": { "apiKey": "..." }
   }

2. Import via CLI
   n8n import:credentials --input file.json

3. Result
   ✅ Credential has exact ID
   ✅ Workflow JSON matches
   ✅ No modification needed
```

### REST API Approach (Old)

```
1. Create credential via API
   POST /rest/credentials
   {
     "name": "Google Gemini",
     "type": "googlePalmApi",
     "data": { "apiKey": "..." }
   }

2. Response
   {
     "id": "abc123xyz789",  ← Random ID
     ...
   }

3. Update workflow
   ❌ Must update workflow JSON
   ❌ Replace "NIhZoi9otQV2vaAP" with "abc123xyz789"
   ❌ Re-import workflow
```

## File Structure

```
n8n-agent/
├── src/
│   ├── utils/
│   │   ├── n8n-credentials.ts     ← Core credential logic
│   │   ├── n8n-setup.ts           ← Setup orchestration
│   │   └── n8n-podman.ts          ← Container management
│   │
│   └── tests/
│       └── integration/
│           └── credential-setup.test.ts  ← Tests
│
├── docs/
│   ├── CREDENTIALS.md             ← User guide
│   ├── CLI-CREDENTIAL-IMPLEMENTATION.md  ← Dev guide
│   └── CREDENTIAL-ARCHITECTURE.md ← This file
│
├── env.example                    ← Environment template
├── CHANGELOG-CREDENTIALS.md       ← Change log
└── README.md                      ← Updated with cred info
```

## Security Model

```
┌─────────────────────────────────────────────────────────────────┐
│                     Environment Variables                        │
│                    (User's shell/CI/CD)                          │
│                                                                   │
│  GOOGLE_GEMINI_API_KEY="sk-abc123..."                           │
│  QDRANT_API_KEY="xyz789..."                                     │
└────────────────────┬────────────────────────────────────────────┘
                     │ Read at runtime
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                  TEST_CREDENTIALS Object                         │
│                    (In-memory only)                              │
│                                                                   │
│  { id: "...", data: { apiKey: process.env.XXX } }              │
└────────────────────┬────────────────────────────────────────────┘
                     │ Create temp file
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Temporary JSON File                             │
│              (Deleted after import)                              │
│                                                                   │
│  /tmp/.n8n-credentials/credential-xxx.json                      │
└────────────────────┬────────────────────────────────────────────┘
                     │ Copy to container
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Container Temp File                             │
│              (Deleted after import)                              │
│                                                                   │
│  /tmp/credential-xxx.json                                        │
└────────────────────┬────────────────────────────────────────────┘
                     │ Import to database
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                  n8n Database                                    │
│              (Container volume)                                  │
│              (Destroyed with container)                          │
│                                                                   │
│  ~/.n8n/database.sqlite                                         │
└─────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. CLI over REST API
**Reason**: Exact ID control, simpler code, no session management

### 2. Environment Variables
**Reason**: Standard practice, CI/CD friendly, secure

### 3. Essential vs Optional
**Reason**: Fast startup, skip unavailable credentials

### 4. Automatic Injection
**Reason**: Developer convenience, consistent setup

### 5. Comprehensive Logging
**Reason**: Easy debugging, clear progress tracking

## Performance Characteristics

```
startN8nInstance() Timeline
├─ 0s:   Start container
├─ 5s:   Wait for n8n ready
├─ 10s:  Create user & API key
├─ 12s:  Check CLI availability
├─ 13s:  Setup credential 1 (Gemini)
├─ 15s:  Setup credential 2 (Redis)
├─ 17s:  Setup credential 3 (Qdrant)
├─ 19s:  Setup credential 4 (Qdrant Auth)
└─ 20s:  ✅ Ready for tests

Total: ~20 seconds
```

## Extensibility

### Adding New Credential

```
1. Define in TEST_CREDENTIALS
   ┌──────────────────────────┐
   │ newCred: {               │
   │   id: "abc123",          │
   │   name: "New Cred",      │
   │   type: "newType",       │
   │   data: {                │
   │     apiKey: process.env  │
   │   }                      │
   │ }                        │
   └──────────────────────────┘

2. Add to ESSENTIAL_CREDENTIALS (if required)
   ┌──────────────────────────┐
   │ export const ESSENTIAL = │
   │   ['googleGemini',       │
   │    'redis',              │
   │    'newCred']  ← Add here│
   └──────────────────────────┘

3. Document environment variable
   ┌──────────────────────────┐
   │ # New Credential         │
   │ export NEW_CRED_API_KEY= │
   │   "your-key"             │
   └──────────────────────────┘

4. Done! Automatically injected
```

## Conclusion

This architecture provides a **clean, maintainable, and scalable** solution for credential management in test environments. The CLI-based approach eliminates complexity while providing exact ID control, making it the ideal choice for n8n workflow testing.

