export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getD1Database } from "../../../../lib/d1-wrapper";
import { ensureCapabilitiesSchema, seedCapabilitiesIfEmpty, type AppRole } from "../_db";

function normalizeRole(raw: unknown): AppRole {
  const r = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (r === "admin") return "admin";
  if (r === "coordinator" || r === "coalition") return "coordinator";
  if (r === "org_admin" || r === "org-admin" || r === "org") return "org_admin";
  if (r === "contributor") return "contributor";
  if (r === "funder") return "funder";
  return "org_admin";
}

export async function GET(request: NextRequest) {
  try {
    const role = normalizeRole(request.nextUrl.searchParams.get("role"));

    const db = await getD1Database();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureCapabilitiesSchema(db);
    await seedCapabilitiesIfEmpty(db);

    const classes = await db
      .prepare(
        `SELECT id, key, label, description, sort_order
         FROM capability_classifications
         ORDER BY sort_order ASC, id ASC`,
      )
      .all<any>();

    const types = await db
      .prepare(
        `SELECT t.id, t.classification_id, t.key, t.label, t.description, t.value_kind, t.unit, t.sort_order
         FROM capability_types t
         JOIN capability_type_roles r ON r.capability_type_id = t.id
         WHERE r.role = ?
         ORDER BY t.sort_order ASC, t.id ASC`,
      )
      .bind(role)
      .all<any>();

    const typeIds = (types.results || []).map((t: any) => Number(t.id)).filter((n: any) => Number.isFinite(n));
    let optionsByTypeId = new Map<number, Array<{ key: string; label: string }>>();
    if (typeIds.length) {
      const optRows = await db
        .prepare(
          `SELECT capability_type_id, key, label
           FROM capability_type_options
           WHERE capability_type_id IN (${typeIds.map(() => "?").join(",")})
           ORDER BY sort_order ASC, id ASC`,
        )
        .bind(...typeIds)
        .all<any>();
      for (const r of optRows.results || []) {
        const tid = Number(r.capability_type_id);
        if (!Number.isFinite(tid)) continue;
        const arr = optionsByTypeId.get(tid) ?? [];
        arr.push({ key: String(r.key), label: String(r.label) });
        optionsByTypeId.set(tid, arr);
      }
    }

    const typesByClassId = new Map<number, any[]>();
    for (const t of types.results || []) {
      const cid = Number(t.classification_id);
      if (!Number.isFinite(cid)) continue;
      const arr = typesByClassId.get(cid) ?? [];
      arr.push({
        id: Number(t.id),
        key: String(t.key),
        label: String(t.label),
        description: t.description ?? null,
        value_kind: String(t.value_kind),
        unit: t.unit ?? null,
        options: optionsByTypeId.get(Number(t.id)) ?? [],
      });
      typesByClassId.set(cid, arr);
    }

    return NextResponse.json({
      role,
      classifications: (classes.results || []).map((c: any) => ({
        id: Number(c.id),
        key: String(c.key),
        label: String(c.label),
        description: c.description ?? null,
        types: typesByClassId.get(Number(c.id)) ?? [],
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load capability catalog", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

