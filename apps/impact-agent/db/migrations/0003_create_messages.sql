-- Migration: Create messages table for inbox functionality
-- This table stores messages between users (by client address) and agents (by DID:8004)

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_client_address TEXT NULL,
  from_agent_did TEXT NULL,
  from_agent_name TEXT NULL,
  to_client_address TEXT NULL,
  to_agent_did TEXT NULL,
  to_agent_name TEXT NULL,
  subject TEXT NULL,
  body TEXT NOT NULL,
  context_type TEXT NULL,
  context_id TEXT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_to_client ON messages (to_client_address);
CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages (to_agent_did);
CREATE INDEX IF NOT EXISTS idx_messages_from_client ON messages (from_client_address);
CREATE INDEX IF NOT EXISTS idx_messages_from_agent ON messages (from_agent_did);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);


