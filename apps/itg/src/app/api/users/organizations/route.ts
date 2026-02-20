export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { D1Database } from '../../../../lib/db';
import { getD1Database } from '../../../../lib/d1-wrapper';

/**
 * GET /api/users/organizations?email=... or ?eoa=...
 * POST /api/users/organizations - Associate user with an organization (by email or EOA)
 */
async function getDB(): Promise<D1Database | null> {
  // Use the D1 wrapper which handles both native binding and Wrangler CLI fallback
  return await getD1Database();
}

export async function GET(request: NextRequest) {
  try {
    console.log('[users/organizations] GET request received');
    const searchParams = request.nextUrl.searchParams;
    const email = searchParams.get('email');
    const eoa = searchParams.get('eoa');

    if (!email && !eoa) {
      return NextResponse.json(
        { error: 'Either email or eoa parameter is required' },
        { status: 400 }
      );
    }

    console.log('[users/organizations] Getting database connection...');
    const db = await getDB();
    if (!db) {
      console.error('[users/organizations] Database not available');
      const useRemote = process.env.USE_REMOTE_D1 === 'true';
      return NextResponse.json(
        { 
          error: 'Database not available',
          message: useRemote 
            ? 'D1 database remote access requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables. Set USE_REMOTE_D1=true and provide Cloudflare credentials.'
            : 'D1 database binding is not configured. Set USE_REMOTE_D1=true in .env.local with CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or use "wrangler pages dev .next" for local development.',
          setupInstructions: {
            remoteAccess: 'Set in .env.local: USE_REMOTE_D1=true, CLOUDFLARE_ACCOUNT_ID=..., CLOUDFLARE_API_TOKEN=...',
            localDev: 'Run: pnpm build && wrangler pages dev .next',
            production: 'Deploy to Cloudflare Pages - DB binding is automatic'
          }
        },
        { status: 500 }
      );
    }
    console.log('[users/organizations] Database connection obtained');

    const cleanedEmail =
      typeof email === "string" && email && email !== "unknown@example.com" ? email : null;
    const cleanedEoa =
      typeof eoa === "string" && /^0x[a-fA-F0-9]{40}$/.test(eoa) ? eoa : null;

    // Get individual ID
    const individual = cleanedEoa
      ? await db.prepare('SELECT id FROM individuals WHERE eoa_address = ?').bind(cleanedEoa).first<{ id: number }>()
      : cleanedEmail
        ? await db.prepare('SELECT id FROM individuals WHERE email = ?').bind(cleanedEmail).first<{ id: number }>()
        : null;

    if (!individual) {
      return NextResponse.json({ organizations: [] });
    }

    // Get all organizations for this individual
    const associations = await db.prepare(
      `SELECT o.*, io.is_primary, io.role
       FROM individual_organizations io
       JOIN organizations o ON io.organization_id = o.id
       WHERE io.individual_id = ?
       ORDER BY io.is_primary DESC, io.created_at ASC`
    ).bind(individual.id).all<{
      id: number;
      ens_name: string;
      agent_name: string;
      org_name: string | null;
      org_address: string | null;
      org_type: string | null;
      email_domain: string;
      agent_account: string | null;
      chain_id: number;
      is_primary: number; // SQLite stores boolean as 0/1
      role: string | null;
    }>();

    const organizations = (associations.results || []).map((row) => ({
      ens_name: row.ens_name,
      agent_name: row.agent_name,
      org_name: row.org_name,
      org_address: row.org_address,
      org_type: row.org_type,
      email_domain: row.email_domain,
      agent_account: row.agent_account,
      chain_id: row.chain_id,
      is_primary: row.is_primary === 1,
      role: row.role,
    }));

    return NextResponse.json({ organizations });
  } catch (error) {
    console.error('[users/organizations] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get user organizations',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('[users/organizations] POST request received');
    const body = await request.json();
    const {
      email,
      eoa_address,
      ens_name,
      agent_name,
      org_name,
      org_address,
      org_type,
      email_domain,
      agent_account,
      chain_id,
      is_primary,
      role,
    } = body;

    const cleanedEmail =
      typeof email === "string" && email && email !== "unknown@example.com" ? email : null;
    const cleanedEoa =
      typeof eoa_address === "string" && /^0x[a-fA-F0-9]{40}$/.test(eoa_address) ? eoa_address : null;

    if ((!cleanedEmail && !cleanedEoa) || !ens_name || !agent_name || !email_domain) {
      return NextResponse.json(
        { error: 'Missing required fields: (email or eoa_address), ens_name, agent_name, email_domain' },
        { status: 400 }
      );
    }

    console.log('[users/organizations] Getting database connection...');
    const db = await getDB();
    if (!db) {
      console.error('[users/organizations] Database not available');
      const useRemote = process.env.USE_REMOTE_D1 === 'true';
      return NextResponse.json(
        { 
          error: 'Database not available',
          message: useRemote 
            ? 'D1 database remote access requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables. Set USE_REMOTE_D1=true and provide Cloudflare credentials.'
            : 'D1 database binding is not configured. Set USE_REMOTE_D1=true in .env.local with CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or use "wrangler pages dev .next" for local development.',
          setupInstructions: {
            remoteAccess: 'Set in .env.local: USE_REMOTE_D1=true, CLOUDFLARE_ACCOUNT_ID=..., CLOUDFLARE_API_TOKEN=...',
            localDev: 'Run: pnpm build && wrangler pages dev .next',
            production: 'Deploy to Cloudflare Pages - DB binding is automatic'
          }
        },
        { status: 500 }
      );
    }
    console.log('[users/organizations] Database connection obtained');

    // Get or create individual
    let individual = cleanedEoa
      ? await db.prepare('SELECT id FROM individuals WHERE eoa_address = ?').bind(cleanedEoa).first<{ id: number }>()
      : await db.prepare('SELECT id FROM individuals WHERE email = ?').bind(cleanedEmail).first<{ id: number }>();

    if (!individual) {
      // Create individual if it doesn't exist
      const now = Math.floor(Date.now() / 1000);
      const insertResult = await db.prepare(
        'INSERT INTO individuals (email, eoa_address, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).bind(cleanedEmail, cleanedEoa, now, now).run();
      
      individual = { id: Number(insertResult.meta.last_row_id) };
    }

    // Get or create organization
    let organization = await db.prepare(
      'SELECT id FROM organizations WHERE ens_name = ?'
    ).bind(ens_name).first<{ id: number }>();

    if (!organization) {
      // Create organization if it doesn't exist
      const now = Math.floor(Date.now() / 1000);
      const resolvedChainId = chain_id || 11155111;
      
      const insertResult = await db.prepare(
        `INSERT INTO organizations 
         (ens_name, agent_name, org_name, org_address, org_type, email_domain, 
          agent_account, chain_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        ens_name,
        agent_name,
        org_name || null,
        org_address || null,
        org_type || null,
        email_domain,
        agent_account || null,
        resolvedChainId,
        now,
        now
      ).run();

      organization = { id: Number(insertResult.meta.last_row_id) };
    } else {
      // Update organization if it exists
      const now = Math.floor(Date.now() / 1000);
      await db.prepare(
        `UPDATE organizations 
         SET agent_name = ?, org_name = ?, org_address = ?, org_type = ?, 
             agent_account = ?, updated_at = ?
         WHERE ens_name = ?`
      ).bind(
        agent_name,
        org_name || null,
        org_address || null,
        org_type || null,
        agent_account || null,
        now,
        ens_name
      ).run();
    }

    // Check if association already exists
    const existingAssociation = await db.prepare(
      'SELECT id FROM individual_organizations WHERE individual_id = ? AND organization_id = ?'
    ).bind(individual.id, organization.id).first<{ id: number }>();

    const now = Math.floor(Date.now() / 1000);

    if (existingAssociation) {
      // Update existing association
      await db.prepare(
        `UPDATE individual_organizations 
         SET is_primary = ?, role = ?, updated_at = ?
         WHERE individual_id = ? AND organization_id = ?`
      ).bind(
        is_primary ? 1 : 0,
        role || null,
        now,
        individual.id,
        organization.id
      ).run();
    } else {
      // Create new association
      await db.prepare(
        `INSERT INTO individual_organizations 
         (individual_id, organization_id, is_primary, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        individual.id,
        organization.id,
        is_primary ? 1 : 0,
        role || null,
        now,
        now
      ).run();
    }

    // If this is marked as primary, unset other primary associations for this individual
    if (is_primary) {
      await db.prepare(
        `UPDATE individual_organizations 
         SET is_primary = 0, updated_at = ?
         WHERE individual_id = ? AND organization_id != ?`
      ).bind(now, individual.id, organization.id).run();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[users/organizations] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to associate user with organization',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

