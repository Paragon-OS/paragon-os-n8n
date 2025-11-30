<!-- 5d781af4-3f40-469e-9e70-40fb5fc8d817 2fee6ff2-8805-452c-b0d8-db21a69b9596 -->
# Plan: Evolve Telegram Workflows into Scout + Smart Agent

### Goal

Create two new Telegram workflows that mirror the Discord pair:

- **`Telegram Context Scout`**: a reusable, cached search/normalization tool for Telegram contacts, chats, tools, and self profile.
- **`Telegram Smart Agent`**: a single LLM agent that uses the Scout and the existing Step Executor to plan, execute, and answer user prompts about Telegram.

### 1. Design & scaffold `Telegram Context Scout`

- **1.1 Create new workflow file**
- Add `[n8n-agent/workflows/Telegram Context Scout.json](n8n-agent/workflows/Telegram Context Scout.json) `with metadata similar to `Discord Context Scout.json` but tagged for Telegram.
- **1.2 Define trigger + inputs**
- Use `executeWorkflowTrigger` with **inputs**: `query` (string) and `entity` (string union: `contact | chat | tool | self`).
- **1.3 Implement cache-backed retrieval for each entity type**
- **Contacts**
- Use Global Cache key `telegramContacts` (read via `executeWorkflow` to `[HELPERS] Global Cache System`).
- On cache miss/invalid, call MCP `telegram_list_contacts` using the Telegram MCP client.
- Normalize via a `Code` node using the existing `simplifyMCPData` helper pattern from `Legacy Telegram Context Enricher.json` to produce `telegramContacts` items: `{ id, username, displayName, lastMessage, contactType, phone }`.
- Write normalized contacts back to cache with a TTL (e.g. 30 minutes).
- **Chats (groups / channels / DMs)**
- Use cache key `telegramChannels` or consolidated `telegramChats` (pick one, but normalize to items with `{ id, name, members, kind, unread }`).
- On cache miss, call `telegram_list_chats` (like `List Chats` in the legacy enricher) and normalize via a `Code` node based on `Guild Data Simplifier` from `Legacy Telegram Context Enricher.json`.
- Persist normalized array into cache with TTL.
- **Tools (Telegram MCP tool catalog)**
- Use cache key `telegramTools`, following the pattern from `Legacy Telegram Context Enricher.json` and `[LEGACY] Telegram MCP Client Sequencer.json`.
- On miss, call the Telegram MCP `List MCP Tools` node, run through `Tool Data Simplifier` logic, then cache.
- **Self profile**
- Use cache key `telegramProfile` with read/write wrappers.
- On miss, call `telegram_get_me`, parse in `User Profile Simplifier` (like the legacy enricher), and cache `{ myProfile }`.

- **1.4 Implement fuzzy search per entity type**
- **Contacts**: `n8n-nodes-paragon-os.fuzzySearch` over `telegramContacts` with search keys like `username`, `displayName`, `contactType`, `phone`, using `query` and a reasonable `matchQuality`.
- **Chats**: similar fuzzy search over normalized `channels`/`chats` with keys like `name` and `kind`.
- **Tools**: fuzzy search over MCP `tools` using `name` and `description`.
- **Self**: bypass search; just return `myProfile` from cache/lookup.

- **1.5 Route by entity with a `switch` node and merge outputs**
- Add a `switch` node on `entity` (values: `contact`, `chat`, `tool`, `self`) to fan out into the appropriate cache+fetch+search path.
- Use `merge` nodes to combine the selected branch’s results plus shared profile data into a unified output payload (e.g. `{ telegramContacts?, telegramChats?, tools?, myProfile? }`).

### 2. Design & scaffold `Telegram Smart Agent`

- **2.1 Create new workflow file**
- Add `[n8n-agent/workflows/Telegram Smart Agent.json](n8n-agent/workflows/Telegram Smart Agent.json) `modeled on `Discord Smart Agent.json` but adapted to Telegram semantics.

- **2.2 Define trigger + basic structure**
- Use an `executeWorkflowTrigger` that accepts `userPrompt` (string).
- Immediately route into a single `Context Optimizer AI Agent` node (Gemini-based) that will orchestrate everything.

- **2.3 Attach tools to the agent**
- **Telegram Context Scout tool**
- Add a `toolWorkflow` node that wraps `Telegram Context Scout.json` (similar to how `Discord Smart Agent` wraps `Discord Context Scout`).
- Configure AI-mappable inputs:
- `query`: text description tells the model to emit space-separated search keywords for contacts/chats/tools.
- `entity`: constrained to `"contact" | "chat" | "tool" | "self"` with clear descriptions.
- **Step Executor tool**
- Add a `toolWorkflow` for the existing `[HELPERS] Discord & Telegram Step Executor` workflow.
- Fix `targetMcp` to `"TELEGRAM"` and expose `executionSteps` as an AI-mapped JSON argument.

