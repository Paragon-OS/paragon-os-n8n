#!/bin/sh
# Custom entrypoint that sets up custom nodes before starting n8n
#
# Copies the full node package (with dependencies) from /opt to the n8n
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

# Copy the full package with dependencies to both locations
if [ -d /opt/n8n-custom-nodes/node_modules/n8n-nodes-paragon-os ]; then
    cp -r /opt/n8n-custom-nodes/node_modules/n8n-nodes-paragon-os /home/node/.n8n/nodes/node_modules/
    cp -r /opt/n8n-custom-nodes/node_modules/n8n-nodes-paragon-os /home/node/.n8n/.n8n/nodes/node_modules/
    echo "  Copied n8n-nodes-paragon-os package with dependencies"
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
echo "Package contents:"
ls -la /home/node/.n8n/.n8n/nodes/node_modules/n8n-nodes-paragon-os/

# Run n8n with all passed arguments
exec n8n "$@"
