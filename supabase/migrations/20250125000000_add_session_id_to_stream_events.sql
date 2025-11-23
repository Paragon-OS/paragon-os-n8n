-- Add session_id column to stream_events table
-- Migration: 20250125000000_add_session_id_to_stream_events

-- Add session_id column (nullable to support existing records)
ALTER TABLE stream_events 
ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Create an index on session_id for efficient querying by session
CREATE INDEX IF NOT EXISTS idx_stream_events_session_id ON stream_events(session_id);

-- Add comment to column for documentation
COMMENT ON COLUMN stream_events.session_id IS 'Chat session ID that this event belongs to';