- **2.4 Define structured output schema for the agent**
- Use an `outputParserStructured` node to enforce a JSON shape like:
- `executionSteps: array<{ toolName: string; callParams: object; reasoning?: string }>` (required).
- `chatsUsed: array<{ id: string; name: string; kind?: string; unread?: boolean }>`.
- `contactsUsed: array<{ id: string; username: string; displayName?: string; phone?: string }>`.
- `toolsUsed: array<{ name: string; description: string; inputSchema: object }>`.
- `answerToUserPrompt: string` (markdown-formatted final answer).
- Mirror the Discord Smart Agent schema but rename `guildsUsed` to `chatsUsed` and adapt field semantics to Telegram.

- **2.5 Author the system prompt for the agent**
- Start from the Discord Smart Agent’s prompt plus the Telegram-specific guidance from the legacy enricher/sequencer, including:
- Telegram chat semantics (`chat_id` used for DMs, groups, channels; negative IDs for groups where appropriate).
- When to call which Telegram MCP tools (read/search/send/edit/delete/attachments, etc.).
- Hard rules: no hallucinated `chat_id`/`user_id`/tool names; all IDs must originate from Scout results or prior tool calls.
- Explicitly instruct the agent to:
- Call the **Telegram Context Scout** tool to look up chats, contacts, and tool schemas using keyword queries.
- Construct **fully-resolved** `executionSteps` arrays with concrete IDs and parameters.
- Call the **Step Executor** with those `executionSteps` and inspect results.
- Populate `executionSteps`, `chatsUsed`, `contactsUsed`, `toolsUsed`, and `answerToUserPrompt` in the final JSON.

- **2.6 Wire the graph**
- Connect:
- Trigger → `Context Optimizer AI Agent`.
- Gemini model → agent and output parser (as in the Discord Smart Agent pattern).
- `Telegram Context Scout` and `Step Executor` toolWorkflow nodes → agent as `ai_tool` connections.
- Agent → a small `set` node that attaches `userPrompt` and final `output` to the returned items.

### 3. Consistency, testing, and documentation

- **3.1 Reuse generic helper code**
- Ensure all Telegram workflows share the same `simplifyMCPData` helper pattern (contacts, chats, tools) as used in `Legacy Telegram Context Enricher.json` and `Discord Context Scout.json` to keep behavior uniform.

- **3.2 Sanity test flows in n8n UI**
- Manually run `Telegram Context Scout` with representative queries for each `entity` and verify it respects cache, normalizes outputs, and returns matches with scores.
- Run `Telegram Smart Agent` with prompts like “Catch me up on unread messages in my startup group” or “Send a DM to <contact>” and verify that:
- It calls the Scout tool to find chats/contacts.
- It constructs valid `executionSteps` and invokes the Step Executor.
- The final JSON includes `chatsUsed` and `contactsUsed` that correspond to real IDs.

- **3.3 Document the new workflows**
- In each workflow’s `description`, clearly describe:
- Purpose, inputs, and outputs.
- How it relates to the legacy Telegram Context Enricher / Sequencer.
- Example tool usage patterns (e.g., which prompts lead to which tool sequences).

### To-dos

- [x] Design and scaffold the new `Telegram Context Scout` workflow with trigger, cache-backed retrieval for contacts/chats/tools/self, and fuzzy search routing by entity.
- [x] Implement the Telegram Context Scout nodes (cache reads/writes, MCP calls, `simplifyMCPData` code, fuzzy search, and merge outputs) mirroring `Discord Context Scout.json`.
- [x] Design and scaffold the `Telegram Smart Agent` workflow, including trigger, Gemini-backed agent node, and `outputParserStructured` schema mirroring `Discord Smart Agent.json` but adapted for Telegram.
- [x] Attach `Telegram Context Scout` and Step Executor as tools to the Telegram Smart Agent node, and wire data flow from trigger to agent to final `set` node.
- [x] Author and refine the system prompt for Telegram Smart Agent to enforce correct Telegram semantics, tool usage, and output structure, leveraging prompts from the legacy enricher/sequencer.
- [x] Manually test both new Telegram workflows in n8n with realistic prompts to confirm caching, search, executionSteps, and final answers behave as intended.