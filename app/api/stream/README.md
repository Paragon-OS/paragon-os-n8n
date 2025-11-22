# Streaming API Documentation

The streaming API provides real-time workflow execution updates via Server-Sent Events (SSE).

## Endpoints

### GET `/api/stream/sse/[executionId]`

Subscribe to real-time updates for workflow executions.

**Parameters:**
- `executionId` (path parameter): Execution ID to monitor, or `default` to receive all updates

**Response:** Server-Sent Events stream

**Example:**
```javascript
const eventSource = new EventSource('/api/stream/sse/default');

eventSource.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log('Update:', update);
};
```

**Update Format:**
```json
{
  "executionId": "550e8400-e29b-41d4-a716-446655440000",
  "stage": "processing",
  "status": "in_progress",
  "message": "Processing data...",
  "timestamp": "2024-01-20T10:30:00.000Z",
  "data": {
    "progress": 50,
    "itemsProcessed": 10
  }
}
```

**Status Values:**
- `in_progress`: Workflow is still running
- `completed`: Workflow finished successfully
- `error`: Workflow encountered an error
- `info`: Informational update

### POST `/api/stream/update`

Receive updates from n8n workflows and broadcast to SSE clients.

**executionId (required)** can be provided in one of three ways:
1. **Request body** (preferred): `{ "executionId": "..." }`
2. **Query parameter**: `?executionId=...`
3. **Header**: `X-Execution-Id: ...` or `Execution-Id: ...` or `X-N8N-Execution-Id: ...`

**Request Body:**
```json
{
  "executionId": "string (required - see above for alternatives)",
  "stage": "string",
  "status": "in_progress | completed | error | info",
  "message": "string",
  "timestamp": "ISO 8601 timestamp",
  "data": {}
}
```

**Response:**
```json
{
  "success": true,
  "message": "Update broadcasted",
  "executionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Example 1: executionId in body (preferred):**
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
    "data": {
      "progress": 50
    }
  }
}
```

**Example 2: executionId from webhook body:**
```json
{
  "method": "POST",
  "url": "http://localhost:3000/api/stream/update",
  "body": {
    "executionId": "{{ $json.executionId }}",
    "stage": "{{ $json.stage }}",
    "status": "{{ $json.status }}",
    "message": "{{ $json.message }}",
    "timestamp": "{{ $now }}",
    "data": {{ $json.data }}
  }
}
```

**Example 3: executionId as query parameter:**
```json
{
  "method": "POST",
  "url": "http://localhost:3000/api/stream/update?executionId={{ $execution.id }}",
  "body": {
    "stage": "processing",
    "status": "in_progress",
    "message": "Processing data...",
    "timestamp": "{{ $now }}"
  }
}
```

**Example 4: executionId as header:**
```json
{
  "method": "POST",
  "url": "http://localhost:3000/api/stream/update",
  "headers": {
    "X-Execution-Id": "{{ $execution.id }}"
  },
  "body": {
    "stage": "processing",
    "status": "in_progress",
    "message": "Processing data...",
    "timestamp": "{{ $now }}"
  }
}
```

### GET `/api/stream/health`

Get streaming server status and statistics.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-20T10:30:00.000Z",
  "activeSSEConnections": 3,
  "trackedExecutions": 5,
  "executionIds": ["id1", "id2", "id3"]
}
```

## n8n Workflow Configuration

To send updates from your n8n workflow, add HTTP Request nodes at key stages:

### Example: Start Update
```json
{
  "method": "POST",
  "url": "http://localhost:3000/api/stream/update",
  "body": {
    "executionId": "{{ $execution.id }}",
    "stage": "started",
    "status": "in_progress",
    "message": "Workflow execution started",
    "timestamp": "{{ $now }}"
  }
}
```

### Example: Progress Update
```json
{
  "method": "POST",
  "url": "http://localhost:3000/api/stream/update",
  "body": {
    "executionId": "{{ $execution.id }}",
    "stage": "fetching-data",
    "status": "in_progress",
    "message": "Fetching data from Discord...",
    "timestamp": "{{ $now }}",
    "data": {
      "progress": 50,
      "itemsFetched": 100
    }
  }
}
```

### Example: Completion Update
```json
{
  "method": "POST",
  "url": "http://localhost:3000/api/stream/update",
  "body": {
    "executionId": "{{ $execution.id }}",
    "stage": "completed",
    "status": "completed",
    "message": "Workflow completed successfully",
    "timestamp": "{{ $now }}",
    "data": {
      "result": "{{ $json }}"
    }
  }
}
```

### Example: Error Update
```json
{
  "method": "POST",
  "url": "http://localhost:3000/api/stream/update",
  "body": {
    "executionId": "{{ $execution.id }}",
    "stage": "error",
    "status": "error",
    "message": "{{ $json.error }}",
    "timestamp": "{{ $now }}"
  }
}
```

## Testing with curl

### Subscribe to updates:
```bash
curl -N http://localhost:3000/api/stream/sse/default
```

### Send an update:
```bash
curl -X POST http://localhost:3000/api/stream/update \
  -H "Content-Type: application/json" \
  -d '{
    "executionId": "test-123",
    "stage": "testing",
    "status": "in_progress",
    "message": "Test update",
    "timestamp": "2024-01-20T10:30:00.000Z",
    "data": {"test": true}
  }'
