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

export interface Individual {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  social_account_id: string | null;
  social_account_type: string | null;
  eoa_address: string | null;
  aa_address: string | null;
  created_at: number;
  updated_at: number;
}

export interface Organization {
  id: number;
  ens_name: string;
  agent_name: string;
  org_name: string | null;
  org_address: string | null;
  org_type: string | null;
  email_domain: string;
  session_package: string | null; // JSON string of sessionPackage
  created_at: number;
  updated_at: number;
}

export interface IndividualOrganization {
  id: number;
  individual_id: number;
  organization_id: number;
  is_primary: boolean;
  role: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Get D1 database instance from Cloudflare environment
 * In Next.js, this will be available via the runtime context
 */
export function getDB(): D1Database | null {
  // In Cloudflare Pages/Workers, DB is available via env
  // For Next.js, we'll need to pass it through API routes
  if (typeof process !== 'undefined' && (process as any).env?.DB) {
    return (process as any).env.DB as D1Database;
  }
  return null;
}

