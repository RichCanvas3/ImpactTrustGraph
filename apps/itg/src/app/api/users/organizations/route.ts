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

let ensureOrganizationsSchemaPromise: Promise<void> | null = null;
async function ensureOrganizationsSchema(db: D1Database) {
  if (ensureOrganizationsSchemaPromise) return ensureOrganizationsSchemaPromise;
  ensureOrganizationsSchemaPromise = (async () => {
    const info = await db.prepare("PRAGMA table_info(organizations)").all<{ name: string }>();
    const existing = new Set((info.results || []).map((c) => c.name));
    if (!existing.has("uaid")) {
      try {
        await db.prepare("ALTER TABLE organizations ADD COLUMN uaid TEXT").run();
      } catch {
        // ignore
      }
    }
    if (!existing.has("agent_row_id")) {
      try {
        await db.prepare("ALTER TABLE organizations ADD COLUMN agent_row_id INTEGER").run();
      } catch {
        // ignore
      }
    }
    if (!existing.has("session_package")) {
      try {
        await db.prepare("ALTER TABLE organizations ADD COLUMN session_package TEXT").run();
      } catch {
        // ignore
      }
    }
    if (!existing.has("org_metadata")) {
      try {
        await db.prepare("ALTER TABLE organizations ADD COLUMN org_metadata TEXT").run();
      } catch {
        // ignore
      }
    }
  })();
  return ensureOrganizationsSchemaPromise;
}

