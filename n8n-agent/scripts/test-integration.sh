#!/bin/bash
# Integration Test Runner with Cleanup, Logging, and Timeout Protection
# 
# Features:
# - Automatic container cleanup before and after tests
# - Timeout protection to prevent hanging tests
# - Comprehensive container detection and removal
# - Test-specific timeout configuration
# 
# Usage: ./scripts/test-integration.sh [test-name] [--watch] [--log]
# 
# Test names:
#   all, credentials, backup, simple
# 
# Options:
#   --watch  Run in watch mode (no timeout, user controls stop)
#   --log    Run in background with log tailing
#
# Timeouts (applied automatically):
#   - Simple tests: 3 minutes
#   - Credential tests: 5 minutes
#   - Backup/restore tests: 15 minutes
#   - Full suite: 15 minutes

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
LOG_DIR="/tmp/n8n-tests"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/test_${TIMESTAMP}.log"

# Parse arguments
TEST_NAME="${1:-all}"
WATCH_MODE=false
LOG_MODE=false

for arg in "$@"; do
  case $arg in
    --watch) WATCH_MODE=true ;;
    --log) LOG_MODE=true ;;
  esac
done

# Create log directory
mkdir -p "$LOG_DIR"

# Function to cleanup test containers
cleanup_containers() {
  echo -e "${YELLOW}🧹 Cleaning up test containers...${NC}"
  
  # Kill any running vitest processes
  pkill -f 'vitest.*integration' 2>/dev/null || true
  
  # Check for any running containers with n8n-test in the name
  local running_containers=$(podman ps -q --filter 'name=n8n-test' 2>/dev/null || true)
  if [ -n "$running_containers" ]; then
    echo -e "${BLUE}Found running containers: $running_containers${NC}"
    echo "$running_containers" | xargs -r podman stop 2>/dev/null || true
  fi
  
  # Check for any stopped containers with n8n-test in the name
  local stopped_containers=$(podman ps -aq --filter 'name=n8n-test' 2>/dev/null || true)
  if [ -n "$stopped_containers" ]; then
    echo -e "${BLUE}Found stopped containers: $stopped_containers${NC}"
    echo "$stopped_containers" | xargs -r podman rm -f 2>/dev/null || true
  fi
  
  # Also check for containers that might have been created by tests (with timestamp patterns)
  # This catches containers that might not match the exact 'n8n-test' filter
  local all_n8n_containers=$(podman ps -aq --format '{{.Names}}' 2>/dev/null | grep -E '^n8n-test-' || true)
  if [ -n "$all_n8n_containers" ]; then
    echo -e "${BLUE}Found additional n8n test containers, removing...${NC}"
    echo "$all_n8n_containers" | while read -r container; do
      podman stop "$container" 2>/dev/null || true
      podman rm -f "$container" 2>/dev/null || true
    done
  fi
  
  # Clean up old log files (keep last 10)
  ls -t "$LOG_DIR"/test_*.log 2>/dev/null | tail -n +11 | xargs -r rm -f 2>/dev/null || true
  
  echo -e "${GREEN}✅ Cleanup complete${NC}"
}

# Function to check for running containers before tests
check_containers_before_test() {
  local running=$(podman ps -q --filter 'name=n8n-test' 2>/dev/null || true)
  if [ -n "$running" ]; then
    echo -e "${YELLOW}⚠️  Warning: Found running containers before test start${NC}"
    echo -e "${BLUE}Running containers: $running${NC}"
    cleanup_containers
  fi
}

# Function to tail log file
tail_log() {
  local log_file="$1"
  echo -e "${BLUE}📋 Tailing log: $log_file${NC}"
  echo -e "${YELLOW}Press Ctrl+C to stop tailing (test continues in background)${NC}"
  tail -f "$log_file" 2>/dev/null || true
}

# Function to show test summary
show_summary() {
  local log_file="$1"
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}📊 Test Summary${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  if [ -f "$log_file" ]; then
    # Extract test results
    local test_files=$(grep "Test Files" "$log_file" 2>/dev/null | tail -1 || echo "")
    local tests=$(grep "Tests" "$log_file" 2>/dev/null | tail -1 || echo "")
    local duration=$(grep "Duration" "$log_file" 2>/dev/null | tail -1 || echo "")
    
    if [ -n "$test_files" ]; then
      echo -e "$test_files"
    fi
    if [ -n "$tests" ]; then
      echo -e "$tests"
    fi
    if [ -n "$duration" ]; then
      echo -e "$duration"
    fi
    
    # Show failed tests
    local failed=$(grep "FAIL " "$log_file" 2>/dev/null | head -10)
    if [ -n "$failed" ]; then
      echo ""
      echo -e "${RED}❌ Failed Tests:${NC}"
      echo "$failed"
    fi
    
    # Show passed tests
    local passed=$(grep "✓ " "$log_file" 2>/dev/null | tail -5)
    if [ -n "$passed" ]; then
      echo ""
      echo -e "${GREEN}✅ Recent Passed Tests:${NC}"
      echo "$passed"
    fi
  fi
  
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}📝 Full log: $log_file${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Cleanup before starting
cleanup_containers

# Double-check for containers before starting tests
check_containers_before_test

# Determine test path
case "$TEST_NAME" in
  all)
    TEST_PATH="src/tests/integration"
    ;;
  credentials|cred)
    TEST_PATH="src/tests/integration/credential-setup.test.ts"
    ;;
  backup|backup-restore)
    TEST_PATH="src/tests/integration/backup-restore.test.ts"
    ;;
  simple|start)
    TEST_PATH="src/tests/integration/simple-start.test.ts"
    ;;
  *)
    TEST_PATH="$TEST_NAME"
    ;;
