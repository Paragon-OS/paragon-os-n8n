#!/bin/sh
# Custom entrypoint that sets up custom nodes before starting n8n
#
# Copies all n8n-nodes-* packages (with dependencies) from /opt to the n8n
# user folder's nodes directory. This is done at runtime to survive volume mounts.
#
# IMPORTANT: When N8N_USER_FOLDER is set to /home/node/.n8n, n8n creates
# another .n8n subfolder inside for its config and nodes. So we need to copy to:
#   /home/node/.n8n/.n8n/nodes/node_modules/<package-name>/
#
# We copy to both locations to handle both cases:
# - /home/node/.n8n/nodes/ (when N8N_USER_FOLDER is not set)
# - /home/node/.n8n/.n8n/nodes/ (when N8N_USER_FOLDER=/home/node/.n8n)

set -e

echo "Setting up custom nodes..."

# Create node directories for both possible locations
mkdir -p /home/node/.n8n/nodes/node_modules
mkdir -p /home/node/.n8n/.n8n/nodes/node_modules

# Copy ALL packages from /opt/n8n-custom-nodes/node_modules/ (including dependencies)
if [ -d /opt/n8n-custom-nodes/node_modules ]; then
    # Copy entire node_modules (includes n8n-nodes-* and their dependencies)
    cp -r /opt/n8n-custom-nodes/node_modules/* /home/node/.n8n/nodes/node_modules/
    cp -r /opt/n8n-custom-nodes/node_modules/* /home/node/.n8n/.n8n/nodes/node_modules/

    # List the n8n-nodes packages that were copied
    for pkg in /opt/n8n-custom-nodes/node_modules/n8n-nodes-*; do
        if [ -d "$pkg" ]; then
            echo "  Copied $(basename "$pkg")"
        fi
    done
else
    echo "  Warning: No custom nodes directory found at /opt/n8n-custom-nodes/node_modules"
fi

# Copy package.json to both locations
if [ -f /opt/n8n-custom-nodes/package.json ]; then
    cp /opt/n8n-custom-nodes/package.json /home/node/.n8n/nodes/
    cp /opt/n8n-custom-nodes/package.json /home/node/.n8n/.n8n/nodes/
    echo "  Copied package.json"
fi

echo "Custom nodes installed to:"
echo "  - /home/node/.n8n/nodes"
echo "  - /home/node/.n8n/.n8n/nodes"
echo "Installed packages:"
ls -1 /home/node/.n8n/.n8n/nodes/node_modules/ 2>/dev/null | grep "^n8n-nodes-" || echo "  (none)"

# Register community nodes in the n8n database (runs in background)
# This is required because n8n needs packages registered in the database
# to recognize them, not just installed in the filesystem.
# On first run, the database doesn't exist yet (n8n creates it during startup),
# so we run registration in the background with retries.
echo "Starting background node registration (will wait for database)..."
(
    MAX_RETRIES=30
    RETRY_INTERVAL=2

    for i in $(seq 1 $MAX_RETRIES); do
        sleep $RETRY_INTERVAL

        # Check if database exists
        if [ -f /home/node/.n8n/.n8n/database.sqlite ] || [ -f /home/node/.n8n/database.sqlite ]; then
            echo "[Background] Database found, attempting registration (attempt $i)..."
            if node /opt/n8n-custom-nodes/register-nodes.js 2>&1; then
                echo "[Background] Node registration completed successfully"
                exit 0
            fi
        fi
    done

    echo "[Background] Warning: Could not register nodes after $MAX_RETRIES attempts"
) &

# Run n8n with all passed arguments
exec n8n "$@"
