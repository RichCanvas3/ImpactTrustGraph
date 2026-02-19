-- Migration: Add feedback_auth column to agent_feedback_requests table
-- Run this if your agent_feedback_requests table already exists

ALTER TABLE agent_feedback_requests ADD COLUMN feedback_auth TEXT NULL;

