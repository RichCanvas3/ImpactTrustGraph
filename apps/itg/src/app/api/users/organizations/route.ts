export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { D1Database } from '../../../../lib/db';
import { getD1Database } from '../../../../lib/d1-wrapper';
import { canonicalizeUaid } from '../../../../lib/uaid';

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
    if (!existing.has("org_metadata")) {
      try {
        await db.prepare("ALTER TABLE organizations ADD COLUMN org_metadata TEXT").run();
      } catch {
        // ignore
      }
    }

    // Multi-role org tagging table (idempotent)
    try {
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS organization_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            UNIQUE(organization_id, role)
          );`,
        )
        .run();
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_organization_roles_org ON organization_roles(organization_id)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_organization_roles_role ON organization_roles(role)").run();
    } catch {
      // ignore
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
      email_domain: string;
      is_primary: number; // SQLite stores boolean as 0/1
      role: string | null;
    }>();

    const organizations = (associations.results || []).map((row) => ({
      id: row.id,
      ens_name: row.ens_name,
      agent_name: row.agent_name,
      org_name: row.org_name,
      org_address: row.org_address,
      email_domain: row.email_domain,
      uaid: (row as any).uaid ?? null,
      agent_row_id: (row as any).agent_row_id ?? null,
      session_package: (row as any).session_package ?? null,
      org_metadata: (row as any).org_metadata ?? null,
      is_primary: row.is_primary === 1,
      role: row.role,
    }));

    // Attach org_roles[] (best-effort)
    const orgIds = organizations
      .map((o) => (typeof o.id === "number" ? o.id : null))
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    const rolesByOrgId = new Map<number, string[]>();
    if (orgIds.length) {
      try {
        const roleRows = await db
          .prepare(
            `SELECT organization_id, role
             FROM organization_roles
             WHERE organization_id IN (${orgIds.map(() => "?").join(",")})`,
          )
          .bind(...orgIds)
          .all<{ organization_id: number; role: string }>();
        for (const r of roleRows.results || []) {
          const id = Number(r.organization_id);
          const roleValue = typeof r.role === "string" ? r.role : "";
          if (!Number.isFinite(id) || !roleValue) continue;
          const arr = rolesByOrgId.get(id) ?? [];
          arr.push(roleValue);
          rolesByOrgId.set(id, arr);
        }
      } catch {
        // ignore
      }
    }

    return NextResponse.json({
      organizations: organizations.map((o) => ({
        ...o,
        org_roles: typeof o.id === "number" ? rolesByOrgId.get(o.id) ?? [] : [],
      })),
    });
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
      org_roles,
      email_domain,
      uaid,
      session_package,
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
    const uaidValue = typeof uaid === "string" && uaid.trim() ? uaid.trim() : null;
    const uaidCanonical = canonicalizeUaid(uaidValue);

    if (!individualIdFromBody || !ens_name || !agent_name || !uaidValue || !uaidCanonical) {
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
        const existingAgentExact = await db
          .prepare("SELECT id FROM agents WHERE uaid = ?")
          .bind(uaidCanonical)
          .first<{ id: number }>();

        const existingAgent =
          existingAgentExact?.id
            ? existingAgentExact
            : await db
                .prepare(
                  `SELECT id FROM agents
                   WHERE ('uaid:' || lower(
                     CASE
                       WHEN instr(CASE WHEN uaid LIKE 'uaid:%' THEN substr(uaid, 6) ELSE uaid END, ';') > 0
                         THEN substr(CASE WHEN uaid LIKE 'uaid:%' THEN substr(uaid, 6) ELSE uaid END, 1,
                                     instr(CASE WHEN uaid LIKE 'uaid:%' THEN substr(uaid, 6) ELSE uaid END, ';') - 1)
                       ELSE CASE WHEN uaid LIKE 'uaid:%' THEN substr(uaid, 6) ELSE uaid END
                     END
                   )) = ?
                   ORDER BY updated_at DESC, id DESC
                   LIMIT 1`,
                )
                .bind(uaidCanonical)
                .first<{ id: number }>();
        if (existingAgent?.id) {
          await db.prepare(
            `UPDATE agents
             SET uaid = ?,
                 ens_name = CASE WHEN ens_name IS NULL OR ens_name = '' THEN ? ELSE ens_name END,
                 agent_name = CASE WHEN agent_name IS NULL OR agent_name = '' THEN ? ELSE agent_name END,
                 email_domain = CASE
                   WHEN email_domain IS NULL OR email_domain = '' OR lower(email_domain) = 'unknown' THEN ?
                   ELSE email_domain
                 END,
                 session_package = COALESCE(?, session_package),
                 updated_at = ?
             WHERE id = ?`,
          ).bind(
            uaidCanonical,
            ens_name,
            agent_name,
            resolvedEmailDomain,
            typeof session_package === "string" ? session_package : null,
            now,
            existingAgent.id,
          ).run();
          agentRowId = existingAgent.id;
        } else {
          const ins = await db.prepare(
            `INSERT INTO agents
             (uaid, ens_name, agent_name, email_domain, session_package, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            uaidCanonical,
            ens_name,
            agent_name,
            resolvedEmailDomain,
            typeof session_package === "string" ? session_package : null,
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
         (ens_name, agent_name, org_name, org_address, email_domain, 
          uaid, agent_row_id, session_package, org_metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        ens_name,
        agent_name,
        org_name || null,
        org_address || null,
        resolvedEmailDomain,
        uaidCanonical,
        agentRowId,
        typeof session_package === "string" ? session_package : null,
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
        const existingAgentExact = await db
          .prepare("SELECT id FROM agents WHERE uaid = ?")
          .bind(uaidCanonical)
          .first<{ id: number }>();

        const existingAgent =
          existingAgentExact?.id
            ? existingAgentExact
            : await db
                .prepare(
                  `SELECT id FROM agents
                   WHERE ('uaid:' || lower(
                     CASE
                       WHEN instr(CASE WHEN uaid LIKE 'uaid:%' THEN substr(uaid, 6) ELSE uaid END, ';') > 0
                         THEN substr(CASE WHEN uaid LIKE 'uaid:%' THEN substr(uaid, 6) ELSE uaid END, 1,
                                     instr(CASE WHEN uaid LIKE 'uaid:%' THEN substr(uaid, 6) ELSE uaid END, ';') - 1)
                       ELSE CASE WHEN uaid LIKE 'uaid:%' THEN substr(uaid, 6) ELSE uaid END
                     END
                   )) = ?
                   ORDER BY updated_at DESC, id DESC
                   LIMIT 1`,
                )
                .bind(uaidCanonical)
                .first<{ id: number }>();
        if (existingAgent?.id) {
          await db.prepare(
            `UPDATE agents
             SET uaid = ?,
                 ens_name = CASE WHEN ens_name IS NULL OR ens_name = '' THEN ? ELSE ens_name END,
                 agent_name = CASE WHEN agent_name IS NULL OR agent_name = '' THEN ? ELSE agent_name END,
                 email_domain = CASE
                   WHEN email_domain IS NULL OR email_domain = '' OR lower(email_domain) = 'unknown' THEN ?
                   ELSE email_domain
                 END,
                 session_package = COALESCE(?, session_package),
                 updated_at = ?
             WHERE id = ?`,
          ).bind(
            uaidCanonical,
            ens_name,
            agent_name,
            resolvedEmailDomain,
            typeof session_package === "string" ? session_package : null,
            now,
            existingAgent.id,
          ).run();
          agentRowId = existingAgent.id;
        } else {
          const ins = await db.prepare(
            `INSERT INTO agents
             (uaid, ens_name, agent_name, email_domain, session_package, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            uaidCanonical,
            ens_name,
            agent_name,
            resolvedEmailDomain,
            typeof session_package === "string" ? session_package : null,
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
         SET agent_name = ?, org_name = ?, org_address = ?, 
             uaid = ?, agent_row_id = COALESCE(?, agent_row_id),
             session_package = COALESCE(?, session_package),
             org_metadata = COALESCE(?, org_metadata), updated_at = ?
         WHERE ens_name = ?`,
      ).bind(
        agent_name,
        org_name || null,
        org_address || null,
        uaidCanonical,
        agentRowId,
        typeof session_package === "string" ? session_package : null,
        typeof org_metadata === "string" ? org_metadata : null,
        now,
        ens_name,
      ).run();
    }

    // Persist organization roles (best-effort, optional)
    // IMPORTANT: only replace roles when `org_roles` is explicitly provided.
    if (Array.isArray(org_roles)) {
      try {
        const allowedRoles = new Set(["coalition", "contributor", "funding", "member"]);
        const incomingRoles = (org_roles
          .map((r) => (typeof r === "string" ? r.trim().toLowerCase() : ""))
          .filter((r) => allowedRoles.has(r)) as string[]);
        await db.prepare("DELETE FROM organization_roles WHERE organization_id = ?").bind(organization.id).run();
        const nowTs = Math.floor(Date.now() / 1000);
        for (const r of incomingRoles) {
          try {
            await db
              .prepare(
                `INSERT OR IGNORE INTO organization_roles (organization_id, role, created_at, updated_at)
                 VALUES (?, ?, ?, ?)`,
              )
              .bind(organization.id, r, nowTs, nowTs)
              .run();
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }

    // Self-heal: if the individual already has a participant UAID, ensure it's present in agents.
    try {
      const p = await db
        .prepare("SELECT participant_uaid, participant_ens_name, participant_agent_name FROM individuals WHERE id = ?")
        .bind(individual.id)
        .first<{ participant_uaid: string | null; participant_ens_name: string | null; participant_agent_name: string | null }>();
      const pUaid = typeof p?.participant_uaid === "string" && p.participant_uaid.trim() ? p.participant_uaid.trim() : null;
      const pUaidCanonical = canonicalizeUaid(pUaid);
      if (pUaid && pUaidCanonical) {
        const existing = await db.prepare("SELECT id FROM agents WHERE uaid = ?").bind(pUaidCanonical).first<{ id: number }>();
        const nowTs = Math.floor(Date.now() / 1000);
        if (existing?.id) {
          await db.prepare(
            `UPDATE agents
             SET uaid = ?,
                 ens_name = CASE WHEN ens_name IS NULL OR ens_name = '' THEN ? ELSE ens_name END,
                 agent_name = CASE WHEN agent_name IS NULL OR agent_name = '' THEN ? ELSE agent_name END,
                 updated_at = ?
             WHERE id = ?`,
          ).bind(
            pUaidCanonical,
            p?.participant_ens_name ?? null,
            p?.participant_agent_name ?? null,
            nowTs,
            existing.id,
          ).run();
        } else {
          await db.prepare(
            `INSERT INTO agents
             (uaid, ens_name, agent_name, email_domain, session_package, created_at, updated_at)
             VALUES (?, ?, ?, ?, NULL, ?, ?)`,
          ).bind(
            pUaidCanonical,
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

