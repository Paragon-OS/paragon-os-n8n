-- Add foreign key constraint to stream_events.session_id with CASCADE DELETE
-- Migration: 20251123041749_add_cascade_delete_to_stream_events
-- This migration must run AFTER chat_sessions table is created (20251123041748_create_chat_tables.sql)

-- Add foreign key constraint: stream_events.session_id -> chat_sessions.session_id
-- This ensures stream_events are automatically deleted when a chat session is deleted
ALTER TABLE stream_events
ADD CONSTRAINT fk_stream_events_session_id
FOREIGN KEY (session_id)
REFERENCES chat_sessions(session_id)
ON DELETE CASCADE;

-- Add comment to document the constraint
COMMENT ON CONSTRAINT fk_stream_events_session_id ON stream_events IS 
'Foreign key constraint ensuring stream events are automatically deleted when their associated chat session is deleted';