esac

echo -e "${GREEN}🚀 Starting integration tests...${NC}"
echo -e "${BLUE}Test: $TEST_PATH${NC}"
echo -e "${BLUE}Watch: $WATCH_MODE${NC}"
echo -e "${BLUE}Log: $LOG_MODE${NC}"
echo ""

# Function to run tests with timeout
run_tests_with_timeout() {
  local test_path="$1"
  local timeout_seconds="${2:-600}"  # Default 10 minutes
  local test_command="$3"
  
  echo -e "${BLUE}Running tests with ${timeout_seconds}s timeout...${NC}"
  
  # Use timeout command if available, otherwise rely on vitest's built-in timeout
  if command -v timeout >/dev/null 2>&1; then
    timeout "${timeout_seconds}s" $test_command "$test_path" || {
      local exit_code=$?
      if [ $exit_code -eq 124 ]; then
        echo -e "${RED}❌ Tests timed out after ${timeout_seconds}s${NC}"
        cleanup_containers
        exit 124
      fi
      return $exit_code
    }
  else
    # Fallback: run without timeout wrapper (vitest has built-in timeout)
    $test_command "$test_path" || {
      local exit_code=$?
      cleanup_containers
      return $exit_code
    }
  fi
}

# Run tests
if [ "$WATCH_MODE" = true ]; then
  # Watch mode - no timeout (user controls when to stop)
  echo -e "${YELLOW}⚠️  Watch mode: No timeout applied. Press Ctrl+C to stop.${NC}"
  vitest watch "$TEST_PATH"
  TEST_EXIT_CODE=$?
  cleanup_containers
  exit $TEST_EXIT_CODE
elif [ "$LOG_MODE" = true ]; then
  # Log mode - run in background with timeout
  echo -e "${YELLOW}Running tests in background with timeout...${NC}"
  
  # Calculate timeout based on test type (longer for integration tests)
  local timeout_seconds=600  # 10 minutes default
  case "$TEST_NAME" in
    all|backup|backup-restore)
      timeout_seconds=900  # 15 minutes for full suite
      ;;
    credentials|cred)
      timeout_seconds=300  # 5 minutes for credential tests
      ;;
    simple|start)
      timeout_seconds=180  # 3 minutes for simple test
      ;;
  esac
  
  # Run with timeout wrapper
  (
    timeout "${timeout_seconds}s" vitest run "$TEST_PATH" > "$LOG_FILE" 2>&1
  ) &
  TEST_PID=$!
  
  # Wait a moment for test to start
  sleep 2
  
  # Tail the log
  tail_log "$LOG_FILE" &
  TAIL_PID=$!
  
  # Wait for test to complete or timeout
  wait $TEST_PID
  TEST_EXIT_CODE=$?
  
  # Stop tailing
  kill $TAIL_PID 2>/dev/null || true
  
  # Check if timeout occurred
  if [ $TEST_EXIT_CODE -eq 124 ]; then
    echo -e "${RED}❌ Tests timed out after ${timeout_seconds}s${NC}"
  fi
  
  # Show summary
  show_summary "$LOG_FILE"
  
  # Cleanup after test
  cleanup_containers
  
  exit $TEST_EXIT_CODE
else
  # Normal mode - run with timeout and show output
  # Calculate timeout based on test type
  timeout_seconds=600  # 10 minutes default
  case "$TEST_NAME" in
    all|backup|backup-restore)
      timeout_seconds=900  # 15 minutes for full suite
      ;;
    credentials|cred)
      timeout_seconds=300  # 5 minutes for credential tests
      ;;
    simple|start)
      timeout_seconds=180  # 3 minutes for simple test
      ;;
  esac
  
  if command -v timeout >/dev/null 2>&1; then
    timeout "${timeout_seconds}s" vitest run "$TEST_PATH" || {
      TEST_EXIT_CODE=$?
      if [ $TEST_EXIT_CODE -eq 124 ]; then
        echo -e "${RED}❌ Tests timed out after ${timeout_seconds}s${NC}"
      fi
      cleanup_containers
      exit $TEST_EXIT_CODE
    }
  else
    # Fallback: run without timeout wrapper (vitest has built-in timeout)
    vitest run "$TEST_PATH" || {
      TEST_EXIT_CODE=$?
      cleanup_containers
      exit $TEST_EXIT_CODE
    }
  fi
  
  TEST_EXIT_CODE=$?
  
  # Cleanup after test
  cleanup_containers
  
  exit $TEST_EXIT_CODE
fi

