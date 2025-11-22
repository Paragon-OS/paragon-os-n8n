This is the ParagonOS UI project, built on top of the [assistant-ui](https://github.com/Yonom/assistant-ui) starter template.

## Getting Started

First, add your API key(s) to `.env.local`:

```
# Gemini (default)
GOOGLE_GENERATIVE_AI_API_KEY=your-gemini-api-key

# Optional: keep OpenAI support by wiring your key as well
# OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

By default the chat endpoint uses Gemini `models/gemini-2.5-flash`. You can switch
to another Google model (for example, `models/gemini-1.5-pro`) by updating
`app/api/chat/route.ts`.

## n8n Workflow Integration

This project includes integration with locally running n8n workflows, allowing the AI assistant to call workflows for answering questions, generating triages, and sending messages.

### Configuration

Add n8n configuration to your `.env.local`:

```
# n8n Configuration
N8N_BASE_URL=http://localhost:5678

# Optional: Override webhook base URL (not recommended when using mode switching)
# N8N_WEBHOOK_BASE_URL=http://localhost:5678/webhook

# Optional: API key for n8n API authentication
# N8N_API_KEY=your-n8n-api-key

# Optional: Synchronous execution settings
# N8N_WAIT_FOR_COMPLETION=true  # Wait for workflow completion (default: true)
# N8N_POLL_INTERVAL=500         # Polling interval in ms (default: 500ms)

# Optional: Streaming configuration (uses Next.js API routes by default)
# N8N_STREAMING_SERVER_URL=http://localhost:3000/api/stream
# N8N_STREAMING_CONNECTION_TYPE=sse  # 'sse' or 'websocket' (default: sse)
```

**Note**: For webhook mode switching (test vs production) to work properly, it's recommended to **NOT** set `N8N_WEBHOOK_BASE_URL`. The system will automatically construct the correct URL based on the selected mode:
- Test mode: `http://localhost:5678/webhook-test/paragon-os`
- Production mode: `http://localhost:5678/webhook/paragon-os`

If you do set `N8N_WEBHOOK_BASE_URL`, the system will still respect the mode by replacing any `/webhook` or `/webhook-test` suffix with the mode-appropriate prefix.

### Setting Up Workflows

1. **Configure Workflow Webhooks**: Update `lib/n8n-config.ts` with your n8n workflow webhook paths or URLs:
   - `paragonOS`: Webhook path for the main ParagonOS Manager workflow

2. **Workflow Webhook Paths**: In n8n, create webhook nodes and note their paths. For example:
   - If your webhook URL is `http://localhost:5678/webhook/paragon-os`, use `/paragon-os` as the `webhookPath`

3. **Confirmation Requirements**: Workflows that modify external state (like sending messages) can be configured to require confirmation. You can adjust this in `lib/n8n-config.ts` by setting `requiresConfirmation: true/false`.

4. **Synchronous Execution**: By default, the system waits for workflows to complete before returning results. If your n8n webhook is configured for asynchronous execution ("Response Mode: Immediately"), the system will automatically poll the execution API until completion. You can disable this behavior by setting `N8N_WAIT_FOR_COMPLETION=false` in your `.env.local`.

### Available Tools

The AI assistant has access to the following n8n workflow tool:

- **paragonOS**: Unified interface for ParagonOS to handle messaging, questions, and tasks via Discord and Telegram

### Usage

Once configured, you can ask the AI assistant to:
- "Answer this question using my chat history: [your question]"
- "Send a message to [recipient] on Telegram: [message]"
- "Generate a triage for: [context]"
- "Check for unreplied messages in Discord"

The assistant will automatically call the ParagonOS workflow and display the results in the chat interface.

### Real-Time Streaming Updates

The application includes built-in real-time streaming for workflow execution monitoring via Server-Sent Events (SSE).

#### Features

- **Built-in Streaming Server**: No external services needed - streaming is integrated into Next.js API routes
- **Stream Monitor Tab**: View real-time workflow updates in the UI
- **Immediate Response**: Get workflow ID and execution ID as soon as workflows start
- **Real-Time Progress**: See workflow progress updates as they happen
- **Multiple Executions**: Track multiple concurrent workflows simultaneously

#### Usage

1. **View Stream Monitor**: Click the "Stream Monitor" tab in the UI to see real-time workflow updates

2. **Configure n8n Workflows**: Add HTTP Request nodes in your n8n workflows to send updates:
   ```json
   {
     "method": "POST",
     "url": "http://localhost:3000/api/stream/update",
     "body": {
       "executionId": "{{ $execution.id }}",
       "stage": "processing",
       "status": "in_progress",
       "message": "Processing data...",
       "timestamp": "{{ $now }}",
       "data": { "progress": 50 }
     }
   }
   ```

3. **Use Streaming in Code** (optional):
   ```typescript
   import { callN8nWorkflow } from '@/lib/n8n-client';

   const result = await callN8nWorkflow({
     webhookUrl: 'http://localhost:5678/webhook/my-workflow',
     method: 'POST',
     payload: { input: 'data' },
     streaming: {
       onStart: (executionId, workflowId) => {
         console.log('Started:', executionId);
       },
       onUpdate: (update) => {
         console.log('Update:', update.stage, update.message);
       },
       onComplete: (result, executionId) => {
         console.log('Completed:', result);
       },
       onError: (error) => {
         console.error('Error:', error);
       },
     },
   });
   ```

#### API Endpoints

- `GET /api/stream/sse/[executionId]` - Subscribe to real-time updates
- `POST /api/stream/update` - Receive updates from n8n workflows
- `GET /api/stream/health` - Check streaming server status

See `app/api/stream/README.md` for complete API documentation.

## Supabase Database Setup

This project uses Supabase for database persistence. The stream events are automatically saved to Supabase.

### Quick Setup

1. **Install Supabase CLI** (if not already installed):
   ```bash
   npm run db:setup
   ```
   
   The setup script automatically detects and configures **Podman** or **Docker** for you.

2. **Start local Supabase**:
   ```bash
   npm run db:start
   ```
   
   **Note**: The npm scripts automatically detect and configure Podman if you're using it instead of Docker.

3. **Apply migrations automatically**:
   Migrations are automatically applied when you run `supabase start`. If you need to reset:
   ```bash
   npm run db:migrate:apply
   ```

4. **Update your `.env.local`**:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key_from_supabase_start>
   ```

### Podman Support

This project fully supports **Podman** as an alternative to Docker. The setup scripts automatically:
- Detect if you're using Podman
- Configure `DOCKER_HOST` to point to Podman's socket
- Ensure Podman service is running

If you need to run Supabase CLI commands directly with Podman:

For **Podman Machine** (rootful - most common):
```bash
export DOCKER_HOST=unix:///var/run/docker.sock
supabase start
```

For **rootless Podman**:
```bash
export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock
supabase start
```

Or use the npm scripts which handle this automatically (detects both rootful and rootless):
```bash
npm run db:start    # Automatically configures Podman
```

### Migration Management

- **View migrations**: `npm run db:migrate`
- **Apply migrations**: `npm run db:migrate:apply`
- **Check status**: `npm run db:status`
- **Start Supabase**: `npm run db:start`
- **Stop Supabase**: `npm run db:stop`

For detailed migration documentation, see [`supabase/README.md`](./supabase/README.md).

### Automated Migration Application

When using Supabase CLI locally, migrations in `supabase/migrations/` are automatically applied on `supabase start`. For production, use `supabase db push` to apply migrations to your remote Supabase project.

## Development

Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.
