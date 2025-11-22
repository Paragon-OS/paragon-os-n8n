#!/bin/bash
# Wrapper script for Supabase CLI that auto-configures Podman/Docker
# This script detects the container runtime and sets DOCKER_HOST appropriately

# Detect if Podman is available and configured
detect_podman() {
    if command -v podman &> /dev/null; then
        # Check if Podman socket exists (rootful mode - most common)
        if [ -S "/var/run/docker.sock" ]; then
            echo "podman-rootful"
            return 0
        fi
        # Check rootless Podman socket
        if [ -S "/run/user/$(id -u)/podman/podman.sock" ]; then
            echo "podman-rootless"
            return 0
        fi
        # Check if podman machine is running
        if podman machine list 2>/dev/null | grep -q "running"; then
            echo "podman-machine"
            return 0
        fi
    fi
    echo "none"
}

# Setup environment for Podman
setup_podman_env() {
    local podman_type=$1
    
    case $podman_type in
        podman-rootful|podman-machine)
            export DOCKER_HOST="unix:///var/run/docker.sock"
            ;;
        podman-rootless)
            export DOCKER_HOST="unix:///run/user/$(id -u)/podman/podman.sock"
            ;;
    esac
}

# Main execution
CONTAINER_RUNTIME=$(detect_podman)

if [ "$CONTAINER_RUNTIME" != "none" ]; then
    setup_podman_env "$CONTAINER_RUNTIME"
    # Pass all arguments to supabase command
    exec supabase "$@"
else
    # No Podman detected, use Docker (default)
    exec supabase "$@"
fi

