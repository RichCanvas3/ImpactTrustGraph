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
            participant_agent_account TEXT,
            participant_agent_id TEXT,
            participant_chain_id INTEGER,
            participant_did TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
          );`,
        ).run();

        await db.prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS idx_individuals_eoa_unique ON individuals(eoa_address) WHERE eoa_address IS NOT NULL",
        ).run();

        await db.prepare(
          `INSERT INTO individuals (
            id,email,first_name,last_name,social_account_id,social_account_type,eoa_address,aa_address,
            participant_ens_name,participant_agent_name,participant_agent_account,participant_agent_id,participant_chain_id,participant_did,
            created_at,updated_at
          )
          SELECT
            id,email,first_name,last_name,social_account_id,social_account_type,eoa_address,aa_address,
            participant_ens_name,participant_agent_name,participant_agent_account,participant_agent_id,participant_chain_id,participant_did,
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
      { name: "phone_number", sql: "ALTER TABLE individuals ADD COLUMN phone_number TEXT" },
      { name: "social_display_name", sql: "ALTER TABLE individuals ADD COLUMN social_display_name TEXT" },
      { name: "participant_ens_name", sql: "ALTER TABLE individuals ADD COLUMN participant_ens_name TEXT" },
      { name: "participant_agent_name", sql: "ALTER TABLE individuals ADD COLUMN participant_agent_name TEXT" },
      { name: "participant_agent_account", sql: "ALTER TABLE individuals ADD COLUMN participant_agent_account TEXT" },
      { name: "participant_agent_id", sql: "ALTER TABLE individuals ADD COLUMN participant_agent_id TEXT" },
      { name: "participant_chain_id", sql: "ALTER TABLE individuals ADD COLUMN participant_chain_id INTEGER" },
      { name: "participant_did", sql: "ALTER TABLE individuals ADD COLUMN participant_did TEXT" },
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
      participant_agent_account,
      participant_agent_id,
      participant_chain_id,
      participant_did,
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

    const now = Math.floor(Date.now() / 1000);
    console.log('[users/profile] Profile exists:', !!existing);

    if (existing) {
      // Update existing profile
      console.log('[users/profile] Updating existing profile');
      const updateResult = await db.prepare(
        `UPDATE individuals 
         SET email = COALESCE(?, email),
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
             participant_agent_account = COALESCE(?, participant_agent_account),
             participant_agent_id = COALESCE(?, participant_agent_id),
             participant_chain_id = COALESCE(?, participant_chain_id),
             participant_did = COALESCE(?, participant_did),
             updated_at = ?
         WHERE id = ?`
      ).bind(
        cleanedEmail,
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
        typeof participant_agent_account === "string" ? participant_agent_account : null,
        typeof participant_agent_id === "string" ? participant_agent_id : null,
        typeof participant_chain_id === "number" ? participant_chain_id : null,
        typeof participant_did === "string" ? participant_did : null,
        now,
        existing.id
      ).run();
      console.log('[users/profile] Update result:', updateResult);
    } else {
      // Create new profile
      console.log('[users/profile] Creating new profile');
      const insertResult = await db.prepare(
        `INSERT INTO individuals 
         (email, first_name, last_name, phone_number, social_display_name, social_account_id, social_account_type, 
          eoa_address, aa_address,
          participant_ens_name, participant_agent_name, participant_agent_account,
          participant_agent_id, participant_chain_id, participant_did,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        cleanedEmail,
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
        participant_agent_account || null,
        participant_agent_id || null,
        participant_chain_id || null,
        participant_did || null,
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

