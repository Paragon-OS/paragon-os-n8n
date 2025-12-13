#!/bin/bash
# Build custom n8n image with community nodes from package.json
# - n8n-nodes-paragon-os is built from local source
# - Other nodes (e.g., n8n-nodes-mcp) are installed from npm
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
N8N_NODES_DIR="/Users/nipuna/Software/paragon-os/paragon-os-app/n8n-nodes"
BUILD_DIR="$SCRIPT_DIR/build-context"
NODES_MANIFEST="$SCRIPT_DIR/../resources/nodes/package.json"
N8N_VERSION="${N8N_VERSION:-latest}"
IMAGE_NAME="${IMAGE_NAME:-n8n-paragon-os}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# Check for jq dependency
if ! command -v jq &> /dev/null; then
    echo "ERROR: jq is required but not installed. Install with: brew install jq"
    exit 1
fi

echo "=== Building custom n8n image with community nodes ==="
echo "n8n version: $N8N_VERSION"
echo "Image: $IMAGE_NAME:$IMAGE_TAG"

# Step 1: Ensure n8n-nodes-paragon-os is built
echo ""
echo "Step 1: Building n8n-nodes-paragon-os package..."
cd "$N8N_NODES_DIR"
if [ ! -d "dist" ] || [ "$(find nodes -newer dist -type f 2>/dev/null | head -1)" ]; then
    echo "  Running npm run build..."
    npm run build
else
    echo "  dist/ is up to date, skipping build"
fi

# Step 1.5: Process community nodes manifest
echo ""
echo "Step 1.5: Processing community nodes manifest..."
if [ ! -f "$NODES_MANIFEST" ]; then
    echo "ERROR: Community nodes manifest not found at $NODES_MANIFEST"
    exit 1
fi

# Extract version info
PARAGON_VERSION=$(jq -r '.dependencies["n8n-nodes-paragon-os"] // "local"' "$NODES_MANIFEST")
echo "  n8n-nodes-paragon-os: $PARAGON_VERSION (building from source)"

# Count and list other community nodes
OTHER_DEPS_COUNT=$(jq '[.dependencies | to_entries[] | select(.key != "n8n-nodes-paragon-os")] | length' "$NODES_MANIFEST")
echo "  Other community nodes from npm: $OTHER_DEPS_COUNT"
if [ "$OTHER_DEPS_COUNT" -gt 0 ]; then
    jq -r '.dependencies | to_entries[] | select(.key != "n8n-nodes-paragon-os") | "    - \(.key)@\(.value)"' "$NODES_MANIFEST"
fi

# Step 2: Create build context directory
echo ""
echo "Step 2: Creating build context..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Copy Dockerfile, entrypoint script, and node registration script
cp "$SCRIPT_DIR/n8n-custom.Dockerfile" "$BUILD_DIR/Dockerfile"
cp "$SCRIPT_DIR/docker-entrypoint.sh" "$BUILD_DIR/docker-entrypoint.sh"
cp "$SCRIPT_DIR/register-nodes.js" "$BUILD_DIR/register-nodes.js"

# Copy n8n-nodes-paragon-os (excluding node_modules and dev files)
echo "  Copying n8n-nodes-paragon-os package..."
mkdir -p "$BUILD_DIR/n8n-nodes-paragon-os"
cp "$N8N_NODES_DIR/package.json" "$BUILD_DIR/n8n-nodes-paragon-os/"
cp "$N8N_NODES_DIR/package-lock.json" "$BUILD_DIR/n8n-nodes-paragon-os/" 2>/dev/null || true
cp "$N8N_NODES_DIR/index.js" "$BUILD_DIR/n8n-nodes-paragon-os/"
cp -r "$N8N_NODES_DIR/dist" "$BUILD_DIR/n8n-nodes-paragon-os/"

# Remove TextManipulation node (has ESM compatibility issues with n8n)
echo "  Removing TextManipulation node (ESM incompatible)..."
rm -rf "$BUILD_DIR/n8n-nodes-paragon-os/dist/nodes/TextManipulation"

# Update package.json to remove TextManipulation from node list
echo "  Updating package.json to exclude TextManipulation..."
sed -i.bak 's|"dist/nodes/TextManipulation/TextManipulation.node.js",||g' "$BUILD_DIR/n8n-nodes-paragon-os/package.json"
rm -f "$BUILD_DIR/n8n-nodes-paragon-os/package.json.bak"

# Create package.json for npm-based community nodes (excluding paragon-os)
echo "  Creating community-nodes-package.json for npm packages..."
jq '{name:"community-nodes",private:true,dependencies:(.dependencies | to_entries | map(select(.key != "n8n-nodes-paragon-os")) | from_entries)}' "$NODES_MANIFEST" > "$BUILD_DIR/community-nodes-package.json"

# Copy the full manifest as the final package.json for n8n
echo "  Copying nodes manifest..."
cp "$NODES_MANIFEST" "$BUILD_DIR/nodes-manifest.json"

# Step 3: Build the image
echo ""
echo "Step 3: Building Docker image..."
cd "$BUILD_DIR"
podman build \
    --build-arg N8N_VERSION="$N8N_VERSION" \
    -t "$IMAGE_NAME:$IMAGE_TAG" \
    -t "$IMAGE_NAME:$N8N_VERSION" \
    -f Dockerfile \
    .

echo ""
echo "=== Build complete ==="
echo "Image: $IMAGE_NAME:$IMAGE_TAG"
echo ""
echo "To test the image:"
echo "  podman run -it --rm -p 5678:5678 $IMAGE_NAME:$IMAGE_TAG"
