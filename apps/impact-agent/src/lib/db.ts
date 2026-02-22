/**
 * Database utility functions for Cloudflare D1
 * This file provides type-safe database access
 */

// D1Database type definition (Cloudflare D1)
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<D1ExecResult>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: {
    duration: number;
    rows_read: number;
    rows_written: number;
    last_row_id: number;
    changed_db: boolean;
    changes: number;
  };
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

export interface Organization {
  id: number;
  ens_name: string;
  agent_name: string;
  org_name: string | null;
  org_address: string | null;
  org_type: string | null;
  email_domain: string;
  uaid: string | null;
  session_package: string | null; // JSON string of sessionPackage
  agent_card_json?: string | null;
  org_metadata?: string | null;
  created_at: number;
  updated_at: number;
}

export interface AgentFeedbackRequest {
  id?: number;
  client_address: string; // EOA address of the client requesting feedback
  target_agent_id: string; // Agent ID of the agent to give feedback to
  comment: string; // Comment about why they want to give feedback
  status: string; // e.g., 'pending', 'processed', 'rejected'
  feedback_auth: string | null; // Signed feedback auth payload (JSON string)
  created_at: number;
  updated_at: number;
}

