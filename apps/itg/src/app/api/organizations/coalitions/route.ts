export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { D1Database } from "../../../../lib/db";
import { getD1Database } from "../../../../lib/d1-wrapper";

async function getDB(): Promise<D1Database | null> {
  return await getD1Database();
}

let ensurePromise: Promise<void> | null = null;
async function ensureSchema(db: D1Database) {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    // org roles table (idempotent, best-effort)
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
  return ensurePromise;
}

export async function GET() {
  try {
    const db = await getDB();
    if (!db) return NextResponse.json({ organizations: [] });
    await ensureSchema(db);

    const rows = await db
      .prepare(
        `SELECT
           o.id,
           o.ens_name,
           o.agent_name,
           o.org_name,
           o.org_address,
           o.email_domain,
           o.uaid,
           o.agent_row_id,
           o.session_package,
           o.org_metadata
         FROM organizations o
         JOIN organization_roles r ON r.organization_id = o.id
         WHERE lower(r.role) = 'coalition'
         ORDER BY o.created_at ASC, o.id ASC`,
      )
      .all<any>();

    return NextResponse.json({
      organizations: (rows.results || []).map((o: any) => ({
        ...o,
        org_roles: ["coalition"],
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to list coalition organizations", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

