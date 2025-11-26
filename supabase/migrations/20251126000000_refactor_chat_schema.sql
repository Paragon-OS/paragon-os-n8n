-- Refactor Chat Schema - Breaking Changes
-- Migration: 20251126000000_refactor_chat_schema
-- This migration simplifies the chat data model by:
-- 1. Using UUIDs as the only identifier (removing TEXT id columns)
-- 2. Consolidating content storage into single JSONB column
-- 3. Merging tool-related columns into single JSONB column
-- 4. Adding proper foreign key relationships
-- 5. Removing redundant indexes

-- ============================================================================
-- STEP 1: Backup existing data structure (create temporary columns)
-- ============================================================================

-- Add new columns to chat_sessions
ALTER TABLE chat_sessions
ADD COLUMN IF NOT EXISTS new_id UUID DEFAULT gen_random_uuid();

-- Add new columns to chat_messages
ALTER TABLE chat_messages
ADD COLUMN IF NOT EXISTS new_id UUID DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS new_session_id UUID,
ADD COLUMN IF NOT EXISTS new_content JSONB,
ADD COLUMN IF NOT EXISTS new_tools JSONB,
ADD COLUMN IF NOT EXISTS execution_id TEXT;

-- ============================================================================
-- STEP 2: Migrate data from old structure to new structure
-- ============================================================================

-- Migrate chat_sessions: Map session_id (TEXT) to new_id (UUID)
-- We'll use the existing id column as the new primary identifier
UPDATE chat_sessions
SET new_id = id;

-- Migrate chat_messages: Consolidate content fields
UPDATE chat_messages
SET 
  new_id = id,
  new_content = CASE
    -- If content_parts exists, use it
    WHEN content_parts IS NOT NULL THEN content_parts
    -- If content is text, wrap it in array format
    WHEN content IS NOT NULL THEN jsonb_build_array(
      jsonb_build_object('type', 'text', 'text', content)
    )
    -- Otherwise, empty array
    ELSE '[]'::jsonb
  END,
  new_tools = CASE
    -- Merge tool_calls and tool_invocations into single tools object
    WHEN tool_calls IS NOT NULL OR tool_invocations IS NOT NULL THEN
      jsonb_build_object(
        'calls', COALESCE(tool_calls, '[]'::jsonb),
        'invocations', COALESCE(tool_invocations, '[]'::jsonb)
      )
    ELSE NULL
  END;

-- Map session_id (TEXT) to new_session_id (UUID) by looking up in chat_sessions
UPDATE chat_messages cm
SET new_session_id = cs.new_id
FROM chat_sessions cs
WHERE cm.session_id = cs.session_id;

-- ============================================================================
-- STEP 3: Update stream_events to reference new message UUIDs
-- ============================================================================

-- Add new column for UUID reference
ALTER TABLE stream_events
ADD COLUMN IF NOT EXISTS new_message_id UUID;

-- Map old message_id (TEXT) to new UUID
UPDATE stream_events se
SET new_message_id = cm.new_id
FROM chat_messages cm
WHERE se.message_id = cm.message_id;

-- ============================================================================
-- STEP 4: Drop old constraints and indexes
-- ============================================================================

-- Drop foreign key constraints
ALTER TABLE chat_messages
DROP CONSTRAINT IF EXISTS fk_session;

ALTER TABLE stream_events
DROP CONSTRAINT IF EXISTS fk_stream_events_session_id;

-- Drop old indexes
DROP INDEX IF EXISTS idx_chat_sessions_session_id;
DROP INDEX IF EXISTS idx_chat_messages_session_id;
DROP INDEX IF EXISTS idx_chat_messages_message_id;
DROP INDEX IF EXISTS idx_chat_messages_role;
DROP INDEX IF EXISTS idx_chat_messages_created_at;

-- ============================================================================
-- STEP 5: Drop old columns and rename new columns
-- ============================================================================

-- chat_sessions: Remove old columns
ALTER TABLE chat_sessions
DROP COLUMN IF EXISTS session_id,
DROP COLUMN IF EXISTS metadata;

-- Rename new_id to id (after dropping old id)
ALTER TABLE chat_sessions
DROP CONSTRAINT IF EXISTS chat_sessions_pkey CASCADE;

ALTER TABLE chat_sessions
DROP COLUMN IF EXISTS id;

ALTER TABLE chat_sessions
RENAME COLUMN new_id TO id;

-- chat_messages: Remove old columns
ALTER TABLE chat_messages
DROP COLUMN IF EXISTS session_id,
DROP COLUMN IF EXISTS message_id,
DROP COLUMN IF EXISTS content,
DROP COLUMN IF EXISTS content_parts,
DROP COLUMN IF EXISTS tool_calls,
DROP COLUMN IF EXISTS tool_invocations,
DROP COLUMN IF EXISTS metadata;

-- Rename new columns
ALTER TABLE chat_messages
DROP CONSTRAINT IF EXISTS chat_messages_pkey CASCADE;

