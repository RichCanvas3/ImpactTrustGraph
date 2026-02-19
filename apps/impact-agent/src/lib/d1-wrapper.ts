/**
 * D1 Database Wrapper
 * Provides access to Cloudflare D1 database via native binding or Cloudflare D1 HTTP API
 */

import type { D1Database, D1PreparedStatement, D1Result, D1ExecResult } from './db';

// Environment variables for Cloudflare D1 HTTP API
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB_NAME = process.env.CLOUDFLARE_D1_DATABASE_NAME || 'agentic-relief-network';
const DB_ID = process.env.CLOUDFLARE_D1_DATABASE_ID || 'f2c52166-1b8e-439e-8dec-ea3959124b0e';
const USE_REMOTE_D1 = process.env.USE_REMOTE_D1 === 'true';

/**
 * Generic fetch function for D1 HTTP API
 */
async function fetchD1Api<T = unknown>(
  sql: string,
  params: unknown[] = [],
  method: 'first' | 'all' | 'run' | 'exec' = 'all'
): Promise<D1Result<T> | D1ExecResult | T | null> {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
    throw new Error('Cloudflare Account ID and API Token are required for remote D1 access.');
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${DB_ID}/query`;
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
  };

  const body = JSON.stringify({
    sql,
    params: params.map(p => {
      // D1 HTTP API expects specific types, convert BigInt to string
      if (typeof p === 'bigint') return p.toString();
      return p;
    }),
  });

  try {
    console.log('[D1Wrapper] Fetching D1 API:', { sql: sql.substring(0, 100) + '...', params, method });
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[D1Wrapper] D1 API Error Response:', errorText);
      throw new Error(`D1 API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const jsonResponse = await response.json();
    console.log('[D1Wrapper] D1 API Raw Response:', jsonResponse);

    if (!jsonResponse.success) {
      const errors = jsonResponse.errors?.map((e: any) => e.message).join(', ') || 'Unknown D1 API error';
      throw new Error(`D1 API returned error: ${errors}`);
    }

    const result = jsonResponse.result?.[0]; // D1 API returns an array of results for batch queries

    if (!result) {
      // For exec or no results
      return {
        results: [],
        success: true,
        meta: {
          duration: jsonResponse.meta?.duration || 0,
          rows_read: 0,
          rows_written: 0,
          last_row_id: 0,
          changed_db: false,
          changes: 0,
        }
      };
    }

    switch (method) {
      case 'first':
        return (result.results?.[0] as T) || null;
      case 'run':
        return {
          results: [],
          success: true,
          meta: {
            duration: result.meta?.duration || 0,
            rows_read: result.meta?.rows_read || 0,
            rows_written: result.meta?.rows_written || 0,
            last_row_id: result.meta?.last_row_id || 0,
            changed_db: result.meta?.changed_db || false,
            changes: result.meta?.changes || 0,
          }
        } as D1Result<T>;
      case 'exec':
        return {
          count: result.meta?.changes || 0,
          duration: result.meta?.duration || 0,
        } as D1ExecResult;
      case 'all':
      default:
        return {
          results: (result.results || []) as T[],
          success: true,
          meta: {
            duration: result.meta?.duration || 0,
            rows_read: result.meta?.rows_read || 0,
            rows_written: result.meta?.rows_written || 0,
            last_row_id: result.meta?.last_row_id || 0,
            changed_db: result.meta?.changed_db || false,
            changes: result.meta?.changes || 0,
          }
        } as D1Result<T>;
    }
  } catch (error) {
    console.error('[D1Wrapper] Error in fetchD1Api:', error);
    throw error;
  }
}

/**
 * Wrapper class that implements D1Database interface
 * Falls back to Cloudflare D1 HTTP API when native binding is not available
 */
class D1Wrapper implements D1Database {
  private nativeDB: D1Database | null = null;

  constructor(nativeDB: D1Database | null) {
    this.nativeDB = nativeDB;
  }

  prepare(query: string): D1PreparedStatement {
    if (this.nativeDB) {
      return this.nativeDB.prepare(query);
    }

    // Return a wrapper that uses Cloudflare D1 HTTP API
    return new D1HttpPreparedStatement(query);
  }

  async exec(query: string): Promise<D1ExecResult> {
    if (this.nativeDB) {
      return this.nativeDB.exec(query);
    }
    return fetchD1Api(query, [], 'exec') as Promise<D1ExecResult>;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    if (this.nativeDB) {
      return this.nativeDB.batch(statements);
    }

    // For HTTP API, we can't easily batch prepared statements with different queries
    // Execute them sequentially for now
    const results: D1Result<T>[] = [];
    for (const stmt of statements) {
      if (stmt instanceof D1HttpPreparedStatement) {
        const result = await stmt.run<T>();
        results.push(result);
      } else {
        throw new Error('Mixed D1PreparedStatement types in batch is not supported by D1HttpPreparedStatement');
      }
    }
    return results;
  }
}

/**
 * Wrapper for D1PreparedStatement that uses Cloudflare D1 HTTP API
 */
class D1HttpPreparedStatement implements D1PreparedStatement {
  private query: string;
  private bindings: unknown[] = [];

  constructor(query: string) {
    this.query = query;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    this.bindings = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const result = await fetchD1Api<T>(this.query, this.bindings, 'first');
    if (colName && result && typeof result === 'object') {
      return (result as any)[colName] || null;
    }
    return result as T || null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return fetchD1Api<T>(this.query, this.bindings, 'all') as Promise<D1Result<T>>;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return fetchD1Api<T>(this.query, this.bindings, 'run') as Promise<D1Result<T>>;
  }

  async raw<T = unknown>(): Promise<T[]> {
    const result = await fetchD1Api<T>(this.query, this.bindings, 'all') as D1Result<T>;
    return result.results || [];
  }
}

/**
 * Get D1 database instance
 * If USE_REMOTE_D1=true, uses Cloudflare D1 HTTP API (remote database)
 * Otherwise, tries native binding first, falls back to remote if no native binding available
 */
export async function getD1Database(): Promise<D1Database | null> {
  // If USE_REMOTE_D1 is enabled, force remote D1 HTTP API (skip native binding)
  if (USE_REMOTE_D1) {
    console.log('[D1Wrapper] USE_REMOTE_D1=true, using Cloudflare D1 HTTP API for remote D1 access');
    return new D1Wrapper(null);
  }

  // Try to get native DB binding first
  let nativeDB: D1Database | null = null;

  if (typeof process !== 'undefined' && (process as any).env?.DB) {
    nativeDB = (process as any).env.DB as D1Database;
  } else if (typeof globalThis !== 'undefined' && (globalThis as any).DB) {
    nativeDB = (globalThis as any).DB as D1Database;
  } else if (typeof (globalThis as any).__env !== 'undefined' && (globalThis as any).__env?.DB) {
    nativeDB = (globalThis as any).__env.DB as D1Database;
  }

  if (nativeDB) {
    console.log('[D1Wrapper] Using native D1 binding');
    return nativeDB;
  }

  // If no native binding and USE_REMOTE_D1 is not enabled, return null
  console.warn('[D1Wrapper] No D1 binding available and USE_REMOTE_D1 is not enabled');
  return null;
}

