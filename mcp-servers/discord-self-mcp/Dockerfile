# Discord Self MCP Server - Container Image
# Supports both STDIO and SSE transport modes

FROM node:20-alpine

# Create app directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -S mcp && adduser -S mcp -G mcp

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built application
COPY dist/ ./dist/

# Change ownership to non-root user
RUN chown -R mcp:mcp /app

# Switch to non-root user
USER mcp

# Default port for SSE mode
EXPOSE 8000

# Environment variables
ENV NODE_ENV=production
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8000

# Default to SSE mode (can be overridden)
CMD ["node", "dist/index-sse.js"]
