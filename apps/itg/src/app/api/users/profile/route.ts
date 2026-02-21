export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { D1Database } from '../../../../lib/db';
import { getD1Database } from '../../../../lib/d1-wrapper';

/**
 * GET /api/users/profile?email=... or ?eoa=...
 * POST /api/users/profile - Create or update user profile
 */
// Access database from Cloudflare runtime context or Wrangler CLI
async function getDB(request?: NextRequest): Promise<D1Database | null> {
  // Use the D1 wrapper which handles both native binding and Wrangler CLI fallback
  return await getD1Database();
}

let ensureIndividualsSchemaPromise: Promise<void> | null = null;

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

    // Add missing columns if table exists but is older.
    const info = await db.prepare("PRAGMA table_info(agents)").all<{ name: string }>();
    const existing = new Set((info.results || []).map((c) => c.name));
    const desired: Array<{ name: string; sql: string }> = [
      { name: "uaid", sql: "ALTER TABLE agents ADD COLUMN uaid TEXT" },
      { name: "ens_name", sql: "ALTER TABLE agents ADD COLUMN ens_name TEXT" },
      { name: "agent_name", sql: "ALTER TABLE agents ADD COLUMN agent_name TEXT" },
      { name: "email_domain", sql: "ALTER TABLE agents ADD COLUMN email_domain TEXT" },
      { name: "agent_account", sql: "ALTER TABLE agents ADD COLUMN agent_account TEXT" },
      { name: "chain_id", sql: "ALTER TABLE agents ADD COLUMN chain_id INTEGER NOT NULL DEFAULT 11155111" },
      { name: "session_package", sql: "ALTER TABLE agents ADD COLUMN session_package TEXT" },
      { name: "agent_card_json", sql: "ALTER TABLE agents ADD COLUMN agent_card_json TEXT" },
      { name: "created_at", sql: "ALTER TABLE agents ADD COLUMN created_at INTEGER NOT NULL DEFAULT (unixepoch())" },
      { name: "updated_at", sql: "ALTER TABLE agents ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (unixepoch())" },
    ];
    for (const col of desired) {
      if (existing.has(col.name)) continue;
      try {
        await db.prepare(col.sql).run();
      } catch {
        // ignore
      }
    }

    // Indexes (best-effort)
    try {
      await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_uaid_unique ON agents(uaid) WHERE uaid IS NOT NULL").run();
    } catch {
      // ignore
    }
    try {
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_agents_ens_name ON agents(ens_name)").run();
    } catch {
      // ignore
    }
  })();
  return ensureAgentsSchemaPromise;
}

function deriveEmailDomainFromEns(ensName: string | null | undefined): string | null {
  if (!ensName) return null;
  const n = String(ensName).trim().toLowerCase();
  if (!n.includes(".")) return null;
  const parts = n.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(-2).join(".");
}

