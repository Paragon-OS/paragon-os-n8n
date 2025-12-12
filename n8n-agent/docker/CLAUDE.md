# Docker Configuration

This directory contains the custom n8n Docker image configuration with `n8n-nodes-paragon-os` custom nodes pre-installed.

## Files

| File | Purpose |
|------|---------|
| `n8n-custom.Dockerfile` | Custom n8n image definition |
| `docker-entrypoint.sh` | Runtime entrypoint that copies custom nodes to survive volume mounts |
| `build-custom-image.sh` | Build script (or `npm run docker:build`) |
| `build-context/` | Staging directory for Docker build context |

## Building the Custom Image

```bash
./build-custom-image.sh    # Builds localhost/n8n-paragon-os:latest
npm run docker:build       # Same as above
```

**Build process:**
1. Builds `n8n-nodes-paragon-os` package from `../n8n-nodes/`
2. Removes TextManipulation node (ESM incompatibility with n8n's CommonJS)
3. Copies package with dependencies into Docker image at `/opt/n8n-custom-nodes/`
4. Runs `npm install --omit=dev` to install production dependencies (minisearch, etc.)
5. Installs custom entrypoint that copies nodes at container startup

## Critical Implementation Details

### N8N_USER_FOLDER Nesting Issue

**This is the most important thing to understand about custom node installation.**

When `N8N_USER_FOLDER=/home/node/.n8n` is set (which the test framework does), n8n creates a **nested** `.n8n` subfolder:

```
Container filesystem when N8N_USER_FOLDER=/home/node/.n8n:
/home/node/.n8n/
├── .n8n/                    <-- n8n creates this nested folder!
│   ├── config              <-- Config saved here
│   ├── database.sqlite     <-- Database here
│   └── nodes/              <-- Custom nodes expected HERE
│       └── node_modules/
└── nodes/                   <-- NOT here (common mistake)
```

The entrypoint script copies to **both** locations to handle this:
```sh
mkdir -p /home/node/.n8n/nodes/node_modules
mkdir -p /home/node/.n8n/.n8n/nodes/node_modules   # <-- Critical!
cp -r /opt/n8n-custom-nodes/... /home/node/.n8n/nodes/node_modules/
cp -r /opt/n8n-custom-nodes/... /home/node/.n8n/.n8n/nodes/node_modules/
```

### Why Runtime Copying is Necessary

Volume mounts (`-v host_path:/home/node/.n8n`) happen **after** the image is built but **before** the container starts. This means:
- Any files at `/home/node/.n8n/` in the image get hidden by the mount
- Custom nodes installed during build would be lost
- Solution: Store nodes at `/opt/n8n-custom-nodes/` (outside mount) and copy at runtime

### Custom Node Dependencies

Custom nodes **must** include their `node_modules/` dependencies. The `n8n-nodes-paragon-os` package requires:
- `minisearch` - for FuzzySearch node
- `lodash` - for data manipulation
- `string-strip-html` - for text processing
- `iconv-lite` - for character encoding

Copying only `dist/` without dependencies causes: `Error: Cannot find module 'minisearch'`

### Package Structure for n8n Custom Nodes

n8n expects this exact structure in `~/.n8n/nodes/`:
```
~/.n8n/nodes/
├── package.json                           # {"dependencies": {"n8n-nodes-paragon-os": "1.4.2"}}
└── node_modules/
    └── n8n-nodes-paragon-os/
        ├── package.json                   # Must have "n8n" section with nodes array
        ├── dist/
        │   └── nodes/
        │       ├── FuzzySearch/
        │       │   └── FuzzySearch.node.js
        │       └── JsonDocumentLoader/
        │           └── JsonDocumentLoader.node.js
        └── node_modules/                  # Runtime dependencies
            ├── minisearch/
            ├── lodash/
            └── ...
```

## Debugging Custom Node Issues

### "Unrecognized node type: n8n-nodes-paragon-os.fuzzySearch"

This means n8n didn't find/load the custom node. Debug checklist:

1. **Check nodes are in correct directory** (accounting for N8N_USER_FOLDER nesting):
   ```bash
   podman exec <container> ls -la /home/node/.n8n/.n8n/nodes/node_modules/
   ```

2. **Check package.json has valid n8n.nodes array**:
   ```bash
   podman exec <container> cat /home/node/.n8n/.n8n/nodes/node_modules/n8n-nodes-paragon-os/package.json
   ```
   Verify paths in `n8n.nodes` point to existing `.node.js` files

3. **Check dependencies are installed**:
   ```bash
   podman exec <container> ls /home/node/.n8n/.n8n/nodes/node_modules/n8n-nodes-paragon-os/node_modules/
   ```

4. **Check for ESM/CommonJS issues** - n8n uses CommonJS. Any node using ESM-only imports will fail silently.

### "Cannot find module 'X'" Error

The node's runtime dependencies aren't installed:
```bash
# Check if dependency exists
podman exec <container> ls /home/node/.n8n/.n8n/nodes/node_modules/n8n-nodes-paragon-os/node_modules/

# If missing, rebuild the image
./build-custom-image.sh
```

### Verifying Custom Nodes Load

```bash
# Start container with debug logging
podman run -d --name n8n-debug -p 5678:5678 \
  -e N8N_LOG_LEVEL=debug \
  localhost/n8n-paragon-os:latest

# Check for node loading messages
podman logs n8n-debug 2>&1 | grep -i "loaded.*nodes\|paragon\|fuzzy"

# Should see: "Loaded all credentials and nodes from n8n-nodes-paragon-os"
```

### Check Entrypoint Ran

Look for these messages in container logs:
```
Setting up custom nodes...
  Copied n8n-nodes-paragon-os package with dependencies
  Copied package.json
Custom nodes installed to:
  - /home/node/.n8n/nodes
  - /home/node/.n8n/.n8n/nodes
```

## Test Framework Integration

The test framework automatically uses this custom image:

```typescript
// src/utils/test-helpers.ts
export const DEFAULT_N8N_CUSTOM_IMAGE = 'localhost/n8n-paragon-os:latest';
```

Container startup in `src/utils/n8n-podman.ts`:
```typescript
const containerArgs = [
  'run', '-d',
  '--name', containerName,
  '-p', `${port}:5678`,
  '-v', `${dataDir}:/home/node/.n8n`,  // Volume mount
  '-e', 'N8N_USER_FOLDER=/home/node/.n8n',
  imageName,
];
```

## Troubleshooting Checklist

When custom nodes don't work:

1. **Image exists?**
   ```bash
   podman images | grep n8n-paragon-os
   ```

2. **Rebuild image:**
   ```bash
   ./docker/build-custom-image.sh
   ```

3. **Entrypoint ran?**
   ```bash
   podman logs <container> | head -20
   ```

4. **Node directories populated?**
   ```bash
   podman exec <container> ls -la /home/node/.n8n/.n8n/nodes/node_modules/
   ```

5. **package.json correct?**
   ```bash
   podman exec <container> cat /home/node/.n8n/.n8n/nodes/node_modules/n8n-nodes-paragon-os/package.json | grep -A5 '"n8n"'
   ```

6. **No deleted nodes referenced?**
   Check that `n8n.nodes` array in package.json doesn't reference removed files (like TextManipulation)
