## n8n JSON Standards, Formats & Available Nodes

### 1. Concepts & Data Model

**Core ideas**

- **Workflows** are stored as JSON documents describing:
  - **Metadata**: id, name, tags, settings, version info.
  - **Nodes**: list of processing steps.
  - **Connections**: how nodes are wired.
- **Execution data** is a list of **items**, each shaped as:
  - `json`: main structured data.
  - `binary`: optional binary attachments (files, images, etc).
- **Credentials** are separate entities, referenced by name/id from nodes.

---

### 2. Workflow JSON Format

A typical exported workflow (simplified) looks like:

```json
{
  "id": "1",
  "name": "Example Workflow",
  "nodes": [
    {
      "id": "1",
      "name": "Start",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [260, 300]
    }
  ],
  "connections": {},
  "settings": {
    "executionTimeout": -1,
    "saveDataSuccessExecution": "all",
    "saveDataErrorExecution": "all"
  },
  "tags": [
    { "id": "1", "name": "demo" }
  ],
  "versionId": "uuid-or-hash",
  "meta": {
    "templateCredsSetupCompleted": true
  }
}
```

**Key top-level properties**

- **`id`**: Internal workflow id (string or number, often stringified).
- **`name`**: Human‑readable workflow name.
- **`nodes`**: Array of node definitions (see section 3).
- **`connections`**:
  - Object mapping from `"<sourceNodeName>"` to outputs, e.g.:

    ```json
    "connections": {
      "Start": {
        "main": [
          [
            {
              "node": "HTTP Request",
              "type": "main",
              "index": 0
            }
          ]
        ]
      }
    }
    ```

- **`settings`** (optional, per‑workflow runtime configuration), e.g.:
  - `saveDataSuccessExecution`: `"all" | "none" | "manual"`.
  - `saveDataErrorExecution`: `"all" | "none"`.
  - `executionTimeout`: in seconds, `-1` for no limit.
  - `callerPolicy`, `timezone`, `errorWorkflow` etc. (depends on n8n version).
- **`staticData`** (optional): Node‑level persisted data (e.g. caches) keyed by node name.
- **`pinData`** (optional): Hard‑coded items per node name for pinning data in the UI.
- **`tags`**: List of `{ id, name }` tags.
- **`versionId` / `meta` / other**: Additional metadata used by the editor and templates.

