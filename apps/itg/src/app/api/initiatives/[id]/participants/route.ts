export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ensureInitiativesSchema, emitAttestation, getDB, resolveIndividualIdByEoa } from "../../_db";

function parseId(raw: string): number | null {
  const n = Number.parseInt(String(raw || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanEoa(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return /^0x[a-fA-F0-9]{40}$/.test(v) ? v.toLowerCase() : null;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const initiativeId = parseId(id);
    if (!initiativeId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const {
      action, // add|remove|update
      participant_kind, // individual|organization
      individual_id,
      organization_id,
      role,
      status,
      actor_individual_id,
      actor_eoa,
    } = body || {};

    if (action !== "add" && action !== "remove" && action !== "update") {
      return NextResponse.json({ error: "action must be add|remove|update" }, { status: 400 });
    }
    if (participant_kind !== "individual" && participant_kind !== "organization") {
      return NextResponse.json({ error: "participant_kind must be individual|organization" }, { status: 400 });
    }

    const db = await getDB();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureInitiativesSchema(db);

    const initiative = await db.prepare("SELECT id FROM initiatives WHERE id = ?").bind(initiativeId).first();
    if (!initiative) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const targetIndividualId = participant_kind === "individual" && typeof individual_id === "number" ? individual_id : null;
    const targetOrgId = participant_kind === "organization" && typeof organization_id === "number" ? organization_id : null;
    if (participant_kind === "individual" && !targetIndividualId) {
      return NextResponse.json({ error: "individual_id is required for individual participants" }, { status: 400 });
    }
    if (participant_kind === "organization" && !targetOrgId) {
      return NextResponse.json({ error: "organization_id is required for organization participants" }, { status: 400 });
    }

    const now = Math.floor(Date.now() / 1000);
    const eoa = cleanEoa(actor_eoa);
    const actorIndividualId =
      typeof actor_individual_id === "number" ? actor_individual_id : eoa ? await resolveIndividualIdByEoa(db, eoa) : null;

    if (action === "add") {
      await db
        .prepare(
          `INSERT OR IGNORE INTO initiative_participants
           (initiative_id, participant_kind, individual_id, organization_id, role, status, invited_by_individual_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          initiativeId,
          participant_kind,
          targetIndividualId,
          targetOrgId,
          typeof role === "string" && role ? role : "observer",
          typeof status === "string" && status ? status : "invited",
          actorIndividualId,
          now,
          now,
        )
        .run();

      await emitAttestation(db, {
        attestation_type: "initiative.participant.added",
        payload: { participant_kind, individual_id: targetIndividualId, organization_id: targetOrgId, role, status },
        initiative_id: initiativeId,
        actor_individual_id: actorIndividualId,
      });
    } else if (action === "remove") {
      await db
        .prepare(
          `UPDATE initiative_participants
           SET status = 'removed', updated_at = ?
           WHERE initiative_id = ? AND participant_kind = ? AND individual_id IS ? AND organization_id IS ?`,
        )
        .bind(now, initiativeId, participant_kind, targetIndividualId, targetOrgId)
        .run();

      await emitAttestation(db, {
        attestation_type: "initiative.participant.removed",
        payload: { participant_kind, individual_id: targetIndividualId, organization_id: targetOrgId },
        initiative_id: initiativeId,
        actor_individual_id: actorIndividualId,
      });
    } else {
      await db
        .prepare(
          `UPDATE initiative_participants
           SET role = COALESCE(?, role),
               status = COALESCE(?, status),
               updated_at = ?
           WHERE initiative_id = ? AND participant_kind = ? AND individual_id IS ? AND organization_id IS ?`,
        )
        .bind(
          typeof role === "string" && role ? role : null,
          typeof status === "string" && status ? status : null,
          now,
          initiativeId,
          participant_kind,
          targetIndividualId,
          targetOrgId,
        )
        .run();

      await emitAttestation(db, {
        attestation_type: "initiative.participant.updated",
        payload: { participant_kind, individual_id: targetIndividualId, organization_id: targetOrgId, role, status },
        initiative_id: initiativeId,
        actor_individual_id: actorIndividualId,
      });
    }

    const participants = await db
      .prepare("SELECT * FROM initiative_participants WHERE initiative_id = ? ORDER BY created_at ASC")
      .bind(initiativeId)
      .all();

    return NextResponse.json({ success: true, participants: participants.results || [] });
  } catch (error) {
    console.error("[initiatives/:id/participants] POST error:", error);
    return NextResponse.json(
      { error: "Failed to update participants", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

