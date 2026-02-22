export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getD1Database } from "../../../../lib/d1-wrapper";
import { ensureCapabilitiesSchema, seedCapabilitiesIfEmpty, type AppRole } from "../_db";

function asRoleArray(raw: any): AppRole[] {
  const allow = new Set<AppRole>(["admin", "coordinator", "org_admin", "contributor", "funder"]);
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((r) => String(r).trim().toLowerCase()).filter((r) => allow.has(r as any)) as AppRole[];
}

export async function GET() {
  try {
    const db = await getD1Database();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureCapabilitiesSchema(db);
    await seedCapabilitiesIfEmpty(db);

    const classes = await db
      .prepare("SELECT id, key, label, description, sort_order FROM capability_classifications ORDER BY sort_order ASC, id ASC")
      .all<any>();
    const types = await db
      .prepare(
        `SELECT id, classification_id, key, label, description, value_kind, unit, sort_order
         FROM capability_types
         ORDER BY sort_order ASC, id ASC`,
      )
      .all<any>();
    const roles = await db.prepare("SELECT capability_type_id, role FROM capability_type_roles ORDER BY role ASC").all<any>();
    const options = await db
      .prepare(
        `SELECT capability_type_id, key, label, sort_order
         FROM capability_type_options
         ORDER BY sort_order ASC, id ASC`,
      )
      .all<any>();
    const regions = await db.prepare("SELECT id, key, name, kind, parent_region_id FROM regions ORDER BY key ASC").all<any>();

    return NextResponse.json({
      classifications: classes.results || [],
      types: types.results || [],
      type_roles: roles.results || [],
      type_options: options.results || [],
      regions: regions.results || [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load capability admin data", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null as any);
    const action = typeof body?.action === "string" ? body.action : "";

    const db = await getD1Database();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureCapabilitiesSchema(db);
    await seedCapabilitiesIfEmpty(db);

    const ts = Math.floor(Date.now() / 1000);

    if (action === "upsertClassification") {
      const key = typeof body?.key === "string" ? body.key.trim() : "";
      const label = typeof body?.label === "string" ? body.label.trim() : "";
      const description = typeof body?.description === "string" ? body.description : null;
      const sort_order = Number.isFinite(Number(body?.sort_order)) ? Number(body.sort_order) : 0;
      if (!key || !label) return NextResponse.json({ error: "key and label are required" }, { status: 400 });

      const existing = await db.prepare("SELECT id FROM capability_classifications WHERE key = ?").bind(key).first<{ id: number }>();
      if (existing?.id) {
        await db
          .prepare(
            `UPDATE capability_classifications
             SET label = ?, description = ?, sort_order = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(label, description, sort_order, ts, existing.id)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO capability_classifications (key, label, description, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(key, label, description, sort_order, ts, ts)
          .run();
      }
      return NextResponse.json({ success: true });
    }

    if (action === "upsertType") {
      const key = typeof body?.key === "string" ? body.key.trim() : "";
      const label = typeof body?.label === "string" ? body.label.trim() : "";
      const description = typeof body?.description === "string" ? body.description : null;
      const classification_key = typeof body?.classification_key === "string" ? body.classification_key.trim() : "";
      const value_kind = typeof body?.value_kind === "string" ? body.value_kind.trim() : "";
      const unit = typeof body?.unit === "string" ? body.unit : null;
      const sort_order = Number.isFinite(Number(body?.sort_order)) ? Number(body.sort_order) : 0;
      const roles = asRoleArray(body?.roles);
      if (!key || !label || !classification_key || !value_kind) {
        return NextResponse.json({ error: "key, label, classification_key, value_kind required" }, { status: 400 });
      }

      const cls = await db.prepare("SELECT id FROM capability_classifications WHERE key = ?").bind(classification_key).first<{ id: number }>();
      if (!cls?.id) return NextResponse.json({ error: "classification not found" }, { status: 400 });

      const existing = await db.prepare("SELECT id FROM capability_types WHERE key = ?").bind(key).first<{ id: number }>();
      let typeId: number;
      if (existing?.id) {
        typeId = existing.id;
        await db
          .prepare(
            `UPDATE capability_types
             SET classification_id = ?, label = ?, description = ?, value_kind = ?, unit = ?, sort_order = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(cls.id, label, description, value_kind, unit, sort_order, ts, typeId)
          .run();
      } else {
        const ins = await db
          .prepare(
            `INSERT INTO capability_types
             (classification_id, key, label, description, value_kind, unit, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(cls.id, key, label, description, value_kind, unit, sort_order, ts, ts)
          .run();
        typeId = Number(ins.meta.last_row_id);
      }

      // Replace roles mapping
      await db.prepare("DELETE FROM capability_type_roles WHERE capability_type_id = ?").bind(typeId).run();
      for (const r of roles) {
        await db
          .prepare(
            `INSERT OR IGNORE INTO capability_type_roles (capability_type_id, role, created_at, updated_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(typeId, r, ts, ts)
          .run();
      }

      return NextResponse.json({ success: true, typeId });
    }

    if (action === "upsertOption") {
      const type_key = typeof body?.type_key === "string" ? body.type_key.trim() : "";
      const key = typeof body?.key === "string" ? body.key.trim() : "";
      const label = typeof body?.label === "string" ? body.label.trim() : "";
      const sort_order = Number.isFinite(Number(body?.sort_order)) ? Number(body.sort_order) : 0;
      if (!type_key || !key || !label) return NextResponse.json({ error: "type_key, key, label required" }, { status: 400 });

      const t = await db.prepare("SELECT id FROM capability_types WHERE key = ?").bind(type_key).first<{ id: number }>();
      if (!t?.id) return NextResponse.json({ error: "type not found" }, { status: 400 });

      const existing = await db
        .prepare("SELECT id FROM capability_type_options WHERE capability_type_id = ? AND key = ?")
        .bind(t.id, key)
        .first<{ id: number }>();
      if (existing?.id) {
        await db
          .prepare(
            `UPDATE capability_type_options
             SET label = ?, sort_order = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(label, sort_order, ts, existing.id)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO capability_type_options (capability_type_id, key, label, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(t.id, key, label, sort_order, ts, ts)
          .run();
      }
      return NextResponse.json({ success: true });
    }

    if (action === "upsertRegion") {
      const key = typeof body?.key === "string" ? body.key.trim() : "";
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const kind = typeof body?.kind === "string" ? body.kind.trim() : "custom";
      const parent_key = typeof body?.parent_key === "string" ? body.parent_key.trim() : null;
      if (!key || !name) return NextResponse.json({ error: "key and name required" }, { status: 400 });

      let parentId: number | null = null;
      if (parent_key) {
        const p = await db.prepare("SELECT id FROM regions WHERE key = ?").bind(parent_key).first<{ id: number }>();
        parentId = p?.id ?? null;
      }

      const existing = await db.prepare("SELECT id FROM regions WHERE key = ?").bind(key).first<{ id: number }>();
      if (existing?.id) {
        await db
          .prepare(
            `UPDATE regions
             SET name = ?, kind = ?, parent_region_id = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(name, kind, parentId, ts, existing.id)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO regions (key, name, kind, parent_region_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(key, name, kind, parentId, ts, ts)
          .run();
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update capability metadata", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

