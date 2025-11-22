#!/bin/bash
# Setup script for Supabase local development
# This script checks for Supabase CLI and initializes the project
# Supports both Docker and Podman

set -e

# Detect container runtime (Docker or Podman)
detect_container_runtime() {
    # Check for Podman socket (rootful - most common)
    if [ -S "/var/run/docker.sock" ] && command -v podman &> /dev/null; then
        # Verify it's Podman by checking podman info
        if DOCKER_HOST="unix:///var/run/docker.sock" podman info &> /dev/null 2>&1; then
            echo "podman"
            return 0
        fi
    fi
    
    # Check for rootless Podman socket
    if [ -S "/run/user/$(id -u)/podman/podman.sock" ]; then
        echo "podman"
        return 0
    fi
    
    # Check if Docker is available and running
    if command -v docker &> /dev/null && docker info &> /dev/null 2>&1; then
        echo "docker"
        return 0
    fi
    
    # Check if Podman machine is running
    if command -v podman &> /dev/null && podman machine list 2>/dev/null | grep -q "running"; then
        echo "podman"
        return 0
    fi
    
    echo "none"
}

# Configure environment for Podman
setup_podman() {
    echo "🐋 Detected Podman as container runtime"
    
    # Check for rootful Podman socket (most common for Podman Machine)
    if [ -S "/var/run/docker.sock" ]; then
        export DOCKER_HOST="unix:///var/run/docker.sock"
        echo "✅ Configured DOCKER_HOST=$DOCKER_HOST (rootful Podman)"
        
        # Verify Podman is accessible
        if DOCKER_HOST="unix:///var/run/docker.sock" podman info &> /dev/null 2>&1; then
            echo "✅ Podman is accessible and ready"
            return 0
        fi
    fi
    
    # Check for rootless Podman socket
    if [ -S "/run/user/$(id -u)/podman/podman.sock" ]; then
        export DOCKER_HOST="unix:///run/user/$(id -u)/podman/podman.sock"
        echo "✅ Configured DOCKER_HOST=$DOCKER_HOST (rootless Podman)"
        return 0
    fi
    
    # Try Podman Machine
    if podman machine list 2>/dev/null | grep -q "running"; then
        export DOCKER_HOST="unix:///var/run/docker.sock"
        echo "✅ Configured DOCKER_HOST=$DOCKER_HOST (Podman Machine)"
        return 0
    fi
    
    echo "⚠️  Could not find Podman socket automatically"
    echo "   Defaulting to rootful Podman socket: /var/run/docker.sock"
    export DOCKER_HOST="unix:///var/run/docker.sock"
    echo "   Using DOCKER_HOST=$DOCKER_HOST"
    echo ""
    echo "💡 If this doesn't work, ensure Podman Machine is running:"
    echo "   podman machine start"
    echo ""
}

# Setup Docker (default)
setup_docker() {
    echo "🐳 Detected Docker as container runtime"
    
    if docker info &> /dev/null; then
        echo "✅ Docker is running"
        return 0
    else
        echo "❌ Docker is not running"
        echo ""
        echo "Please start Docker Desktop or Docker daemon"
        exit 1
    fi
}

# Main container runtime setup
CONTAINER_RUNTIME=$(detect_container_runtime)

case $CONTAINER_RUNTIME in
    podman)
        setup_podman
        ;;
    docker)
        setup_docker
        ;;
    none)
        echo "⚠️  No container runtime detected"
        echo ""
        echo "Checking if Supabase is already running..."
        # Try to continue anyway - Supabase might be running externally
        ;;
esac

echo ""
echo "🔍 Checking for Supabase CLI..."

if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found"
    echo ""
    echo "📦 Installing Supabase CLI..."
    echo ""
    echo "Choose installation method:"
    echo "  1) npm (recommended)"
    echo "  2) Homebrew (macOS/Linux)"
    echo "  3) Skip installation"
    echo ""
    read -p "Enter choice [1-3]: " choice

    case $choice in
        1)
            npm install -g supabase
            ;;
        2)
            brew install supabase/tap/supabase
            ;;
        3)
            echo "⏭️  Skipping installation"
            echo "Please install Supabase CLI manually:"
            echo "  npm install -g supabase"
            echo "  or"
            echo "  brew install supabase/tap/supabase"
            exit 1
            ;;
        *)
            echo "Invalid choice"
            exit 1
            ;;
    esac
fi

echo "✅ Supabase CLI found: $(supabase --version)"

# Use wrapper script for Supabase commands to handle Podman/Docker
SUPABASE_CMD="bash scripts/supabase-wrapper.sh"

# Check if Supabase is already initialized
if [ -d "supabase" ] && [ -f "supabase/config.toml" ]; then
    echo "✅ Supabase already initialized"
else
    echo "🔧 Initializing Supabase..."
    # Use wrapper for init command too
    $SUPABASE_CMD init
fi

# Check if Supabase is running
if $SUPABASE_CMD status &> /dev/null; then
    echo "✅ Supabase is running"
    $SUPABASE_CMD status
else
    echo "🚀 Starting Supabase..."
    
    # Start Supabase and capture output
    if $SUPABASE_CMD start 2>&1; then
        echo ""
        echo "📋 Supabase Configuration:"
        echo ""
        $SUPABASE_CMD status

        echo ""
        echo "💡 Add these to your .env.local file:"
        echo ""
        $SUPABASE_CMD status | grep -E "(API URL|anon key)" | sed 's/^/   /'
        echo ""
    else
        echo ""
        echo "⚠️  Supabase start encountered some issues"
        echo ""
        echo "Checking status..."
        if $SUPABASE_CMD status &> /dev/null; then
            echo "✅ Supabase appears to be running despite warnings"
            $SUPABASE_CMD status
        else
            echo "❌ Supabase failed to start"
            echo ""
            echo "Common issues:"
            echo "  1. Ports may be in use - check: lsof -i :54321 -i :54322 -i :54323"
            echo "  2. Container runtime issues - ensure Podman/Docker is running"
            echo "  3. Try running with debug: $SUPABASE_CMD start --debug"
            echo ""
            echo "Note: Analytics is disabled in config.toml for Podman compatibility"
            exit 1
        fi
    fi
fi

if [ "$CONTAINER_RUNTIME" = "podman" ]; then
    echo ""
    echo "💡 Note: Using Podman via DOCKER_HOST=$DOCKER_HOST"
    echo "   All Supabase commands will use this configuration automatically"
    echo ""
    echo "   Analytics is disabled in config.toml for Podman compatibility"
    echo "   (Vector service has permission issues with Podman socket)"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Copy the API URL and anon key to .env.local"
echo "  2. Migrations will be automatically applied on startup"
echo "  3. Access Supabase Studio at http://localhost:54323"

