export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ensureInitiativesSchema, emitAttestation, getDB } from "../../../initiatives/_db";

function parseId(raw: string): number | null {
  const n = Number.parseInt(String(raw || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const engagementId = parseId(id);
    if (!engagementId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const { title, due_at, status, evidence_json, payout_json, actor_individual_id } = body || {};
    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const db = await getDB();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureInitiativesSchema(db);

    const eng = await db.prepare("SELECT * FROM engagements WHERE id = ?").bind(engagementId).first<any>();
    if (!eng) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });

    const now = Math.floor(Date.now() / 1000);
    const ins = await db
      .prepare(
        `INSERT INTO milestones
         (engagement_id, title, due_at, status, evidence_json, payout_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        engagementId,
        title.trim(),
        typeof due_at === "number" && Number.isFinite(due_at) ? due_at : null,
        typeof status === "string" && status ? status : "pending",
        typeof evidence_json === "string" ? evidence_json : evidence_json ? JSON.stringify(evidence_json) : null,
        typeof payout_json === "string" ? payout_json : payout_json ? JSON.stringify(payout_json) : null,
        now,
        now,
      )
      .run();

    const milestoneId = Number(ins.meta.last_row_id);

    const actorIndividualId =
      typeof actor_individual_id === "number" && actor_individual_id > 0 ? actor_individual_id : null;
    if (!actorIndividualId) {
      return NextResponse.json({ error: "actor_individual_id is required (number > 0)" }, { status: 400 });
    }
    await emitAttestation(db, {
      attestation_type: "milestone.created",
      payload: { title: title.trim(), status: typeof status === "string" ? status : "pending" },
      initiative_id: Number(eng.initiative_id),
      opportunity_id: Number(eng.opportunity_id),
      engagement_id: engagementId,
      milestone_id: milestoneId,
      actor_individual_id: actorIndividualId,
    });

    const created = await db.prepare("SELECT * FROM milestones WHERE id = ?").bind(milestoneId).first();
    return NextResponse.json({ milestone: created });
  } catch (error) {
    console.error("[engagements/:id/milestones] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create milestone", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

