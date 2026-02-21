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
    const {
      title,
      description,
      workstream_id,
      required_skills_json,
      budget_json,
      status,
      created_by_org_id,
      actor_individual_id,
    } = body || {};

    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const db = await getDB();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureInitiativesSchema(db);

    const initiative = await db.prepare("SELECT id FROM initiatives WHERE id = ?").bind(initiativeId).first();
    if (!initiative) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const actorIndividualId =
      typeof actor_individual_id === "number" && actor_individual_id > 0 ? actor_individual_id : null;
    if (!actorIndividualId) {
      return NextResponse.json({ error: "actor_individual_id is required (number > 0)" }, { status: 400 });
    }
    const now = Math.floor(Date.now() / 1000);

    const ins = await db
      .prepare(
        `INSERT INTO opportunities
         (initiative_id, workstream_id, title, description, required_skills_json, budget_json, status,
          created_by_individual_id, created_by_org_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        initiativeId,
        typeof workstream_id === "number" ? workstream_id : null,
        title.trim(),
        typeof description === "string" ? description : null,
        typeof required_skills_json === "string"
          ? required_skills_json
          : required_skills_json
            ? JSON.stringify(required_skills_json)
            : null,
        typeof budget_json === "string" ? budget_json : budget_json ? JSON.stringify(budget_json) : null,
        typeof status === "string" && status ? status : "draft",
        actorIndividualId,
        typeof created_by_org_id === "number" ? created_by_org_id : null,
        now,
        now,
      )
      .run();

    const opportunityId = Number(ins.meta.last_row_id);

    await emitAttestation(db, {
      attestation_type: (typeof status === "string" && status === "open") ? "opportunity.published" : "opportunity.created",
      payload: { title: title.trim(), status: typeof status === "string" ? status : "draft" },
      initiative_id: initiativeId,
      opportunity_id: opportunityId,
      actor_individual_id: actorIndividualId,
      actor_org_id: typeof created_by_org_id === "number" ? created_by_org_id : null,
    });

    const created = await db.prepare("SELECT * FROM opportunities WHERE id = ?").bind(opportunityId).first();
    return NextResponse.json({ opportunity: created });
  } catch (error) {
    console.error("[initiatives/:id/opportunities] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create opportunity", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

