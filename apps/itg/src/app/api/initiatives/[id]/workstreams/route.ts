export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ensureInitiativesSchema, emitAttestation, getDB } from "../../_db";

function parseId(raw: string): number | null {
  const n = Number.parseInt(String(raw || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const initiativeId = parseId(id);
    if (!initiativeId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const { title, description, sort_order, status, actor_individual_id } = body || {};
    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const db = await getDB();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureInitiativesSchema(db);

    const initiative = await db.prepare("SELECT id FROM initiatives WHERE id = ?").bind(initiativeId).first();
    if (!initiative) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const now = Math.floor(Date.now() / 1000);
    const ins = await db
      .prepare(
        `INSERT INTO initiative_workstreams
         (initiative_id, title, description, status, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        initiativeId,
        title.trim(),
        typeof description === "string" ? description : null,
        typeof status === "string" && status ? status : "active",
        typeof sort_order === "number" && Number.isFinite(sort_order) ? sort_order : 0,
        now,
        now,
      )
      .run();

    const workstreamId = Number(ins.meta.last_row_id);
    const actorIndividualId =
      typeof actor_individual_id === "number" && actor_individual_id > 0 ? actor_individual_id : null;
    if (!actorIndividualId) {
      return NextResponse.json({ error: "actor_individual_id is required (number > 0)" }, { status: 400 });
    }
    await emitAttestation(db, {
      attestation_type: "initiative.workstream.created",
      payload: { title: title.trim() },
      initiative_id: initiativeId,
      actor_individual_id: actorIndividualId,
    });

    const created = await db.prepare("SELECT * FROM initiative_workstreams WHERE id = ?").bind(workstreamId).first();
    return NextResponse.json({ workstream: created });
  } catch (error) {
    console.error("[initiatives/:id/workstreams] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create workstream", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

