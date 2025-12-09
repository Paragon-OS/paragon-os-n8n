# Integration Testing Guide

## Quick Start

```bash
# Run all integration tests
npm run test:integration

# Run specific test suite
npm run test:credentials      # Credential setup tests
npm run test:backup-restore   # Backup/restore tests
npm run test:simple           # Simple startup test

# Run with logging (output to /tmp/n8n-tests/)
npm run test:credentials:log
npm run test:backup-restore:log
npm run test:integration:log

# Watch mode (auto-rerun on changes)
npm run test:integration:watch

# Manual cleanup
npm run test:cleanup
```

## Test Suites

### 1. Credential Setup Tests (`test:credentials`)

Tests the CLI-based credential injection system.

**What it tests:**
- n8n instance starts with credentials
- n8n CLI is available
- Essential credentials are injected
- Credential IDs match workflow JSON
- Manual credential setup works

**Duration:** ~2-3 minutes

**Requirements:**
- Environment variables set (see `env.example`)
- Podman running

### 2. Backup/Restore Tests (`test:backup-restore`)

Tests workflow backup and restore functionality.

**What it tests:**
- Simple workflow backup/restore
- Workflows with references
- Complex workflow structures
- Workflow reference preservation

**Duration:** ~5-10 minutes

**Requirements:**
- Podman running
- Sufficient disk space for temp files

### 3. Simple Start Test (`test:simple`)

Quick smoke test to verify n8n starts correctly.

**What it tests:**
- Container starts
- n8n API is accessible
- API key authentication works

**Duration:** ~1 minute

**Requirements:**
- Podman running

## Using the Test Script

The `scripts/test-integration.sh` script provides enhanced test management:

```bash
# Direct usage
./scripts/test-integration.sh [test-name] [--watch] [--log]

# Examples
./scripts/test-integration.sh all              # Run all tests
./scripts/test-integration.sh credentials      # Run credential tests
./scripts/test-integration.sh backup          # Run backup tests
./scripts/test-integration.sh simple          # Run simple test
./scripts/test-integration.sh all --log       # Run with logging
./scripts/test-integration.sh all --watch     # Watch mode
```

### Test Names

- `all` - All integration tests
- `credentials` or `cred` - Credential setup tests
- `backup` or `backup-restore` - Backup/restore tests
- `simple` or `start` - Simple startup test

### Flags

- `--log` - Run in background with log file, tail output
- `--watch` - Watch mode (auto-rerun on changes)

## Log Files

When using `--log` or `:log` commands:

- **Location:** `/tmp/n8n-tests/`
- **Format:** `test_YYYYMMDD_HHMMSS.log`
- **Retention:** Last 10 log files kept
- **Viewing:** `tail -f /tmp/n8n-tests/test_*.log`

### Log File Contents

- Full vitest output
- Container startup logs
- Credential injection logs
- Test results
- Error messages

## Cleanup

### Automatic Cleanup

Tests automatically cleanup:
- After each test (`afterEach` hook)
- After all tests (`afterAll` hook)
- Before starting new tests (via `test:cleanup`)

### Manual Cleanup

If tests fail or hang:

```bash
# Cleanup everything
npm run test:cleanup

# Or manually
pkill -f 'vitest.*integration'
podman ps -q --filter 'name=n8n-test' | xargs podman stop
podman ps -aq --filter 'name=n8n-test' | xargs podman rm -f
```

### What Gets Cleaned Up

- Running vitest processes
- n8n test containers (stopped)
- n8n test containers (removed)
- Old log files (keeps last 10)

## Troubleshooting

### Port Already in Use

**Symptom:** Test fails with "port already in use"

**Solution:**
```bash
npm run test:cleanup
# Wait a few seconds
npm run test:credentials
```

### Container Won't Stop

**Symptom:** Cleanup hangs or fails

**Solution:**
```bash
# Force remove all test containers
podman rm -f $(podman ps -aq --filter 'name=n8n-test')
```

