-- Migration: Add session_package column to organizations table
-- This allows storing the sessionPackage JSON in the database

ALTER TABLE organizations ADD COLUMN session_package TEXT;

