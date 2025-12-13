# Custom n8n image with community nodes pre-installed
# Based on the official n8n image
#
# Nodes are installed from two sources:
# 1. npm registry (e.g., n8n-nodes-mcp)
# 2. Local source (n8n-nodes-paragon-os)
#
# All nodes are stored at /opt/n8n-custom-nodes and copied to ~/.n8n/nodes
# at runtime to survive volume mounts.

# ARG must be before FROM to be used in FROM statements
ARG N8N_VERSION=latest

# Stage 1: Install npm-based community nodes
FROM node:20-alpine AS community-builder
WORKDIR /build

# Copy package.json for npm-sourced community nodes
COPY community-nodes-package.json package.json

# Install community nodes (handles empty dependencies gracefully)
RUN npm install --omit=dev 2>/dev/null || mkdir -p node_modules

# Stage 2: Final n8n image
FROM n8nio/n8n:${N8N_VERSION}

# Switch to root to install packages
USER root

# Create a persistent location for custom nodes
RUN mkdir -p /opt/n8n-custom-nodes/node_modules

# Copy npm-installed community nodes from builder stage
COPY --from=community-builder --chown=node:node /build/node_modules /opt/n8n-custom-nodes/node_modules/

# Copy the locally-built n8n-nodes-paragon-os package
COPY --chown=node:node n8n-nodes-paragon-os /opt/n8n-custom-nodes/node_modules/n8n-nodes-paragon-os

# Copy the full nodes manifest as package.json (lists all nodes for n8n)
COPY --chown=node:node nodes-manifest.json /opt/n8n-custom-nodes/package.json

# Copy the node registration script (registers nodes in n8n database at startup)
COPY --chown=node:node register-nodes.js /opt/n8n-custom-nodes/register-nodes.js

# Install runtime dependencies for the paragon-os package
WORKDIR /opt/n8n-custom-nodes/node_modules/n8n-nodes-paragon-os
RUN npm install --omit=dev --ignore-scripts

# Set proper ownership for everything
RUN chown -R node:node /opt/n8n-custom-nodes

# Copy the startup script
COPY --chown=node:node docker-entrypoint.sh /opt/docker-entrypoint.sh
RUN chmod +x /opt/docker-entrypoint.sh

# Switch back to node user (same as original n8n image)
USER node

# Set working directory back to default
WORKDIR /home/node

# Use the custom entrypoint to set up nodes before starting n8n
ENTRYPOINT ["/opt/docker-entrypoint.sh"]

# Default command (same as original n8n image)
CMD ["start"]