```

### Check health:
```bash
curl http://localhost:3000/api/stream/health
```

## Client Usage

### JavaScript/TypeScript
```typescript
const eventSource = new EventSource('/api/stream/sse/default');

eventSource.onopen = () => {
  console.log('Connected to stream');
};

eventSource.onmessage = (event) => {
  const update = JSON.parse(event.data);
  
  // Skip connection messages
  if (update.type === 'connected') return;
  
  console.log(`[${update.stage}] ${update.message}`);
  
  if (update.status === 'completed') {
    console.log('Workflow completed!', update.data);
  }
};

eventSource.onerror = (error) => {
  console.error('Stream error:', error);
  eventSource.close();
};
```

### React Component
```tsx
import { useEffect, useState } from 'react';

function WorkflowMonitor() {
  const [updates, setUpdates] = useState([]);
  
  useEffect(() => {
    const eventSource = new EventSource('/api/stream/sse/default');
    
    eventSource.onmessage = (event) => {
      const update = JSON.parse(event.data);
      if (update.type !== 'connected') {
        setUpdates(prev => [...prev, update]);
      }
    };
    
    return () => eventSource.close();
  }, []);
  
  return (
    <div>
      {updates.map((update, i) => (
        <div key={i}>
          {update.stage}: {update.message}
        </div>
      ))}
    </div>
  );
}
```

## Architecture

```
┌─────────────┐
│   n8n       │
│  Workflow   │
└──────┬──────┘
       │ POST /api/stream/update
       ▼
┌─────────────────────────────┐
│  Next.js API Routes         │
│  /api/stream/update         │
│  - Stores update in memory  │
│  - Broadcasts to SSE clients│
└──────┬──────────────────────┘
       │
       ├─────────────┬──────────────┐
       ▼             ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Browser  │  │ Browser  │  │ Browser  │
│ Client 1 │  │ Client 2 │  │ Client 3 │
└──────────┘  └──────────┘  └──────────┘
   SSE            SSE            SSE
   /api/stream/sse/[id]
```

## Features

- ✅ Real-time updates via SSE
- ✅ Multiple concurrent executions
- ✅ History replay for new connections
- ✅ Automatic reconnection
- ✅ CORS support
- ✅ Keep-alive pings
- ✅ In-memory storage (100 updates per execution)
- ✅ **Supabase persistence** (all events are saved to database)

## Database Persistence

All stream events are automatically saved to Supabase in the `stream_events` table. The persistence is non-blocking and won't affect webhook performance - errors are logged but won't fail the webhook request.

### Database Schema

See `schema/stream_events.sql` for the complete table schema. The table includes:

- `id`: UUID primary key (auto-generated)
- `execution_id`: n8n execution ID (indexed)
- `stage`: Workflow stage
- `status`: Event status (in_progress, completed, error, info)
- `message`: Human-readable message
- `timestamp`: Event timestamp from n8n workflow
- `data`: Additional JSON data
- `created_at`: Database record creation timestamp (auto-generated)

### Setup

1. Create the `stream_events` table in Supabase using the SQL schema file:
   ```bash
   # Run the migration in your Supabase SQL editor
   # File: schema/stream_events.sql
   ```

2. Configure Supabase environment variables:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

3. Events will automatically start persisting once Supabase is configured.

### Querying Events

You can query events directly from Supabase:

```sql
-- Get all events for a specific execution
SELECT * FROM stream_events 
WHERE execution_id = 'your-execution-id' 
ORDER BY timestamp ASC;

-- Get recent events
SELECT * FROM stream_events 
ORDER BY timestamp DESC 
LIMIT 100;

-- Get events by status
SELECT * FROM stream_events 
WHERE status = 'completed' 
ORDER BY timestamp DESC;
```

Or use the helper functions in `lib/supabase-stream-events.ts`:

```typescript
import { getStreamEventsByExecutionId } from '@/lib/supabase-stream-events';

const events = await getStreamEventsByExecutionId('execution-id');
```

## Limitations

- In-memory storage: Maximum 100 updates per execution (older updates are dropped from memory, but all are persisted to Supabase)
- SSE only (no WebSocket support in standard Next.js)

For production use, consider:
- Implementing authentication
- Adding rate limiting
- Monitoring and logging
- Configuring Supabase Row Level Security (RLS) policies

