-- Migration: Add org_address and org_type columns to organizations table
-- Run this if your organizations table already exists

ALTER TABLE organizations ADD COLUMN org_address TEXT;
ALTER TABLE organizations ADD COLUMN org_type TEXT;