let ensureAgentsSchemaPromise: Promise<void> | null = null;
async function ensureAgentsSchema(db: D1Database) {
  if (ensureAgentsSchemaPromise) return ensureAgentsSchemaPromise;
  ensureAgentsSchemaPromise = (async () => {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uaid TEXT UNIQUE,
        ens_name TEXT,
        agent_name TEXT,
        email_domain TEXT,
        agent_account TEXT,
        chain_id INTEGER NOT NULL DEFAULT 11155111,
        session_package TEXT,
        agent_card_json TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );`,
    ).run();
    try {
      await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_uaid_unique ON agents(uaid) WHERE uaid IS NOT NULL").run();
    } catch {
      // ignore
    }
  })();
  return ensureAgentsSchemaPromise;
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
    await ensureOrganizationsSchema(db);

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
      agent_card_json?: string | null;
      chain_id: number;
      is_primary: number; // SQLite stores boolean as 0/1
      role: string | null;
    }>();

    const organizations = (associations.results || []).map((row) => ({
      id: row.id,
      ens_name: row.ens_name,
      agent_name: row.agent_name,
      org_name: row.org_name,
      org_address: row.org_address,
      org_type: row.org_type,
      email_domain: row.email_domain,
      agent_account: row.agent_account,
      uaid: (row as any).uaid ?? null,
      agent_row_id: (row as any).agent_row_id ?? null,
      session_package: (row as any).session_package ?? null,
      agent_card_json: (row as any).agent_card_json ?? null,
      org_metadata: (row as any).org_metadata ?? null,
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
      uaid,
      session_package,
      agent_card_json,
      org_metadata,
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
    await ensureAgentsSchema(db);
    await ensureOrganizationsSchema(db);

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

      // Upsert canonical agents row (best-effort) and capture id for FK.
      let agentRowId: number | null = null;
      try {
        const existingAgent = typeof uaid === "string" && uaid
          ? await db.prepare("SELECT id FROM agents WHERE uaid = ?").bind(uaid).first<{ id: number }>()
          : await db.prepare("SELECT id FROM agents WHERE ens_name = ? AND chain_id = ?").bind(ens_name, resolvedChainId).first<{ id: number }>();
        if (existingAgent?.id) {
          await db.prepare(
            `UPDATE agents
             SET uaid = COALESCE(?, uaid),
                 ens_name = COALESCE(?, ens_name),
                 agent_name = COALESCE(?, agent_name),
                 email_domain = COALESCE(?, email_domain),
                 agent_account = COALESCE(?, agent_account),
                 chain_id = COALESCE(?, chain_id),
                 session_package = COALESCE(?, session_package),
                 agent_card_json = COALESCE(?, agent_card_json),
                 updated_at = ?
             WHERE id = ?`,
          ).bind(
            typeof uaid === "string" ? uaid : null,
            ens_name,
            agent_name,
            email_domain,
            agent_account || null,
            resolvedChainId,
            typeof session_package === "string" ? session_package : null,
            typeof agent_card_json === "string" ? agent_card_json : null,
            now,
            existingAgent.id,
          ).run();
          agentRowId = existingAgent.id;
        } else {
          const ins = await db.prepare(
            `INSERT INTO agents
             (uaid, ens_name, agent_name, email_domain, agent_account, chain_id, session_package, agent_card_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            typeof uaid === "string" ? uaid : null,
            ens_name,
            agent_name,
            email_domain,
            agent_account || null,
            resolvedChainId,
            typeof session_package === "string" ? session_package : null,
            typeof agent_card_json === "string" ? agent_card_json : null,
            now,
            now,
          ).run();
          agentRowId = Number(ins.meta.last_row_id);
        }
      } catch (e) {
        console.warn("[users/organizations] Failed to upsert agents row:", e);
      }
      
      const insertResult = await db.prepare(
        `INSERT INTO organizations 
         (ens_name, agent_name, org_name, org_address, org_type, email_domain, 
          agent_account, uaid, agent_row_id, chain_id, session_package, org_metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        ens_name,
        agent_name,
        org_name || null,
        org_address || null,
        org_type || null,
        email_domain,
        agent_account || null,
        typeof uaid === "string" ? uaid : null,
        agentRowId,
        resolvedChainId,
        typeof session_package === "string" ? session_package : null,
        typeof org_metadata === "string" ? org_metadata : null,
        now,
        now
      ).run();

      organization = { id: Number(insertResult.meta.last_row_id) };
    } else {
      // Update organization if it exists
      const now = Math.floor(Date.now() / 1000);

      // Upsert canonical agents row (best-effort) and capture id for FK.
      let agentRowId: number | null = null;
      try {
        const resolvedChainId = chain_id || 11155111;
        const existingAgent = typeof uaid === "string" && uaid
          ? await db.prepare("SELECT id FROM agents WHERE uaid = ?").bind(uaid).first<{ id: number }>()
          : await db.prepare("SELECT id FROM agents WHERE ens_name = ? AND chain_id = ?").bind(ens_name, resolvedChainId).first<{ id: number }>();
        if (existingAgent?.id) {
          await db.prepare(
            `UPDATE agents
             SET uaid = COALESCE(?, uaid),
                 ens_name = COALESCE(?, ens_name),
                 agent_name = COALESCE(?, agent_name),
                 email_domain = COALESCE(?, email_domain),
                 agent_account = COALESCE(?, agent_account),
                 chain_id = COALESCE(?, chain_id),
                 session_package = COALESCE(?, session_package),
                 agent_card_json = COALESCE(?, agent_card_json),
                 updated_at = ?
             WHERE id = ?`,
          ).bind(
            typeof uaid === "string" ? uaid : null,
            ens_name,
            agent_name,
            email_domain,
            agent_account || null,
            resolvedChainId,
            typeof session_package === "string" ? session_package : null,
            typeof agent_card_json === "string" ? agent_card_json : null,
            now,
            existingAgent.id,
          ).run();
          agentRowId = existingAgent.id;
        } else {
          const ins = await db.prepare(
            `INSERT INTO agents
             (uaid, ens_name, agent_name, email_domain, agent_account, chain_id, session_package, agent_card_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            typeof uaid === "string" ? uaid : null,
            ens_name,
            agent_name,
            email_domain,
            agent_account || null,
            resolvedChainId,
            typeof session_package === "string" ? session_package : null,
            typeof agent_card_json === "string" ? agent_card_json : null,
            now,
            now,
          ).run();
          agentRowId = Number(ins.meta.last_row_id);
        }
      } catch (e) {
        console.warn("[users/organizations] Failed to upsert agents row (update):", e);
      }

      await db.prepare(
        `UPDATE organizations 
         SET agent_name = ?, org_name = ?, org_address = ?, org_type = ?, 
             agent_account = ?, uaid = COALESCE(?, uaid), agent_row_id = COALESCE(?, agent_row_id),
             session_package = COALESCE(?, session_package),
             org_metadata = COALESCE(?, org_metadata), updated_at = ?
         WHERE ens_name = ?`
      ).bind(
        agent_name,
        org_name || null,
        org_address || null,
        org_type || null,
        agent_account || null,
        typeof uaid === "string" ? uaid : null,
        agentRowId,
        typeof session_package === "string" ? session_package : null,
        typeof org_metadata === "string" ? org_metadata : null,
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