For reference: see [n8n Data Structure docs](https://docs.n8n.io/data/data-structure/) and [Built-in node types docs](https://docs.n8n.io/integrations/builtin/node-types/).

---

### 3. Node JSON Format (Inside a Workflow)

Each entry in `nodes` has the shape:

```json
{
  "id": "2",
  "name": "HTTP Request",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4,
  "position": [560, 300],
  "parameters": {
    "url": "https://api.example.com/users",
    "method": "GET",
    "authentication": "none",
    "jsonParameters": true,
    "options": {}
  },
  "credentials": {
    "httpBasicAuth": {
      "id": "12",
      "name": "Example Basic Auth"
    }
  }
}
```

**Common node fields**

- **`id`**: Unique per node in the workflow.
- **`name`**: Display name used in `connections`.
- **`type`**:
  - Built‑in nodes: `"n8n-nodes-base.<NodeName>"`.
  - Community/custom nodes: `"@scope/packageName.nodeName"` or similar.
- **`typeVersion`**: Node implementation version (integer).
- **`position`**: `[x, y]` canvas coordinates in the editor.
- **`parameters`**:
  - Node‑specific configuration.
  - Values may be:
    - **Literals**: strings, numbers, booleans, arrays, objects.
    - **Expressions**: strings beginning with `={{ ... }}` (see section 5).
- **`credentials`** (optional):
  - Maps credential type → `{ id, name }` reference.
  - Example:

    ```json
    "credentials": {
      "slackApi": {
        "id": "3",
        "name": "Team Slack Token"
      }
    }
    ```

- **`alwaysOutputData`**, **`continueOnFail`**, **`notes`**, **`notesInFlow`**, etc. (Optional UX/runtime flags depending on node and version.)

For node UI design and parameter behavior, see [Node UI design docs](https://docs.n8n.io/integrations/creating-nodes/plan/node-ui-design/).

---

### 4. Execution Data JSON Format

**Standard item shape**

```json
[
  {
    "json": {
      "id": 1,
      "name": "Alice",
      "createdAt": "2025-11-16T10:23:45.000Z"
    },
    "binary": {
      "avatar": {
        "data": "BASE64_STRING",
        "mimeType": "image/png",
        "fileExtension": "png",
        "fileName": "alice.png"
      }
    }
  }
]
```

- **`json`**:
  - Arbitrary JSON object.
  - Dates are typically ISO 8601 strings (e.g. `"2025-11-16T10:23:45.000Z"`).
- **`binary`**:
  - Per‑key binary data containers with:
    - `data`: Base64 encoded binary.
    - `mimeType`, `fileExtension`, `fileName`, and optionally `fileSize`, etc.

**Paired items**

- Many nodes support `pairedItem` metadata to track provenance between items (especially split/merge operations).
- This data is attached internally; you typically don’t need to manage it manually unless building custom nodes or manipulating executions outside n8n.

---

### 5. JSON Standards in Expressions & Parameters

**Expressions**

- Any string starting with `={{` and ending with `}}` is evaluated as a JavaScript‑like expression.
- Example:

  ```json
  "parameters": {
    "url": "={{ $json.baseUrl + '/users/' + $json.userId }}",
    "options": {
      "queryParametersUi": {
        "parameter": [
          {
            "name": "timestamp",
            "value": "={{ $now.toISOString() }}"
          }
        ]
      }
    }
  }
  ```

  - `{{ $json }}`: current item’s JSON data.
  - `{{ $now }}`: date helper (returns a Date object).
  - Other helpers: `$item`, `$items`, `$binary`, `$node`, `$workflow`, etc.

**Dates & timestamps**

- n8n’s guidelines:
  - Use **ISO 8601** strings for timestamps and dates.
  - When designing nodes or custom JSON, ensure your fields accept all valid ISO 8601 formats.

**JSON input methods in UIs**

- **Direct JSON**: Plain JSON string in a text field → parsed into an object.
- **Expression returning JSON**: Expression produces an object or array → used directly.

For recommendations on JSON‑heavy nodes (e.g. “Simplify Response” toggles), see [Node UI Design](https://docs.n8n.io/integrations/creating-nodes/plan/node-ui-design/).

---

### 6. Credentials JSON Format (Conceptual)

Credentials are stored as separate JSON entities and referenced by nodes.

**In a workflow export reference**

```json
"credentials": {
  "httpBasicAuth": {
    "id": "12",
    "name": "Example Basic Auth"
  }
}
```

**Credential entity (simplified conceptual shape)**

```json
{
  "id": "12",
  "name": "Example Basic Auth",
  "type": "httpBasicAuth",
  "data": {
    "user": "username",
    "password": "encrypted-or-obscured"
  },
  "nodesAccess": [
    {
      "nodeType": "n8n-nodes-base.httpRequest"
    }
  ]
}
```

- The exact storage and encryption format depends on deployment; sensitive fields are encrypted at rest and not meant to be edited by hand.
- Workflows should **only** reference credentials by id/name, not embed secrets directly.

For up‑to‑date credential docs, see [Credentials section](https://docs.n8n.io/credentials/) (structure and behavior may evolve).

---

### 7. Available Nodes (Catalog Overview)

The full set of nodes is large and continuously growing. This section summarizes **formats and categories** rather than duplicating the entire catalog.

#### 7.1 Core / Utility Nodes (Built‑in)

Some commonly used built‑in nodes (all with `type` prefix `n8n-nodes-base.`):

- **Trigger nodes**
  - `manualTrigger`
  - `cron`
  - `webhook`
  - `interval`
- **Logic & control**
  - `if` (If)
  - `switch` (Switch)
  - `merge` (Merge)
  - `splitInBatches`
  - `wait`
  - `code` / `function` (JavaScript)
- **Data transformation**
  - `set` (Set)
  - `editImage`
  - `aggregate`
  - `moveBinaryData`
  - `renameKeys`
- **HTTP & generic**
  - `httpRequest`
  - `graphql`
  - `smtp` (Send Email)
- **File / storage utilities**
  - `readBinaryFile`, `writeBinaryFile`
  - `s3`, `ftp`, `gdrive`, `dropbox`, etc.

A searchable, authoritative list is in [Built-in Node Types](https://docs.n8n.io/integrations/builtin/node-types/).

#### 7.2 Service Integration Nodes (Built‑in)

n8n includes many first‑party integrations, each exposing multiple operations and resources, e.g.:

- **Communication**: Slack, Discord, Telegram, Twilio, Email, Microsoft Teams.
- **Productivity**: Google Sheets, Google Docs, Notion, Airtable, ClickUp, Asana, Trello, monday.com.
- **Dev / Git / CI**: GitHub, GitLab, Bitbucket, Jira, Linear.
- **CRM / Marketing**: HubSpot, Salesforce, Pipedrive, Mailchimp, SendGrid.
- **Cloud & Storage**: AWS S3, GCS, Azure Blob, Dropbox, OneDrive.

Each integration node follows a similar JSON structure in `parameters`:
- `resource`: domain entity (e.g. `"message"`, `"file"`, `"contact"`).
- `operation`: action (e.g. `"create"`, `"getAll"`, `"update"`).
- Additional fields depending on `resource` + `operation`.

#### 7.3 Community Nodes

There is a large and rapidly evolving ecosystem of community nodes (thousands as of 2025).

**Examples (format‑related / AI / data)**

- **JSON Parser node** (package `n8n-nodes-json-parser`):
  - Extracts JSON from text (including markdown code blocks, partial JSON).
  - Helpful for processing LLM outputs into clean JSON.
- **Data Converter node** (package `n8n-nodes-data-converter`):
  - Converts between JSON, XML, CSV, YAML, Base64, binary, HTML.
- **Lenient Structured Output Parser node**:
  - Validates AI outputs against a user‑provided JSON Schema and repairs them.

**Discovery & docs**

- Community catalog and search: [NCNodes directory](https://ncnodes.com/).
- Curated list: [Awesome n8n](https://github.com/restyler/awesome-n8n).
- Installation & constraints: [Community node installation docs](https://docs.n8n.io/integrations/community-nodes/installation/).

---

### 8. Practical Notes for Working with n8n JSON

- **Don’t hand‑edit secrets**: Modify credentials via the UI or API; workflow JSON should only reference them.
- **Respect expressions**: When programmatically manipulating `parameters`, don’t strip `={{ ... }}` strings.
- **Stick to ISO timestamps**: For interoperability across nodes and external APIs.
- **Use node types & versions correctly**:
  - `type` must match an installed node.
  - `typeVersion` should be a valid version for that node (mismatches can break editor loading).
- **Validate workflow JSON** when generating or manipulating it from code:
  - Ensure `nodes[].name` and `connections` match.
  - Ensure coordinates are arrays of two numbers.
  - Ensure node references to credentials exist.

For definitive details and changes over time, always cross‑check with:

- [n8n main documentation](https://docs.n8n.io/)
- [Built-in Node Types](https://docs.n8n.io/integrations/builtin/node-types/)
- [Data structure reference](https://docs.n8n.io/data/data-structure/)
- [Community node installation docs](https://docs.n8n.io/integrations/community-nodes/installation/)