async function ensureIndividualsSchema(db: D1Database) {
  if (ensureIndividualsSchemaPromise) return ensureIndividualsSchemaPromise;
  ensureIndividualsSchemaPromise = (async () => {
    const info = await db.prepare("PRAGMA table_info(individuals)").all<{
      name: string;
      notnull: number;
    }>();
    const cols = info.results || [];
    const existing = new Set(cols.map((c) => c.name));
    const emailCol = cols.find((c) => c.name === "email");

    // If the legacy schema has email NOT NULL, rebuild the table to allow null emails.
    if (emailCol?.notnull === 1) {
      try {
        await db.prepare("ALTER TABLE individuals RENAME TO individuals_legacy").run();
        await db.prepare(
          `CREATE TABLE IF NOT EXISTS individuals (
            id INTEGER PRIMARY KEY,
            email TEXT UNIQUE,
            role TEXT,
            first_name TEXT,
            last_name TEXT,
            phone_number TEXT,
            social_display_name TEXT,
            social_account_id TEXT,
            social_account_type TEXT,
            eoa_address TEXT,
            aa_address TEXT,
            participant_ens_name TEXT,
            participant_agent_name TEXT,
            participant_uaid TEXT,
            participant_agent_row_id INTEGER,
            participant_metadata TEXT,
            trust_tier TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          );`,
        ).run();

        await db.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS idx_individuals_eoa_unique ON individuals(eoa_address) WHERE eoa_address IS NOT NULL",
        ).run();

        await db.prepare(
          `INSERT INTO individuals (
            id,email,role,first_name,last_name,social_account_id,social_account_type,eoa_address,aa_address,
            participant_ens_name,participant_agent_name,participant_uaid,
            participant_agent_row_id,participant_metadata,trust_tier,
            created_at,updated_at
          )
          SELECT
            id,email,NULL as role,first_name,last_name,social_account_id,social_account_type,eoa_address,aa_address,
            participant_ens_name,participant_agent_name,
            NULL as participant_uaid,
            NULL as participant_agent_row_id,
            NULL as participant_metadata,
            NULL as trust_tier,
            created_at,updated_at
          FROM individuals_legacy;`,
        ).run();
      } catch (e) {
        console.warn("[users/profile] Failed to migrate individuals schema:", e);
      }
    }

    // Ensure new columns exist (for already-migrated DBs).
    const info2 = await db.prepare("PRAGMA table_info(individuals)").all<{ name: string }>();
    const existing2 = new Set((info2.results || []).map((c) => c.name));
    const desired: Array<{ name: string; sql: string }> = [
      { name: "role", sql: "ALTER TABLE individuals ADD COLUMN role TEXT" },
      { name: "phone_number", sql: "ALTER TABLE individuals ADD COLUMN phone_number TEXT" },
      { name: "social_display_name", sql: "ALTER TABLE individuals ADD COLUMN social_display_name TEXT" },
      { name: "participant_ens_name", sql: "ALTER TABLE individuals ADD COLUMN participant_ens_name TEXT" },
      { name: "participant_agent_name", sql: "ALTER TABLE individuals ADD COLUMN participant_agent_name TEXT" },
      { name: "participant_uaid", sql: "ALTER TABLE individuals ADD COLUMN participant_uaid TEXT" },
      { name: "participant_agent_row_id", sql: "ALTER TABLE individuals ADD COLUMN participant_agent_row_id INTEGER" },
      { name: "participant_metadata", sql: "ALTER TABLE individuals ADD COLUMN participant_metadata TEXT" },
      { name: "trust_tier", sql: "ALTER TABLE individuals ADD COLUMN trust_tier TEXT" },
    ];
    for (const col of desired) {
      if (existing2.has(col.name)) continue;
      try {
        await db.prepare(col.sql).run();
      } catch {
        // ignore
      }
    }
  })();

  return ensureIndividualsSchemaPromise;
}

