# Backup/Restore Integration Tests

## Overview

This document describes the integration test system for backup and restore operations. The system uses podman to create isolated n8n instances, ensuring clean, reproducible test environments.

**Performance Optimization (Dec 2024)**: Tests now use container reuse with state reset, reducing execution time by 65-77% (from 100-150s to 34-38s). See [Test Performance Optimization](#test-performance-optimization) section below.

## Architecture

### Components

1. **n8n-podman.ts** - Podman-based n8n instance manager
   - Creates isolated n8n containers
   - Manages container lifecycle
   - Handles port assignment and health checks
   - Provides cleanup utilities

2. **backup-restore-test.ts** - Test utilities
   - Creates test workflows
   - Runs backup/restore cycles
   - Verifies workflow matches
   - Validates workflow references
   - **State management**: `resetN8nState()`, `verifyN8nHealth()`, `clearAllWorkflows()`

3. **backup-restore.test.ts** - Integration test suite
   - Basic backup/restore tests
   - Reference validation tests
   - Multiple restore cycle tests
   - Complex workflow structure tests

## Requirements

- **podman** must be installed and running
- Sufficient disk space for temporary containers (~500MB per test)
- Network access to pull n8n Docker images

## Usage

### Run All Integration Tests

```bash
npm run test:integration
```

### Run Specific Test Suite

```bash
npm run test:backup-restore
```

### Watch Mode

```bash
npm run test:integration:watch
```

## Test Cases

### 1. Basic Backup/Restore
- Creates simple workflows
- Backs them up
- Restores them
- Verifies they match

### 2. Workflow References
- Creates workflows that reference each other
- Backs up and restores
- Verifies references are valid

### 3. Multiple Restore Cycles
- Tests restoring the same backup multiple times
- Verifies no duplicates are created

### 4. Empty Backup Restore
- Tests restoring an empty backup
- Verifies graceful handling

### 5. Complex Workflow Structure
- Tests workflows with multiple nodes and connections
- Verifies structure is preserved

## How It Works

### Test Lifecycle (Optimized with Container Reuse)

1. **Before All Tests** (`beforeAll`)
   - Starts ONE n8n instance in podman (shared across all tests)
   - Waits for n8n to be ready (health check)
   - Sets up credentials (once)
   - **Time saved**: Eliminates 4 container startups (~80-120s)

2. **Before Each Test** (`beforeEach`)
   - Verifies container health (`verifyN8nHealth()`)
   - Resets n8n state (`resetN8nState()`) - clears workflows (~1-2s)
   - **Time saved**: State reset is 10-15x faster than container restart

3. **During Test**
   - Creates test workflows
   - Runs backup operation
   - Clears n8n instance (simulates fresh restore)
   - Runs restore operation
   - Verifies results

4. **After All Tests** (`afterAll`)
   - Stops and removes podman container (once)
   - Cleans up temporary files
   - Removes data directories

### Podman Instance Management

Each test gets:
- Unique container name (timestamp + random)
- Unique port (auto-assigned from 50000+)
- Isolated data directory
- Clean n8n database

### Error Handling

- Tests detect test mode (`VITEST=true` or `NODE_ENV=test`)
- Commands throw errors instead of exiting process
- Proper cleanup on failures
- Detailed error messages

## Troubleshooting

### Podman Not Available

```
Error: Podman is not available. Please install podman to run integration tests.
```

**Solution**: Install podman
- macOS: `brew install podman`
- Linux: Follow [podman installation guide](https://podman.io/getting-started/installation)

### Container Startup Timeout

```
Error: n8n failed to start within 120000ms
```

**Solution**: 
- Check podman logs: `podman logs <container-name>`
- Increase timeout in test configuration
- Check system resources (CPU, memory, disk)

### Port Already in Use

The system automatically finds available ports, but if you see port conflicts:
- Check for other n8n instances running
- Clean up old containers: `podman ps -a` and `podman rm <container-name>`

### Test Failures

Common issues:
1. **Workflow references broken**: Check if reference resolution is working
2. **ID mismatches**: Expected in non-preserve mode, but should be logged
3. **Duplicate workflows**: Check restore logic for name-based matching

## Configuration

### Environment Variables

- `N8N_BASE_URL` - Override n8n URL (automatically set per test)
- `VITEST` - Set to 'true' in test mode
- `NODE_ENV` - Set to 'test' in test mode

### Test Timeouts

Default: 10 minutes per test suite (all tests share one container)
- Can be adjusted in test file
- Container startup time only applies once (in `beforeAll`)

## Test Performance Optimization

### Container Reuse Pattern

**Implemented**: December 2024

**Problem**: Each test was creating a new container, taking 20-30s per test (100-150s total for 5 tests).

**Solution**: Container reuse with aggressive state reset:
- Start container once in `beforeAll`
- Reset state between tests in `beforeEach` (~1-2s)
- Clean up once in `afterAll`

**Results**:
- **Duration**: 100-150s → 34-38s (65-77% faster)
- **Container startups**: 5 → 1 (80% reduction)
- **All tests pass** with proper isolation

**Key Functions**:
- `resetN8nState(instance)` - Clears all workflows, verifies clean state
- `verifyN8nHealth(instance)` - Health check before each test
- `clearAllWorkflows(instance)` - Handles n8n's archive requirement for deletion

**Implementation Details**:
- See `src/tests/integration/backup-restore.test.ts` for reference pattern
- State reset handles archived workflows (n8n requires archiving before deletion)
- Health checks prevent tests from running on unhealthy containers
- Aggressive verification ensures no state leaks between tests

**For More Details**: See `TEST_OPTIMIZATION_SUMMARY.md` in project root.

## Future Enhancements

- [ ] ID preservation mode tests
- [ ] Database direct import tests
- [ ] Large workflow set tests (100+ workflows)
- [ ] Concurrent restore tests
- [ ] Performance benchmarks
- [ ] CI/CD integration

## See Also

- [Backup Command Refactor](./BACKUP_REFACTOR.md)
- [ID Preservation](./ID_PRESERVATION.md)
- [Workflow Reference Fixes](./README-WORKFLOW-FIXES.md)

