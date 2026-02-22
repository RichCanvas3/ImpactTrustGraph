export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { D1Database } from "../../../../lib/db";
import { getD1Database } from "../../../../lib/d1-wrapper";
import { canonicalizeUaid } from "../../../../lib/uaid";

let ensureAgentsSchemaPromise: Promise<void> | null = null;
async function ensureAgentsSchema(db: D1Database) {
  if (ensureAgentsSchemaPromise) return ensureAgentsSchemaPromise;
  ensureAgentsSchemaPromise = (async () => {
    await db
      .prepare(
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
      )
      .run();
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
    const raw = request.nextUrl.searchParams.get("uaid");
    const uaid = canonicalizeUaid(raw);
    if (!uaid) {
      return NextResponse.json({ error: "uaid parameter is required" }, { status: 400 });
    }

    const db = await getD1Database();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureAgentsSchema(db);

    const row = await db
      .prepare("SELECT session_package FROM agents WHERE uaid = ?")
      .bind(uaid)
      .first<{ session_package: string | null }>();
    if (!row) return NextResponse.json({ error: "Agent not found for uaid", uaid }, { status: 404 });
    if (!row.session_package) return NextResponse.json({ error: "Session package not found for agent", uaid }, { status: 404 });

    try {
      const sessionPackage = JSON.parse(row.session_package);
      return NextResponse.json({ uaid, sessionPackage });
    } catch {
      return NextResponse.json({ error: "Failed to parse session package JSON", uaid }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get session package", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null as any);
    const uaid = canonicalizeUaid(body?.uaid);
    const sessionPackage = body?.sessionPackage;

    if (!uaid) return NextResponse.json({ error: "uaid is required" }, { status: 400 });
    if (!sessionPackage || typeof sessionPackage !== "object") {
      return NextResponse.json({ error: "sessionPackage is required and must be an object" }, { status: 400 });
    }

    const db = await getD1Database();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureAgentsSchema(db);

    const now = Math.floor(Date.now() / 1000);
    const json = JSON.stringify(sessionPackage);
    const existing = await db.prepare("SELECT id FROM agents WHERE uaid = ?").bind(uaid).first<{ id: number }>();
    if (existing?.id) {
      await db
        .prepare("UPDATE agents SET session_package = ?, updated_at = ? WHERE id = ?")
        .bind(json, now, existing.id)
        .run();
    } else {
      await db
        .prepare("INSERT INTO agents (uaid, session_package, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .bind(uaid, json, now, now)
        .run();
    }

    return NextResponse.json({ success: true, uaid });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save session package", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

