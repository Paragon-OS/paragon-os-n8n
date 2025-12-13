# n8n Agent - Paragon OS

Workflow management and automation tools for n8n.

## 🚀 Quick Start

```bash
# Sync workflows
npm run n8n:workflows:downsync  # Export from n8n
npm run n8n:workflows:upsync    # Import to n8n
```

---

## 📋 Commands

### Workflow Management
```bash
npm run n8n:workflows:downsync  # Export workflows from n8n
npm run n8n:workflows:upsync    # Import workflows to n8n
npm run n8n:workflows:tree      # Show workflow tree
npm run n8n:verify              # Verify workflows
```

### Testing
```bash
# Unit tests
npm test                        # Run all unit tests
npm run test:watch              # Watch mode
npm run test:select             # Interactive selector

# Integration tests (requires podman)
npm run test:integration        # All integration tests
npm run test:credentials        # Credential setup tests
npm run test:backup-restore     # Backup/restore tests
npm run test:simple             # Quick smoke test

# With logging (output to /tmp/n8n-tests/)
npm run test:credentials:log
npm run test:integration:log

# Cleanup
npm run test:cleanup            # Stop and remove test containers
```

**See**: [docs/TESTING.md](docs/TESTING.md) for detailed testing guide.

**Note**: Integration tests automatically inject credentials via CLI. See [docs/CREDENTIALS.md](docs/CREDENTIALS.md) for setup.

---

## 🔧 Common Tasks

### After Importing Workflows
```bash
npm run n8n:workflows:upsync
# Restart n8n if needed
```

### Daily Sync
```bash
npm run n8n:workflows:downsync
# Commit changes
```

---

## 📁 Structure

```
n8n-agent/
├── README.md                   # This file
├── scripts/                    # Utility scripts
├── src/                        # Source code
├── workflows/                  # Workflow JSON files
└── docs/                       # Documentation
```

---

## ⚙️ Configuration

### Basic Configuration

```bash
# Environment variables
export N8N_URL="http://localhost:5678"
export N8N_API_KEY="your-api-key"
```

Database: `~/.n8n/database.sqlite`

### Credential Configuration (for Testing)

The test system uses CLI-based credential injection. See [docs/CREDENTIALS.md](docs/CREDENTIALS.md) for details.

**Minimal setup** (required for core tests):
```bash
export GOOGLE_GEMINI_API_KEY="your-gemini-api-key"
export QDRANT_URL="https://your-qdrant-instance.cloud.qdrant.io:6333"
export QDRANT_API_KEY="your-qdrant-api-key"
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
```

**Full documentation**: [docs/CREDENTIALS.md](docs/CREDENTIALS.md)

---

## 🐛 Troubleshooting

**"Workflow does not exist"**
- Ensure workflow is imported: `npm run n8n:workflows:upsync`
- Restart n8n

**Check logs**
```bash
tail -100 ~/.n8n/n8nEventLog.log | grep -i error
```

---

## 📚 Documentation

- `docs/TESTING.md` - Testing guide
- `docs/CREDENTIALS.md` - Credential configuration

---

## 🔒 Safety

All sync operations are:
- ✅ Idempotent (safe to run multiple times)
- ✅ Non-destructive

---

**Last Updated**: 2025-12-14