export async function GET(request: NextRequest) {
  try {
    console.log('[users/profile] GET request received');
    const searchParams = request.nextUrl.searchParams;
    const email = searchParams.get('email');
    const eoa = searchParams.get('eoa') ?? searchParams.get('eoa_address');

    if (!email && !eoa) {
      return NextResponse.json(
        { error: 'Either email or eoa parameter is required' },
        { status: 400 }
      );
    }

    console.log('[users/profile] Getting database connection...');
    const db = await getDB(request);
    if (!db) {
      console.error('[users/profile] Database not available');
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

    await ensureIndividualsSchema(db);

    const cleanedEmail =
      typeof email === "string" && email && email !== "unknown@example.com" ? email : null;
    const cleanedEoa =
      typeof eoa === "string" && /^0x[a-fA-F0-9]{40}$/.test(eoa) ? eoa.toLowerCase() : null;

    let profile;
    if (cleanedEoa) {
      profile = await db
        .prepare('SELECT * FROM individuals WHERE lower(eoa_address) = ?')
        .bind(cleanedEoa)
        .first();
    } else if (cleanedEmail) {
      console.log('[users/profile] Getting profile by email:', cleanedEmail);
      profile = await db.prepare('SELECT * FROM individuals WHERE email = ?').bind(cleanedEmail).first();
    }

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ profile });
  } catch (error) {
    console.error('[users/profile] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get user profile',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('[users/profile] POST request received');
    const body = await request.json();
    console.log('[users/profile] Request body:', { 
      email: body.email, 
      hasEmail: !!body.email,
      hasEoa: !!body.eoa_address,
      hasAa: !!body.aa_address
    });
    const {
      email,
      role,
      first_name,
      last_name,
      phone_number,
      social_display_name,
      social_account_id,
      social_account_type,
      eoa_address,
      aa_address,
      participant_ens_name,
      participant_agent_name,
      participant_uaid,
      participant_metadata,
      trust_tier,
    } = body;

    const cleanedEmail =
      typeof email === "string" && email && email !== "unknown@example.com" ? email : null;
    const cleanedEoa =
      typeof eoa_address === "string" && /^0x[a-fA-F0-9]{40}$/.test(eoa_address) ? eoa_address.toLowerCase() : null;

    if (!cleanedEoa && !cleanedEmail) {
      return NextResponse.json(
        { error: 'Either eoa_address (preferred) or a real email is required' },
        { status: 400 },
      );
    }

    console.log('[users/profile] Getting database connection...');
    const db = await getDB(request);
    if (!db) {
      console.error('[users/profile] Database not available');
      console.error('[users/profile] process.env keys:', typeof process !== 'undefined' ? Object.keys(process.env || {}).filter(k => k.includes('DB') || k.includes('DATABASE')) : 'N/A');
      return NextResponse.json(
        { 
          error: 'Database not available',
          message: 'D1 database binding is not configured. For local development, use "wrangler pages dev .next" instead of "next dev". For production, deploy to Cloudflare Pages where the DB binding is automatically available.',
          setupInstructions: {
            localDev: 'Run: pnpm build && wrangler pages dev .next',
            production: 'Deploy to Cloudflare Pages - DB binding is automatic',
            alternative: 'Set USE_REMOTE_D1=true in .env.local and use Wrangler CLI'
          }
        },
        { status: 500 }
      );
    }
    console.log('[users/profile] Database connection obtained');
    await ensureAgentsSchema(db);
    await ensureIndividualsSchema(db);

    // Check if profile exists
    const existing = cleanedEoa
      ? await db
          .prepare('SELECT id FROM individuals WHERE eoa_address = ?')
          .bind(cleanedEoa)
          .first<{ id: number }>()
      : await db
          .prepare('SELECT id FROM individuals WHERE email = ?')
          .bind(cleanedEmail)
          .first<{ id: number }>();

    // Email can be absent (phone logins) or may conflict with an existing record.
    // If the provided email is already used by another individual, do NOT write it
    // (email remains nullable/optional; EOA is the primary key).
    let effectiveEmail: string | null = cleanedEmail;
    if (cleanedEmail) {
      const emailOwner = await db
        .prepare('SELECT id FROM individuals WHERE email = ?')
        .bind(cleanedEmail)
        .first<{ id: number }>();

      if (emailOwner?.id && (!existing?.id || emailOwner.id !== existing.id)) {
        console.warn('[users/profile] Email is already in use by another individual; skipping email update');
        effectiveEmail = null;
      }
    }

    const now = Math.floor(Date.now() / 1000);
    console.log('[users/profile] Profile exists:', !!existing);

    // Best-effort upsert participant agent row into agents table, returning agents.id.
    let participantAgentRowId: number | null = null;
    try {
      const ensName = typeof participant_ens_name === "string" ? participant_ens_name : null;
      const agentName = typeof participant_agent_name === "string" ? participant_agent_name : null;
      const uaid = typeof participant_uaid === "string" ? participant_uaid : null;

      const parsed = (() => {
        if (!uaid) return { chainId: null as number | null, agentAccount: null as string | null };
        const m = uaid.match(/did:ethr:(\d+):(0x[a-fA-F0-9]{40})/);
        if (!m) return { chainId: null as number | null, agentAccount: null as string | null };
        const chainId = Number.parseInt(m[1], 10);
        const agentAccount = String(m[2]).toLowerCase();
        return {
          chainId: Number.isFinite(chainId) ? chainId : null,
          agentAccount: /^0x[a-f0-9]{40}$/.test(agentAccount) ? agentAccount : null,
        };
      })();

      const emailDomain =
        (typeof cleanedEmail === "string" && cleanedEmail.includes("@") ? cleanedEmail.split("@")[1]?.toLowerCase() : null) ??
        deriveEmailDomainFromEns(ensName) ??
        null;

      // We only key participant agent identity by UAID.
      if (uaid) {
        const existingAgent = await db.prepare("SELECT id FROM agents WHERE uaid = ?").bind(uaid).first<{ id: number }>();

        if (existingAgent?.id) {
          await db.prepare(
            `UPDATE agents
             SET uaid = COALESCE(?, uaid),
                 ens_name = COALESCE(?, ens_name),
                 agent_name = COALESCE(?, agent_name),
                 email_domain = COALESCE(?, email_domain),
                 agent_account = COALESCE(?, agent_account),
                 chain_id = COALESCE(?, chain_id),
                 agent_card_json = COALESCE(?, agent_card_json),
                 updated_at = ?
             WHERE id = ?`,
          ).bind(
            uaid,
            ensName,
            agentName,
            emailDomain,
            parsed.agentAccount,
            parsed.chainId,
            null,
            now,
            existingAgent.id,
          ).run();
          participantAgentRowId = existingAgent.id;
        } else {
          const ins = await db.prepare(
            `INSERT INTO agents
             (uaid, ens_name, agent_name, email_domain, agent_account, chain_id, session_package, agent_card_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, COALESCE(?, 11155111), NULL, NULL, ?, ?)`,
          ).bind(
            uaid,
            ensName,
            agentName,
            emailDomain,
            parsed.agentAccount,
            parsed.chainId,
            now,
            now,
          ).run();
          participantAgentRowId = Number(ins.meta.last_row_id);
        }
      }
    } catch (e) {
      console.warn("[users/profile] Failed to upsert participant agent into agents table:", e);
    }

    if (existing) {
      // Update existing profile
      console.log('[users/profile] Updating existing profile');
      const updateResult = await db.prepare(
        `UPDATE individuals 
         SET email = COALESCE(?, email),
             role = COALESCE(?, role),
             first_name = COALESCE(?, first_name),
             last_name = COALESCE(?, last_name),
             phone_number = COALESCE(?, phone_number),
             social_display_name = COALESCE(?, social_display_name),
             social_account_id = COALESCE(?, social_account_id),
             social_account_type = COALESCE(?, social_account_type),
             eoa_address = COALESCE(?, eoa_address),
             aa_address = COALESCE(?, aa_address),
             participant_ens_name = COALESCE(?, participant_ens_name),
             participant_agent_name = COALESCE(?, participant_agent_name),
             participant_uaid = COALESCE(?, participant_uaid),
             participant_agent_row_id = COALESCE(?, participant_agent_row_id),
             participant_metadata = COALESCE(?, participant_metadata),
             trust_tier = COALESCE(?, trust_tier),
             updated_at = ?
         WHERE id = ?`
      ).bind(
        effectiveEmail,
        typeof role === "string" ? role : null,
        typeof first_name === "string" ? first_name : null,
        typeof last_name === "string" ? last_name : null,
        typeof phone_number === "string" ? phone_number : null,
        typeof social_display_name === "string" ? social_display_name : null,
        typeof social_account_id === "string" ? social_account_id : null,
        typeof social_account_type === "string" ? social_account_type : null,
        typeof cleanedEoa === "string" ? cleanedEoa : null,
        typeof aa_address === "string" ? aa_address : null,
        typeof participant_ens_name === "string" ? participant_ens_name : null,
        typeof participant_agent_name === "string" ? participant_agent_name : null,
        typeof participant_uaid === "string" ? participant_uaid : null,
        participantAgentRowId,
        typeof participant_metadata === "string" ? participant_metadata : null,
        typeof trust_tier === "string" ? trust_tier : null,
        now,
        existing.id
      ).run();
      console.log('[users/profile] Update result:', updateResult);
    } else {
      // Create new profile
      console.log('[users/profile] Creating new profile');
      const insertResult = await db.prepare(
        `INSERT INTO individuals 
         (email, role, first_name, last_name, phone_number, social_display_name, social_account_id, social_account_type, 
          eoa_address, aa_address,
          participant_ens_name, participant_agent_name, participant_uaid,
          participant_agent_row_id, participant_metadata, trust_tier,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        effectiveEmail,
        typeof role === "string" ? role : null,
        first_name || null,
        last_name || null,
        phone_number || null,
        social_display_name || null,
        social_account_id || null,
        social_account_type || null,
        cleanedEoa || null,
        aa_address || null,
        participant_ens_name || null,
        participant_agent_name || null,
        participant_uaid || null,
        participantAgentRowId,
        typeof participant_metadata === "string" ? participant_metadata : null,
        typeof trust_tier === "string" ? trust_tier : null,
        now,
        now
      ).run();
      console.log('[users/profile] Insert result:', insertResult);
    }

    // Fetch the updated/created profile
    console.log('[users/profile] Fetching updated profile');
    const profile = cleanedEoa
      ? await db.prepare('SELECT * FROM individuals WHERE eoa_address = ?').bind(cleanedEoa).first()
      : await db.prepare('SELECT * FROM individuals WHERE email = ?').bind(cleanedEmail).first();
    console.log('[users/profile] Profile fetched:', !!profile);

    return NextResponse.json({ profile });
  } catch (error) {
    console.error('[users/profile] Error in POST:', error);
    console.error('[users/profile] Error stack:', error instanceof Error ? error.stack : 'No stack');
    return NextResponse.json(
      {
        error: 'Failed to save user profile',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.stack : undefined) : undefined,
      },
      { status: 500 }
    );
  }
}

