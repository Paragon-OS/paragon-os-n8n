# Quick Start: Integration Testing

## 🚀 TL;DR

```bash
# 1. Set environment variables
export GOOGLE_GEMINI_API_KEY="your-key"
export QDRANT_URL="https://your-instance.cloud.qdrant.io:6333"
export QDRANT_API_KEY="your-key"

# 2. Run tests
npm run test:credentials        # Fast (~2 min)
npm run test:simple             # Faster (~1 min)
npm run test:integration        # All tests (~10 min)
```

## 📋 Available Commands

### Quick Tests
```bash
npm run test:simple             # Smoke test (1 min)
npm run test:credentials        # Credential tests (2 min)
npm run test:backup-restore     # Backup tests (5 min)
```

### With Logging
```bash
npm run test:credentials:log    # Save to /tmp/n8n-tests/
npm run test:integration:log    # All tests with logging
```

### Cleanup
```bash
npm run test:cleanup            # Stop & remove test containers
```

## 🔧 Setup

### 1. Install Podman

**macOS:**
```bash
brew install podman
podman machine init
podman machine start
```

**Linux:**
```bash
# Ubuntu/Debian
sudo apt install podman

# Fedora/RHEL
sudo dnf install podman
```

### 2. Set Environment Variables

Copy `env.example` and set values:

```bash
# Essential (required for tests)
export GOOGLE_GEMINI_API_KEY="your-gemini-key"
export QDRANT_URL="https://xxx.cloud.qdrant.io:6333"
export QDRANT_API_KEY="your-qdrant-key"
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
```

### 3. Run Tests

```bash
npm run test:credentials
```

## 📊 What Gets Tested

### Credential Setup Tests
- ✅ Container starts
- ✅ User & API key created
- ✅ Credentials injected via CLI
- ✅ Credential IDs match workflows
- ✅ API authentication works

### Backup/Restore Tests
- ✅ Workflows backup correctly
- ✅ Workflows restore correctly
- ✅ References preserved
- ✅ Complex structures handled

### Simple Start Test
- ✅ Container starts
- ✅ API accessible
- ✅ Authentication works

## 🐛 Troubleshooting

### Port Already in Use
```bash
npm run test:cleanup
```

### Test Hangs
```bash
# Ctrl+C to stop
npm run test:cleanup
# Try again
npm run test:credentials
```

### Missing Credentials
```bash
# Check environment
env | grep -E "(GEMINI|QDRANT|REDIS)"

# Set if missing
export GOOGLE_GEMINI_API_KEY="your-key"
```

### Container Won't Stop
```bash
# Force cleanup
podman rm -f $(podman ps -aq --filter 'name=n8n-test')
```

## 📝 Logs

### View Logs
```bash
# With :log commands
tail -f /tmp/n8n-tests/test_*.log

# Or use log mode
npm run test:credentials:log
```

### Log Location
- **Directory:** `/tmp/n8n-tests/`
- **Format:** `test_YYYYMMDD_HHMMSS.log`
- **Retention:** Last 10 files

## ⚡ Performance

| Test | Duration | Containers |
|------|----------|------------|
| Simple | ~1 min | 1 |
| Credentials | ~2 min | 1 |
| Backup/Restore | ~5 min | 3 |
| All | ~10 min | 5 |

## 🎯 Best Practices

1. **Always cleanup first** (automatic with npm scripts)
2. **Use `:log` for long tests**
3. **Run specific tests when debugging**
4. **Check logs if tests fail**

## 📚 More Info

- **Full Guide:** [docs/TESTING.md](TESTING.md)
- **Credentials:** [docs/CREDENTIALS.md](CREDENTIALS.md)
- **Architecture:** [docs/CLI-CREDENTIAL-IMPLEMENTATION.md](CLI-CREDENTIAL-IMPLEMENTATION.md)

## 🎉 Success Criteria

Tests pass when you see:

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

## 💡 Tips

- **First run is slower** (downloads Docker image)
- **Use `:log` to monitor progress** without blocking terminal
- **Cleanup automatically runs** before each test
- **Logs help debug** credential issues
- **Port conflicts?** Run `npm run test:cleanup`

## 🆘 Need Help?

1. Check [docs/TESTING.md](TESTING.md) for detailed guide
2. Check [docs/CREDENTIALS.md](CREDENTIALS.md) for credential setup
3. View logs: `tail -100 /tmp/n8n-tests/test_*.log`
4. Run cleanup: `npm run test:cleanup`
5. Check containers: `podman ps -a`

