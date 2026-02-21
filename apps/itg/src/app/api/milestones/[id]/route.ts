export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ensureInitiativesSchema, emitAttestation, getDB, resolveIndividualIdByEoa } from "../../initiatives/_db";

function parseId(raw: string): number | null {
  const n = Number.parseInt(String(raw || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanEoa(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return /^0x[a-fA-F0-9]{40}$/.test(v) ? v.toLowerCase() : null;
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const milestoneId = parseId(id);
    if (!milestoneId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const { status, evidence_json, payout_json, actor_individual_id, actor_eoa } = body || {};

    const db = await getDB();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureInitiativesSchema(db);

    const existing = await db.prepare("SELECT * FROM milestones WHERE id = ?").bind(milestoneId).first<any>();
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        `UPDATE milestones
         SET status = COALESCE(?, status),
             evidence_json = COALESCE(?, evidence_json),
             payout_json = COALESCE(?, payout_json),
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        typeof status === "string" && status ? status : null,
        typeof evidence_json === "string" ? evidence_json : evidence_json ? JSON.stringify(evidence_json) : null,
        typeof payout_json === "string" ? payout_json : payout_json ? JSON.stringify(payout_json) : null,
        now,
        milestoneId,
      )
      .run();

    // Linkage for attestations
    const eng = await db
      .prepare("SELECT initiative_id, opportunity_id FROM engagements WHERE id = ?")
      .bind(Number(existing.engagement_id))
      .first<any>();

    const eoa = cleanEoa(actor_eoa);
    const actorIndividualId =
      typeof actor_individual_id === "number" ? actor_individual_id : eoa ? await resolveIndividualIdByEoa(db, eoa) : null;

    const prevStatus = typeof existing.status === "string" ? existing.status : null;
    const nextStatus = typeof status === "string" && status ? status : prevStatus;

    if (nextStatus && nextStatus !== prevStatus) {
      const attType =
        nextStatus === "submitted"
          ? "milestone.submitted"
          : nextStatus === "verified"
            ? "milestone.verified"
            : nextStatus === "rejected"
              ? "milestone.rejected"
              : "milestone.updated";
      await emitAttestation(db, {
        attestation_type: attType,
        payload: { from: prevStatus, to: nextStatus },
        initiative_id: eng?.initiative_id ? Number(eng.initiative_id) : null,
        opportunity_id: eng?.opportunity_id ? Number(eng.opportunity_id) : null,
        engagement_id: existing.engagement_id ? Number(existing.engagement_id) : null,
        milestone_id: milestoneId,
        actor_individual_id: actorIndividualId,
      });
    }

    const updated = await db.prepare("SELECT * FROM milestones WHERE id = ?").bind(milestoneId).first();
    return NextResponse.json({ milestone: updated });
  } catch (error) {
    console.error("[milestones/:id] PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update milestone", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

