-- Create stream_events table for storing n8n workflow execution stream events
-- Migration: 20240120000000_create_stream_events

-- Create the stream_events table
CREATE TABLE IF NOT EXISTS stream_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create an index on execution_id for efficient querying by execution
CREATE INDEX IF NOT EXISTS idx_stream_events_execution_id ON stream_events(execution_id);

-- Create an index on timestamp for efficient time-based queries
CREATE INDEX IF NOT EXISTS idx_stream_events_timestamp ON stream_events(timestamp DESC);

-- Create an index on status for filtering by status
CREATE INDEX IF NOT EXISTS idx_stream_events_status ON stream_events(status);

-- Create a composite index for common query patterns (execution_id + timestamp)
CREATE INDEX IF NOT EXISTS idx_stream_events_execution_timestamp ON stream_events(execution_id, timestamp ASC);

-- Add comment to table for documentation
COMMENT ON TABLE stream_events IS 'Stores stream monitor events from n8n workflow executions';

-- Add comments to columns for documentation
COMMENT ON COLUMN stream_events.id IS 'Unique identifier for the event (auto-generated UUID)';
COMMENT ON COLUMN stream_events.execution_id IS 'n8n execution ID that this event belongs to';
COMMENT ON COLUMN stream_events.stage IS 'Stage of the workflow execution (e.g., "setup", "processing", "cleanup")';
COMMENT ON COLUMN stream_events.status IS 'Status of the event (in_progress, completed, error, info)';
COMMENT ON COLUMN stream_events.message IS 'Human-readable message describing the event';
COMMENT ON COLUMN stream_events.timestamp IS 'Timestamp when the event occurred (from the n8n workflow)';
COMMENT ON COLUMN stream_events.data IS 'Additional event data as JSON (optional)';
COMMENT ON COLUMN stream_events.created_at IS 'Timestamp when the record was created in the database (auto-generated)';

