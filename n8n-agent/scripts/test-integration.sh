#!/bin/bash
# Integration Test Runner with Cleanup and Logging
# Usage: ./scripts/test-integration.sh [test-name] [--watch] [--log]

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
  
  # Stop and remove all n8n-test containers
  local containers=$(podman ps -q --filter 'name=n8n-test' 2>/dev/null)
  if [ -n "$containers" ]; then
    echo -e "${BLUE}Stopping containers: $containers${NC}"
    echo "$containers" | xargs -r podman stop 2>/dev/null || true
  fi
  
  local all_containers=$(podman ps -aq --filter 'name=n8n-test' 2>/dev/null)
  if [ -n "$all_containers" ]; then
    echo -e "${BLUE}Removing containers: $all_containers${NC}"
    echo "$all_containers" | xargs -r podman rm -f 2>/dev/null || true
  fi
  
  # Clean up old log files (keep last 10)
  ls -t "$LOG_DIR"/test_*.log 2>/dev/null | tail -n +11 | xargs -r rm -f
  
  echo -e "${GREEN}✅ Cleanup complete${NC}"
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

# Run tests
if [ "$WATCH_MODE" = true ]; then
  # Watch mode - no logging
  vitest watch "$TEST_PATH"
elif [ "$LOG_MODE" = true ]; then
  # Log mode - run in background and tail
  echo -e "${YELLOW}Running tests in background...${NC}"
  vitest run "$TEST_PATH" > "$LOG_FILE" 2>&1 &
  TEST_PID=$!
  
  # Wait a moment for test to start
  sleep 2
  
  # Tail the log
  tail_log "$LOG_FILE" &
  TAIL_PID=$!
  
  # Wait for test to complete
  wait $TEST_PID
  TEST_EXIT_CODE=$?
  
  # Stop tailing
  kill $TAIL_PID 2>/dev/null || true
  
  # Show summary
  show_summary "$LOG_FILE"
  
  exit $TEST_EXIT_CODE
else
  # Normal mode - run and show output
  vitest run "$TEST_PATH"
  TEST_EXIT_CODE=$?
  
  # Cleanup after test
  cleanup_containers
  
  exit $TEST_EXIT_CODE
fi

