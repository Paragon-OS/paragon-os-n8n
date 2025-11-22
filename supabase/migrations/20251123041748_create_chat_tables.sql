-- Create chat tables for storing AI chat conversations
-- Migration: 20251123041748_create_chat_tables

-- Create the chat_sessions table to track conversation sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,
  user_id TEXT,
  title TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create the chat_messages table to store individual messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  message_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT,
  content_parts JSONB,
  tool_calls JSONB,
  tool_invocations JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_session
    FOREIGN KEY (session_id)
    REFERENCES chat_sessions(session_id)
    ON DELETE CASCADE
);

-- Create indexes for efficient querying

-- Index on session_id for chat_sessions
CREATE INDEX IF NOT EXISTS idx_chat_sessions_session_id ON chat_sessions(session_id);

-- Index on created_at for chat_sessions (for listing recent sessions)
CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_at ON chat_sessions(created_at DESC);

-- Index on user_id for chat_sessions (for filtering by user)
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);

-- Index on session_id for chat_messages (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);

-- Index on created_at for chat_messages (for ordering messages)
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at ASC);

-- Composite index for session_id + created_at (optimal for fetching session messages)
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON chat_messages(session_id, created_at ASC);

-- Index on role for filtering by message role
CREATE INDEX IF NOT EXISTS idx_chat_messages_role ON chat_messages(role);

-- Index on message_id for quick lookups
CREATE INDEX IF NOT EXISTS idx_chat_messages_message_id ON chat_messages(message_id);

-- Add comments to tables for documentation
COMMENT ON TABLE chat_sessions IS 'Stores chat conversation sessions with metadata';
COMMENT ON TABLE chat_messages IS 'Stores individual messages within chat sessions, following AI SDK UIMessage format';

-- Add comments to chat_sessions columns
COMMENT ON COLUMN chat_sessions.id IS 'Unique identifier for the session record (auto-generated UUID)';
COMMENT ON COLUMN chat_sessions.session_id IS 'Session identifier used by the application (unique, indexed)';
COMMENT ON COLUMN chat_sessions.user_id IS 'Optional user identifier for multi-user scenarios';
COMMENT ON COLUMN chat_sessions.title IS 'Optional title/summary of the conversation';
COMMENT ON COLUMN chat_sessions.metadata IS 'Additional session metadata as JSON (e.g., tags, settings)';
COMMENT ON COLUMN chat_sessions.created_at IS 'Timestamp when the session was created';
COMMENT ON COLUMN chat_sessions.updated_at IS 'Timestamp when the session was last updated';

-- Add comments to chat_messages columns
COMMENT ON COLUMN chat_messages.id IS 'Unique identifier for the message record (auto-generated UUID)';
COMMENT ON COLUMN chat_messages.session_id IS 'Session identifier this message belongs to';
COMMENT ON COLUMN chat_messages.message_id IS 'Optional message ID from the AI SDK';
COMMENT ON COLUMN chat_messages.role IS 'Message role: user, assistant, system, or tool';
COMMENT ON COLUMN chat_messages.content IS 'Message content as plain text (for simple messages)';
COMMENT ON COLUMN chat_messages.content_parts IS 'Message content as structured parts (for complex messages with multiple parts)';
COMMENT ON COLUMN chat_messages.tool_calls IS 'Tool calls made by the assistant (for tool messages)';
COMMENT ON COLUMN chat_messages.tool_invocations IS 'Tool invocations and results (for tracking tool usage)';
COMMENT ON COLUMN chat_messages.metadata IS 'Additional message metadata as JSON (e.g., timestamps, execution IDs)';
COMMENT ON COLUMN chat_messages.created_at IS 'Timestamp when the message was created';

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_chat_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to update updated_at on chat_sessions
CREATE TRIGGER trigger_update_chat_sessions_updated_at
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_sessions_updated_at();

-- Create a trigger to update session updated_at when messages are added
CREATE OR REPLACE FUNCTION update_session_on_message_insert()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_sessions
  SET updated_at = NOW()
  WHERE session_id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_session_on_message
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_session_on_message_insert();

