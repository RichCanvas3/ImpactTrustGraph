export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getD1Database } from "../../../../lib/d1-wrapper";
import { ensureCapabilitiesSchema, seedCapabilitiesIfEmpty } from "../../capabilities/_db";

function safeJsonParse(input: string | null | undefined): any | null {
  if (!input) return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const idRaw = request.nextUrl.searchParams.get("individualId") ?? request.nextUrl.searchParams.get("individual_id");
    const individualId = idRaw && /^\d+$/.test(String(idRaw)) ? Number.parseInt(String(idRaw), 10) : null;
    if (!individualId) return NextResponse.json({ error: "individualId is required" }, { status: 400 });

    const db = await getD1Database();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureCapabilitiesSchema(db);
    await seedCapabilitiesIfEmpty(db);

    const rows = await db
      .prepare(
        `SELECT ic.capability_type_id, t.key AS type_key, t.value_kind, ic.value_text, ic.value_number, ic.value_json, ic.location_id
         FROM individual_capabilities ic
         JOIN capability_types t ON t.id = ic.capability_type_id
         WHERE ic.individual_id = ?
         ORDER BY ic.updated_at DESC, ic.id DESC`,
      )
      .bind(individualId)
      .all<any>();

    const locationIds = (rows.results || [])
      .map((r: any) => (r.location_id != null ? Number(r.location_id) : null))
      .filter((n: any): n is number => typeof n === "number" && Number.isFinite(n));

    const locationsById = new Map<number, any>();
    if (locationIds.length) {
      const locRows = await db
        .prepare(
          `SELECT l.id, l.label, l.address1, l.address2, l.city, l.state, l.postal, l.country, l.region_id,
                  r.key AS region_key, r.name AS region_name
           FROM locations l
           LEFT JOIN regions r ON r.id = l.region_id
           WHERE l.id IN (${locationIds.map(() => "?").join(",")})`,
        )
        .bind(...locationIds)
        .all<any>();
      for (const l of locRows.results || []) {
        const id = Number(l.id);
        if (!Number.isFinite(id)) continue;
        locationsById.set(id, {
          id,
          label: l.label ?? null,
          address1: l.address1 ?? null,
          address2: l.address2 ?? null,
          city: l.city ?? null,
          state: l.state ?? null,
          postal: l.postal ?? null,
          country: l.country ?? null,
          region: l.region_id
            ? { id: Number(l.region_id), key: l.region_key ?? null, name: l.region_name ?? null }
            : null,
        });
      }
    }

    const byTypeKey: Record<string, any> = {};
    for (const r of rows.results || []) {
      const key = String(r.type_key || "");
      if (!key) continue;
      byTypeKey[key] = {
        type_key: key,
        value_kind: String(r.value_kind || ""),
        value_text: r.value_text ?? null,
        value_number: r.value_number ?? null,
        value_json: safeJsonParse(r.value_json ?? null),
        location: r.location_id ? locationsById.get(Number(r.location_id)) ?? null : null,
      };
    }

    return NextResponse.json({ individualId, capabilities: byTypeKey });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get user capabilities", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null as any);
    const individualId =
      typeof body?.individual_id === "number" && Number.isFinite(body.individual_id) && body.individual_id > 0
        ? body.individual_id
        : typeof body?.individualId === "number" && Number.isFinite(body.individualId) && body.individualId > 0
          ? body.individualId
          : null;
    const updates = Array.isArray(body?.updates) ? body.updates : Array.isArray(body?.capabilities) ? body.capabilities : null;
    if (!individualId) return NextResponse.json({ error: "individual_id is required" }, { status: 400 });
    if (!updates) return NextResponse.json({ error: "updates[] is required" }, { status: 400 });

    const db = await getD1Database();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureCapabilitiesSchema(db);
    await seedCapabilitiesIfEmpty(db);

    // Validate individual exists
    const ind = await db.prepare("SELECT id FROM individuals WHERE id = ?").bind(individualId).first<{ id: number }>();
    if (!ind?.id) return NextResponse.json({ error: "Invalid individual_id (not found)" }, { status: 400 });

    const ts = Math.floor(Date.now() / 1000);

    for (const u of updates) {
      const typeKey = typeof u?.type_key === "string" ? u.type_key.trim() : typeof u?.key === "string" ? u.key.trim() : "";
      if (!typeKey) continue;

      const typeRow = await db.prepare("SELECT id, value_kind FROM capability_types WHERE key = ?").bind(typeKey).first<{ id: number; value_kind: string }>();
      const typeId = typeRow?.id ?? null;
      if (!typeId) continue;

      let valueText: string | null = null;
      let valueNumber: number | null = null;
      let valueJson: string | null = null;
      let locationId: number | null = null;

      const kind = String(typeRow?.value_kind || "");
      if (kind === "number") {
        const n = typeof u?.value_number === "number" ? u.value_number : Number(u?.value);
        valueNumber = Number.isFinite(n) ? n : null;
      } else if (kind === "text") {
        valueText = typeof u?.value_text === "string" ? u.value_text : typeof u?.value === "string" ? u.value : null;
      } else if (kind === "enum") {
        const v = typeof u?.value === "string" ? u.value : typeof u?.value_text === "string" ? u.value_text : null;
        valueJson = v ? JSON.stringify(v) : null;
      } else if (kind === "multi_enum") {
        const arr = Array.isArray(u?.value) ? u.value : Array.isArray(u?.value_json) ? u.value_json : Array.isArray(u?.values) ? u.values : null;
        valueJson = arr ? JSON.stringify(arr) : JSON.stringify([]);
      } else if (kind === "location") {
        // Allow either location_id or inline location object.
        const lid = typeof u?.location_id === "number" && Number.isFinite(u.location_id) ? u.location_id : null;
        if (lid) {
          locationId = lid;
        } else if (u?.location && typeof u.location === "object") {
          const loc = u.location;
          const regionKey = typeof loc?.region_key === "string" ? loc.region_key.trim() : null;
          let regionId: number | null = null;
          if (regionKey) {
            const r = await db.prepare("SELECT id FROM regions WHERE key = ?").bind(regionKey).first<{ id: number }>();
            regionId = r?.id ?? null;
          }
          const ins = await db
            .prepare(
              `INSERT INTO locations (label, address1, address2, city, state, postal, country, region_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              typeof loc?.label === "string" ? loc.label : null,
              typeof loc?.address1 === "string" ? loc.address1 : null,
              typeof loc?.address2 === "string" ? loc.address2 : null,
              typeof loc?.city === "string" ? loc.city : null,
              typeof loc?.state === "string" ? loc.state : null,
              typeof loc?.postal === "string" ? loc.postal : null,
              typeof loc?.country === "string" ? loc.country : null,
              regionId,
              ts,
              ts,
            )
            .run();
          locationId = Number(ins.meta.last_row_id);
        }
      }

      const existing = await db
        .prepare("SELECT id FROM individual_capabilities WHERE individual_id = ? AND capability_type_id = ?")
        .bind(individualId, typeId)
        .first<{ id: number }>();

      if (existing?.id) {
        await db
          .prepare(
            `UPDATE individual_capabilities
             SET value_text = ?, value_number = ?, value_json = ?, location_id = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(valueText, valueNumber, valueJson, locationId, ts, existing.id)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO individual_capabilities
             (individual_id, capability_type_id, value_text, value_number, value_json, location_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(individualId, typeId, valueText, valueNumber, valueJson, locationId, ts, ts)
          .run();
      }
    }

    return NextResponse.json({ success: true, individual_id: individualId });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update user capabilities", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

