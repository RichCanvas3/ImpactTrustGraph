/**
 * D1 Database Wrapper
 * Provides access to Cloudflare D1 database via native binding or Wrangler CLI
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { D1Database, D1PreparedStatement, D1Result } from './db';

const execAsync = promisify(exec);

const DB_NAME = process.env.CLOUDFLARE_D1_DATABASE_NAME || 'agentic-relief-network';
const USE_REMOTE_D1 = process.env.USE_REMOTE_D1 === 'true';

/**
 * Wrapper class that implements D1Database interface
 * Falls back to Wrangler CLI when native binding is not available
 */
class D1Wrapper implements D1Database {
  private nativeDB: D1Database | null = null;
  private useRemote: boolean;

  constructor(nativeDB: D1Database | null, useRemote: boolean) {
    this.nativeDB = nativeDB;
    this.useRemote = useRemote;
  }

  prepare(query: string): D1PreparedStatement {
    if (this.nativeDB) {
      return this.nativeDB.prepare(query);
    }

    // Return a wrapper that uses Wrangler CLI
    return new WranglerPreparedStatement(query, this.useRemote);
  }

  async exec(query: string): Promise<{ count: number; duration: number }> {
    if (this.nativeDB) {
      return this.nativeDB.exec(query);
    }

    // Use Wrangler CLI for exec
    const command = `wrangler d1 execute ${DB_NAME} --command "${query.replace(/"/g, '\\"')}"`;
    try {
      const { stdout } = await execAsync(command);
      const result = JSON.parse(stdout || '{}');
      return {
        count: result.count || 0,
        duration: result.duration || 0
      };
    } catch (error) {
      console.error('[D1Wrapper] Exec error:', error);
      throw error;
    }
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    if (this.nativeDB) {
      return this.nativeDB.batch(statements);
    }

    // Execute statements sequentially via Wrangler CLI
    const results: D1Result<T>[] = [];
    for (const stmt of statements) {
      if (stmt instanceof WranglerPreparedStatement) {
        const result = await stmt.run<T>();
        results.push(result);
      }
    }
    return results;
  }
}

/**
 * Wrapper for D1PreparedStatement that uses Wrangler CLI
 */
class WranglerPreparedStatement implements D1PreparedStatement {
  private query: string;
  private bindings: unknown[] = [];
  private useRemote: boolean;

  constructor(query: string, useRemote: boolean) {
    this.query = query;
    this.useRemote = useRemote;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    this.bindings = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const result = await this.run<T>();
    if (result.results && result.results.length > 0) {
      const first = result.results[0] as T;
      if (colName) {
        return (first as any)[colName] || null;
      }
      return first;
    }
    return null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return this.run<T>();
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    // Use Cloudflare D1 HTTP API when USE_REMOTE_D1 is true
    if (this.useRemote) {
      return this.runViaHTTP<T>();
    }

    // For local, use Wrangler CLI
    return this.runViaWrangler<T>();
  }

  private async runViaHTTP<T = unknown>(): Promise<D1Result<T>> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || 'f2c52166-1b8e-439e-8dec-ea3959124b0e';

    if (!accountId || !apiToken) {
      throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set for remote D1 access');
    }

    // Use parameterized queries (Cloudflare D1 API supports params array)
    const params = this.bindings.map((v) => {
      // Convert values to appropriate types for D1
      if (v === null || v === undefined) return null;
      return v;
    });

    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            sql: this.query,
            params: params.length > 0 ? params : undefined
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`D1 API error: ${response.status} ${error}`);
      }

      const data = await response.json();
      const result = data.result?.[0];

      return {
        results: (result?.results || []) as T[],
        success: result?.success !== false,
        meta: {
          duration: result?.meta?.duration || 0,
          rows_read: result?.meta?.rows_read || 0,
          rows_written: result?.meta?.rows_written || 0,
          last_row_id: result?.meta?.last_row_id || 0,
          changed_db: result?.meta?.changed_db || false,
          changes: result?.meta?.changes || 0,
        },
      };
    } catch (error: any) {
      console.error('[D1Wrapper] HTTP API error:', error);
      throw new Error(`D1 query failed: ${error.message}`);
    }
  }

  private async runViaWrangler<T = unknown>(): Promise<D1Result<T>> {
    // For local D1, create a temporary SQL file
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');

    // Build SQL with parameter substitution
    let sql = this.query;
    const params = this.bindings.map((v) => {
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
      if (typeof v === 'number') return String(v);
      if (typeof v === 'boolean') return v ? '1' : '0';
      return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
    });

    let paramIndex = 0;
    sql = sql.replace(/\?/g, () => {
      if (paramIndex < params.length) {
        return params[paramIndex++];
      }
      return 'NULL';
    });

    const tempFile = path.join(os.tmpdir(), `d1-query-${Date.now()}.sql`);
    
    try {
      await fs.writeFile(tempFile, sql);
      const command = `wrangler d1 execute ${DB_NAME} --local --file="${tempFile}"`;
      
      console.log('[D1Wrapper] Executing via Wrangler CLI (local):', this.query.substring(0, 50) + '...');
      const { stdout } = await execAsync(command);
      
      // Clean up temp file
      await fs.unlink(tempFile).catch(() => {});

      // Wrangler output is not JSON, so we'll return a basic result
      // For local dev, this is a simplified response
      return {
        results: [] as T[],
        success: true,
        meta: {
          duration: 0,
          rows_read: 0,
          rows_written: 0,
          last_row_id: 0,
          changed_db: false,
          changes: 0,
        },
      };
    } catch (error: any) {
      // Clean up temp file on error
      await fs.unlink(tempFile).catch(() => {});
      console.error('[D1Wrapper] Wrangler CLI error:', error);
      throw new Error(`D1 query failed: ${error.message}`);
    }
  }

  async raw<T = unknown>(): Promise<T[]> {
    const result = await this.run<T>();
    return result.results || [];
  }
}

/**
 * Get D1 database instance
 * Tries native binding first, falls back to Wrangler CLI if USE_REMOTE_D1=true
 */
export async function getD1Database(): Promise<D1Database | null> {
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

  // If no native binding and USE_REMOTE_D1 is enabled, use Wrangler CLI
  if (USE_REMOTE_D1) {
    console.log('[D1Wrapper] Using Wrangler CLI for remote D1 access');
    return new D1Wrapper(null, true);
  }

  console.warn('[D1Wrapper] No D1 binding available and USE_REMOTE_D1 is not enabled');
  return null;
}

