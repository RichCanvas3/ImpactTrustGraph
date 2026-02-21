export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { D1Database } from '../../../../lib/db';
import { getD1Database } from '../../../../lib/d1-wrapper';

/**
 * GET /api/users/organizations?individualId=... or ?eoa=... or ?email=...
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
    if (!existing.has("agent_card_json")) {
      try {
        await db.prepare("ALTER TABLE organizations ADD COLUMN agent_card_json TEXT").run();
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
    const individualIdParam = searchParams.get('individualId') ?? searchParams.get('individual_id');
    const email = searchParams.get('email');
    const eoa = searchParams.get('eoa');

    if (!individualIdParam && !email && !eoa) {
      return NextResponse.json(
        { error: 'Either individualId, email, or eoa parameter is required' },
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

    const individualIdFromParam =
      individualIdParam && /^\d+$/.test(String(individualIdParam).trim())
        ? Number.parseInt(String(individualIdParam).trim(), 10)
        : null;
    const cleanedEmail =
      typeof email === "string" && email && email !== "unknown@example.com" ? email : null;
    const cleanedEoa =
      typeof eoa === "string" && /^0x[a-fA-F0-9]{40}$/.test(eoa) ? eoa.toLowerCase() : null;

    // Resolve individual ID: prefer param, then eoa, then email
    let individual: { id: number } | null = null;
    if (typeof individualIdFromParam === "number" && individualIdFromParam > 0) {
      const row = await db.prepare('SELECT id FROM individuals WHERE id = ?').bind(individualIdFromParam).first<{ id: number }>();
      individual = row ? { id: row.id } : null;
    }
    if (!individual && cleanedEoa) {
      const row = await db.prepare('SELECT id FROM individuals WHERE lower(eoa_address) = ?').bind(cleanedEoa).first<{ id: number }>();
      individual = row ? { id: row.id } : null;
    }
    if (!individual && cleanedEmail) {
      const row = await db.prepare('SELECT id FROM individuals WHERE email = ?').bind(cleanedEmail).first<{ id: number }>();
      individual = row ? { id: row.id } : null;
    }

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
      agent_card_json?: string | null;
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
      uaid: (row as any).uaid ?? null,
      agent_row_id: (row as any).agent_row_id ?? null,
      session_package: (row as any).session_package ?? null,
      agent_card_json: (row as any).agent_card_json ?? null,
      org_metadata: (row as any).org_metadata ?? null,
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
      individualId,
      individual_id,
      email,
      eoa_address,
      ens_name,
      agent_name,
      org_name,
      org_address,
      org_type,
      email_domain,
      uaid,
      session_package,
      agent_card_json,
      org_metadata,
      is_primary,
      role,
    } = body;

    const individualIdFromBody =
      (typeof individualId === "number" && Number.isFinite(individualId) && individualId > 0
        ? individualId
        : typeof individualId === "string" && /^\d+$/.test(individualId.trim())
          ? Number.parseInt(individualId.trim(), 10)
          : typeof individual_id === "number" && Number.isFinite(individual_id) && individual_id > 0
            ? individual_id
            : typeof individual_id === "string" && /^\d+$/.test(individual_id.trim())
              ? Number.parseInt(individual_id.trim(), 10)
              : null);

    const cleanedEmail =
      typeof email === "string" && email && email !== "unknown@example.com" ? email : null;
    const cleanedEoa =
      typeof eoa_address === "string" && /^0x[a-fA-F0-9]{40}$/.test(eoa_address) ? eoa_address : null;
    let uaidValue = typeof uaid === "string" && uaid.trim() ? uaid.trim() : null;

    // Best-effort UAID hydration (canonical). Accept UAID from agent_card_json if present.
    if (!uaidValue && typeof agent_card_json === "string" && agent_card_json.trim()) {
      try {
        const parsed = JSON.parse(agent_card_json);
        const candidate =
          typeof parsed?.uaid === "string"
            ? parsed.uaid
            : typeof parsed?.agent?.uaid === "string"
              ? parsed.agent.uaid
              : null;
        if (candidate && String(candidate).trim()) uaidValue = String(candidate).trim();
      } catch {
        // ignore
      }
    }

    if (!individualIdFromBody || !ens_name || !agent_name || !uaidValue) {
      return NextResponse.json(
        { error: 'Missing required fields: (individualId), ens_name, agent_name, uaid' },
        { status: 400 }
      );
    }

    // We do not derive this from email. Keep a stable placeholder for legacy NOT NULL schema.
    const resolvedEmailDomain =
      typeof email_domain === "string" && email_domain.trim() ? email_domain.trim().toLowerCase() : "unknown";

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

    // Resolve individual (individualId path is strict: must already exist)
    let individual: { id: number } | null = null;
    if (typeof individualIdFromBody === "number" && individualIdFromBody > 0) {
      const row = await db.prepare("SELECT id FROM individuals WHERE id = ?").bind(individualIdFromBody).first<{ id: number }>();
      if (!row?.id) {
        return NextResponse.json({ error: "Invalid individualId (individual not found)" }, { status: 400 });
      }
      individual = { id: row.id };
    } else {
      // Legacy path: resolve by eoa/email (may create the individual if missing)
      individual = cleanedEoa
        ? await db.prepare('SELECT id FROM individuals WHERE eoa_address = ?').bind(cleanedEoa).first<{ id: number }>()
        : await db.prepare('SELECT id FROM individuals WHERE email = ?').bind(cleanedEmail).first<{ id: number }>();

      if (!individual) {
        const now = Math.floor(Date.now() / 1000);
        const insertResult = await db.prepare(
          'INSERT INTO individuals (email, eoa_address, created_at, updated_at) VALUES (?, ?, ?, ?)'
        ).bind(cleanedEmail, cleanedEoa, now, now).run();
        
        individual = { id: Number(insertResult.meta.last_row_id) };
      }
    }

    // Get or create organization
    let organization = await db.prepare(
      'SELECT id FROM organizations WHERE ens_name = ?'
    ).bind(ens_name).first<{ id: number }>();

    if (!organization) {
      // Create organization if it doesn't exist
      const now = Math.floor(Date.now() / 1000);

      // Upsert canonical agents row (UAID-only) and capture id for FK.
      let agentRowId: number | null = null;
      try {
        const existingAgent = await db
          .prepare("SELECT id FROM agents WHERE uaid = ?")
          .bind(uaidValue)
          .first<{ id: number }>();
        if (existingAgent?.id) {
          await db.prepare(
            `UPDATE agents
             SET uaid = ?,
                 ens_name = COALESCE(?, ens_name),
                 agent_name = COALESCE(?, agent_name),
                 email_domain = COALESCE(?, email_domain),
                 session_package = COALESCE(?, session_package),
                 agent_card_json = COALESCE(?, agent_card_json),
                 updated_at = ?
             WHERE id = ?`,
          ).bind(
            uaidValue,
            ens_name,
            agent_name,
            resolvedEmailDomain,
            typeof session_package === "string" ? session_package : null,
            typeof agent_card_json === "string" ? agent_card_json : null,
            now,
            existingAgent.id,
          ).run();
          agentRowId = existingAgent.id;
        } else {
          const ins = await db.prepare(
            `INSERT INTO agents
             (uaid, ens_name, agent_name, email_domain, session_package, agent_card_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            uaidValue,
            ens_name,
            agent_name,
            resolvedEmailDomain,
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
          uaid, agent_row_id, session_package, agent_card_json, org_metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        ens_name,
        agent_name,
        org_name || null,
        org_address || null,
        org_type || null,
        resolvedEmailDomain,
        uaidValue,
        agentRowId,
        typeof session_package === "string" ? session_package : null,
        typeof agent_card_json === "string" ? agent_card_json : null,
        typeof org_metadata === "string" ? org_metadata : null,
        now,
        now,
      ).run();

      organization = { id: Number(insertResult.meta.last_row_id) };
    } else {
      // Update organization if it exists
      const now = Math.floor(Date.now() / 1000);

      // Upsert canonical agents row (UAID-only) and capture id for FK.
      let agentRowId: number | null = null;
      try {
        const existingAgent = await db
          .prepare("SELECT id FROM agents WHERE uaid = ?")
          .bind(uaidValue)
          .first<{ id: number }>();
        if (existingAgent?.id) {
          await db.prepare(
            `UPDATE agents
             SET uaid = ?,
                 ens_name = COALESCE(?, ens_name),
                 agent_name = COALESCE(?, agent_name),
                 email_domain = COALESCE(?, email_domain),
                 session_package = COALESCE(?, session_package),
                 agent_card_json = COALESCE(?, agent_card_json),
                 updated_at = ?
             WHERE id = ?`,
          ).bind(
            uaidValue,
            ens_name,
            agent_name,
            resolvedEmailDomain,
            typeof session_package === "string" ? session_package : null,
            typeof agent_card_json === "string" ? agent_card_json : null,
            now,
            existingAgent.id,
          ).run();
          agentRowId = existingAgent.id;
        } else {
          const ins = await db.prepare(
            `INSERT INTO agents
             (uaid, ens_name, agent_name, email_domain, session_package, agent_card_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            uaidValue,
            ens_name,
            agent_name,
            resolvedEmailDomain,
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
             uaid = ?, agent_row_id = COALESCE(?, agent_row_id),
             session_package = COALESCE(?, session_package),
             agent_card_json = COALESCE(?, agent_card_json),
             org_metadata = COALESCE(?, org_metadata), updated_at = ?
         WHERE ens_name = ?`,
      ).bind(
        agent_name,
        org_name || null,
        org_address || null,
        org_type || null,
        uaidValue,
        agentRowId,
        typeof session_package === "string" ? session_package : null,
        typeof agent_card_json === "string" ? agent_card_json : null,
        typeof org_metadata === "string" ? org_metadata : null,
        now,
        ens_name,
      ).run();
    }

    // Self-heal: if the individual already has a participant UAID, ensure it's present in agents.
    try {
      const p = await db
        .prepare("SELECT participant_uaid, participant_ens_name, participant_agent_name FROM individuals WHERE id = ?")
        .bind(individual.id)
        .first<{ participant_uaid: string | null; participant_ens_name: string | null; participant_agent_name: string | null }>();
      const pUaid = typeof p?.participant_uaid === "string" && p.participant_uaid.trim() ? p.participant_uaid.trim() : null;
      if (pUaid) {
        const existing = await db.prepare("SELECT id FROM agents WHERE uaid = ?").bind(pUaid).first<{ id: number }>();
        const nowTs = Math.floor(Date.now() / 1000);
        if (existing?.id) {
          await db.prepare(
            `UPDATE agents
             SET uaid = ?,
                 ens_name = COALESCE(?, ens_name),
                 agent_name = COALESCE(?, agent_name),
                 updated_at = ?
             WHERE id = ?`,
          ).bind(
            pUaid,
            p?.participant_ens_name ?? null,
            p?.participant_agent_name ?? null,
            nowTs,
            existing.id,
          ).run();
        } else {
          await db.prepare(
            `INSERT INTO agents
             (uaid, ens_name, agent_name, email_domain, session_package, agent_card_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
          ).bind(
            pUaid,
            p?.participant_ens_name ?? null,
            p?.participant_agent_name ?? null,
            "unknown",
            nowTs,
            nowTs,
          ).run();
        }
      }
    } catch (e) {
      console.warn("[users/organizations] Failed to self-heal participant agent into agents table:", e);
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

