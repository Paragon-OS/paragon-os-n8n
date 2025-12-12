# Custom n8n image with paragon-os nodes pre-installed
# Based on the official n8n image
#
# Custom nodes need the full package with node_modules for dependencies.
# We store the package at /opt/n8n-custom-nodes and copy to ~/.n8n/nodes
# at runtime to survive volume mounts.

ARG N8N_VERSION=latest
FROM n8nio/n8n:${N8N_VERSION}

# Switch to root to install packages
USER root

# Create a persistent location for custom nodes
RUN mkdir -p /opt/n8n-custom-nodes/node_modules

# Copy the full n8n-nodes-paragon-os package
COPY --chown=node:node n8n-nodes-paragon-os /opt/n8n-custom-nodes/node_modules/n8n-nodes-paragon-os

# Create package.json for n8n to recognize the custom nodes
RUN echo '{"name":"installed-nodes","private":true,"dependencies":{"n8n-nodes-paragon-os":"1.4.2"}}' > /opt/n8n-custom-nodes/package.json

# Install node dependencies for the custom package (minisearch, etc.)
WORKDIR /opt/n8n-custom-nodes/node_modules/n8n-nodes-paragon-os
RUN npm install --omit=dev --ignore-scripts

# Set proper ownership
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
