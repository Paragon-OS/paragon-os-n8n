-- Add message_id column to stream_events table
-- Migration: 20250126000000_add_message_id_to_stream_events

-- Add message_id column (nullable to support existing records)
ALTER TABLE stream_events 
ADD COLUMN IF NOT EXISTS message_id TEXT;

-- Create an index on message_id for efficient querying by message
CREATE INDEX IF NOT EXISTS idx_stream_events_message_id ON stream_events(message_id);

-- Add comment to column for documentation
COMMENT ON COLUMN stream_events.message_id IS 'Chat message ID that this event belongs to';

