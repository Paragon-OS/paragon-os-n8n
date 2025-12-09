# n8n Agent - Paragon OS

Workflow management and automation tools for n8n.

## 🚀 Quick Start

```bash
# Sync workflows
npm run n8n:workflows:downsync  # Export from n8n
npm run n8n:workflows:upsync    # Import to n8n

# Fix workflow issues
npm run n8n:db:fix              # Fix all issues
npm run n8n:db:check            # Check without fixing
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

### Database Fixes
```bash
npm run n8n:db:fix              # Fix all workflow reference issues
npm run n8n:db:check            # Check for issues (dry-run)
```

### Testing
```bash
npm test                        # Run tests
npm run test:watch              # Watch mode
npm run test:select             # Interactive selector
npm run test:integration        # Integration tests (requires podman)
```

**Note**: Integration tests automatically inject credentials via CLI. See [docs/CREDENTIALS.md](docs/CREDENTIALS.md) for setup.

---

## 🔧 Common Tasks

### After Importing Workflows
```bash
npm run n8n:workflows:upsync
npm run n8n:db:fix
# Restart n8n
```

### Troubleshooting "Workflow not found"
```bash
npm run n8n:db:fix
# Restart n8n
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
├── scripts/
│   ├── fix-workflow-references.py  # Main fix script
│   └── *.ts                    # Workflow utilities
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
```bash
npm run n8n:db:fix
# Restart n8n
```

**Check logs**
```bash
tail -100 ~/.n8n/n8nEventLog.log | grep -i error
```

---

## 📚 Documentation

- `scripts/README.md` - Script documentation
- `README-WORKFLOW-FIXES.md` - Detailed fix guide
- `docs/archive/` - Historical docs

---

## 🔒 Safety

All scripts are:
- ✅ Idempotent (safe to run multiple times)
- ✅ Non-destructive (only fix broken references)
- ✅ Smart (skip dynamic expressions)

Optional backup:
```bash
cp ~/.n8n/database.sqlite ~/.n8n/database.sqlite.backup
```

---

**Last Updated**: 2025-12-08