### Test Hangs

**Symptom:** Test runs forever

**Solution:**
1. Press Ctrl+C to stop
2. Run `npm run test:cleanup`
3. Check for zombie containers: `podman ps -a`
4. Re-run test

### Missing Credentials

**Symptom:** Tests fail with "credential not found"

**Solution:**
1. Check environment variables are set
2. See `env.example` for required variables
3. Verify API keys are valid
4. Check `docs/CREDENTIALS.md` for details

### CLI Not Available

**Symptom:** "n8n CLI not available"

**Solution:**
- This shouldn't happen with official n8n images
- Check n8n version: `podman run --rm n8nio/n8n:latest n8n --version`
- Update image: `podman pull n8nio/n8n:latest`

## Best Practices

### Running Tests

1. **Always cleanup first** (automatic with npm scripts)
2. **Use log mode for long tests** (`npm run test:integration:log`)
3. **Watch mode for development** (`npm run test:integration:watch`)
4. **Run specific tests** when debugging

### Development Workflow

```bash
# 1. Make changes to code
vim src/utils/n8n-credentials.ts

# 2. Run specific test with logging
npm run test:credentials:log

# 3. Check logs if needed
tail -100 /tmp/n8n-tests/test_*.log | less

# 4. Iterate
```

### CI/CD

For CI/CD pipelines:

```bash
# Run all tests with cleanup
npm run test:integration

# Or with logging for debugging
npm run test:integration:log
```

## Performance

### Test Duration

| Test Suite | Duration | Containers |
|-----------|----------|------------|
| Simple Start | ~1 min | 1 |
| Credentials | ~2-3 min | 1-5 |
| Backup/Restore | ~5-10 min | 3 |
| All Tests | ~10-15 min | 5-10 |

### Resource Usage

- **CPU:** Moderate (container startup)
- **Memory:** ~500MB per container
- **Disk:** ~1GB for images + temp files
- **Network:** Minimal (only for image pull)

## Environment Variables

See `env.example` for all variables. Essential ones:

```bash
# Required for credential tests
export GOOGLE_GEMINI_API_KEY="your-key"
export QDRANT_URL="https://your-instance.cloud.qdrant.io:6333"
export QDRANT_API_KEY="your-key"
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
```

## Advanced Usage

### Custom Test Timeout

```bash
# Set timeout via environment
TEST_TIMEOUT=600000 npm run test:credentials  # 10 minutes
```

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug npm run test:credentials
```

### Specific Test File

```bash
# Run custom test file
./scripts/test-integration.sh src/tests/integration/my-test.test.ts
```

### Parallel Testing

**Not recommended** - tests create containers on random ports but may conflict.

If needed:
```bash
# Run in separate terminals
npm run test:credentials &
npm run test:simple &
wait
```

## FAQ

**Q: Why do tests take so long?**
A: Container startup, n8n initialization, and DB migrations take time. First run is slower (image pull).

**Q: Can I run tests in parallel?**
A: Not recommended. Tests may conflict on ports or resources.

**Q: Do I need to cleanup manually?**
A: No, tests cleanup automatically. Manual cleanup only needed if tests crash.

**Q: Where are test logs?**
A: `/tmp/n8n-tests/` when using `:log` commands, otherwise stdout.

**Q: How do I debug a failing test?**
A: Use `:log` commands to save output, check logs in `/tmp/n8n-tests/`.

**Q: Can I use a different n8n version?**
A: Yes, modify `DEFAULT_N8N_VERSION` in `src/utils/n8n-podman.ts`.

## See Also

- [CREDENTIALS.md](CREDENTIALS.md) - Credential management
- [INTEGRATION_TESTS.md](INTEGRATION_TESTS.md) - Test architecture
- [CLI-CREDENTIAL-IMPLEMENTATION.md](CLI-CREDENTIAL-IMPLEMENTATION.md) - Implementation details

