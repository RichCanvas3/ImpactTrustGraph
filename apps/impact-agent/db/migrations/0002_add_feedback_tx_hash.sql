-- Migration: Add feedback_tx_hash column to agent_feedback_requests table
-- Run this if your agent_feedback_requests table already exists and does not yet have feedback_tx_hash

ALTER TABLE agent_feedback_requests ADD COLUMN feedback_tx_hash TEXT NULL;