ALTER TABLE chat_messages
DROP COLUMN IF EXISTS id;

ALTER TABLE chat_messages
RENAME COLUMN new_id TO id;

ALTER TABLE chat_messages
RENAME COLUMN new_session_id TO session_id;

ALTER TABLE chat_messages
RENAME COLUMN new_content TO content;

ALTER TABLE chat_messages
RENAME COLUMN new_tools TO tools;

-- stream_events: Update message_id column
ALTER TABLE stream_events
DROP COLUMN IF EXISTS message_id;

ALTER TABLE stream_events
RENAME COLUMN new_message_id TO message_id;

-- Remove session_id from stream_events (will be derived from message relationship)
ALTER TABLE stream_events
DROP COLUMN IF EXISTS session_id;

-- ============================================================================
-- STEP 6: Add new primary keys and constraints
-- ============================================================================

-- Add primary keys
ALTER TABLE chat_sessions
ADD PRIMARY KEY (id);

ALTER TABLE chat_messages
ADD PRIMARY KEY (id);

-- Add NOT NULL constraints
ALTER TABLE chat_messages
ALTER COLUMN session_id SET NOT NULL,
ALTER COLUMN role SET NOT NULL;

-- Add foreign key constraints with CASCADE delete
ALTER TABLE chat_messages
ADD CONSTRAINT fk_chat_messages_session
  FOREIGN KEY (session_id)
  REFERENCES chat_sessions(id)
  ON DELETE CASCADE;

-- Add foreign key for stream_events to chat_messages
ALTER TABLE stream_events
ADD CONSTRAINT fk_stream_events_message
  FOREIGN KEY (message_id)
  REFERENCES chat_messages(id)
  ON DELETE CASCADE;

-- ============================================================================
-- STEP 7: Create optimized indexes
-- ============================================================================

-- Index for fetching messages by session (most common query)
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created 
ON chat_messages(session_id, created_at ASC);

-- Index for execution_id lookups (for n8n tracking)
CREATE INDEX IF NOT EXISTS idx_chat_messages_execution_id 
ON chat_messages(execution_id) 
WHERE execution_id IS NOT NULL;

-- Index for session ordering (for listing recent sessions)
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated 
ON chat_sessions(updated_at DESC);

-- Index for user filtering (if needed)
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id 
ON chat_sessions(user_id) 
WHERE user_id IS NOT NULL;

-- Index for stream events by execution
CREATE INDEX IF NOT EXISTS idx_stream_events_execution_id 
ON stream_events(execution_id);

-- Index for stream events by message
CREATE INDEX IF NOT EXISTS idx_stream_events_message_id 
ON stream_events(message_id) 
WHERE message_id IS NOT NULL;

-- ============================================================================
-- STEP 8: Update triggers and functions
-- ============================================================================

-- Update the trigger function to use the new column names
CREATE OR REPLACE FUNCTION update_session_on_message_insert()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_sessions
  SET updated_at = NOW()
  WHERE id = NEW.session_id;  -- Changed from session_id = NEW.session_id
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure update trigger exists for chat_sessions
DROP TRIGGER IF EXISTS trigger_update_chat_sessions_updated_at ON chat_sessions;
CREATE TRIGGER trigger_update_chat_sessions_updated_at
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_sessions_updated_at();

-- Ensure message insert trigger exists
DROP TRIGGER IF EXISTS trigger_update_session_on_message ON chat_messages;
CREATE TRIGGER trigger_update_session_on_message
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_session_on_message_insert();

-- ============================================================================
-- STEP 9: Update comments for documentation
-- ============================================================================

COMMENT ON TABLE chat_sessions IS 'Chat conversation sessions (refactored schema)';
COMMENT ON TABLE chat_messages IS 'Individual messages within chat sessions (refactored schema)';

COMMENT ON COLUMN chat_sessions.id IS 'Primary identifier (UUID)';
COMMENT ON COLUMN chat_sessions.user_id IS 'Optional user identifier';
COMMENT ON COLUMN chat_sessions.title IS 'Session title/summary';
COMMENT ON COLUMN chat_sessions.created_at IS 'Session creation timestamp';
COMMENT ON COLUMN chat_sessions.updated_at IS 'Last update timestamp';

COMMENT ON COLUMN chat_messages.id IS 'Primary identifier (UUID)';
COMMENT ON COLUMN chat_messages.session_id IS 'Foreign key to chat_sessions(id)';
COMMENT ON COLUMN chat_messages.role IS 'Message role: user, assistant, system, or tool';
COMMENT ON COLUMN chat_messages.content IS 'Message content as JSONB (array of content parts)';
COMMENT ON COLUMN chat_messages.tools IS 'Tool calls and invocations as JSONB';
COMMENT ON COLUMN chat_messages.execution_id IS 'n8n execution ID for tracking';
COMMENT ON COLUMN chat_messages.created_at IS 'Message creation timestamp';

COMMENT ON COLUMN stream_events.message_id IS 'Foreign key to chat_messages(id)';

