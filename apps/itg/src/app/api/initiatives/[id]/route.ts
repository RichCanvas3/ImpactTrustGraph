export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ensureInitiativesSchema, emitAttestation, getDB } from "../_db";

function parseId(raw: string): number | null {
  const n = Number.parseInt(String(raw || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type InitiativeState = "draft" | "chartered" | "funded" | "executing" | "evaluating" | "closed";

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const initiativeId = parseId(id);
    if (!initiativeId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const db = await getDB();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureInitiativesSchema(db);

    const initiative = await db.prepare("SELECT * FROM initiatives WHERE id = ?").bind(initiativeId).first();
    if (!initiative) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const participants = await db
      .prepare(
        `SELECT p.*,
                i.first_name as individual_first_name, i.last_name as individual_last_name, i.email as individual_email, i.eoa_address as individual_eoa,
                o.ens_name as org_ens_name, o.org_name as org_name, o.agent_name as org_agent_name
         FROM initiative_participants p
         LEFT JOIN individuals i ON p.individual_id = i.id
         LEFT JOIN organizations o ON p.organization_id = o.id
         WHERE p.initiative_id = ?
         ORDER BY p.status ASC, p.role ASC, p.created_at ASC`,
      )
      .bind(initiativeId)
      .all();

    const workstreams = await db
      .prepare("SELECT * FROM initiative_workstreams WHERE initiative_id = ? ORDER BY sort_order ASC, id ASC")
      .bind(initiativeId)
      .all();

    const outcomes = await db
      .prepare("SELECT * FROM initiative_outcomes WHERE initiative_id = ? ORDER BY id ASC")
      .bind(initiativeId)
      .all();

    const opportunities = await db
      .prepare("SELECT * FROM opportunities WHERE initiative_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 200")
      .bind(initiativeId)
      .all();

    const engagements = await db
      .prepare(
        `SELECT e.*,
                o.title as opportunity_title,
                org.ens_name as requesting_org_ens_name,
                org.org_name as requesting_org_name,
                ind.first_name as contributor_first_name,
                ind.last_name as contributor_last_name,
                ind.eoa_address as contributor_eoa
         FROM engagements e
         LEFT JOIN opportunities o ON e.opportunity_id = o.id
         LEFT JOIN organizations org ON e.requesting_organization_id = org.id
         LEFT JOIN individuals ind ON e.contributor_individual_id = ind.id
         WHERE e.initiative_id = ?
         ORDER BY e.updated_at DESC, e.created_at DESC
         LIMIT 200`,
      )
      .bind(initiativeId)
      .all();

    const milestones = await db
      .prepare(
        `SELECT m.*, e.opportunity_id
         FROM milestones m
         JOIN engagements e ON m.engagement_id = e.id
         WHERE e.initiative_id = ?
         ORDER BY COALESCE(m.due_at, 9999999999) ASC, m.id ASC
         LIMIT 500`,
      )
      .bind(initiativeId)
      .all();

    const attestations = await db
      .prepare("SELECT * FROM attestations WHERE initiative_id = ? ORDER BY created_at DESC, id DESC LIMIT 200")
      .bind(initiativeId)
      .all();

    // Cheap aggregates for dashboard tiles
    const counts = {
      participants: (participants.results || []).length,
      opportunities: (opportunities.results || []).length,
      engagements: (engagements.results || []).length,
      milestones: (milestones.results || []).length,
      attestations: (attestations.results || []).length,
      openOpportunities: (opportunities.results || []).filter((o: any) => o.status === "open").length,
      activeEngagements: (engagements.results || []).filter((e: any) => e.status === "active").length,
      pendingMilestones: (milestones.results || []).filter((m: any) => m.status === "pending" || m.status === "submitted").length,
    };

    return NextResponse.json({
      initiative,
      counts,
      participants: participants.results || [],
      workstreams: workstreams.results || [],
      outcomes: outcomes.results || [],
      opportunities: opportunities.results || [],
      engagements: engagements.results || [],
      milestones: milestones.results || [],
      attestations: attestations.results || [],
    });
  } catch (error) {
    console.error("[initiatives/:id] GET error:", error);
    return NextResponse.json({ error: "Failed to load initiative", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const initiativeId = parseId(id);
    if (!initiativeId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const {
      title,
      summary,
      state,
      governance_json,
      budget_json,
      payout_rules_json,
      metadata_json,
      actor_individual_id,
    } = body || {};

    const db = await getDB();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureInitiativesSchema(db);

    const individualId =
      typeof actor_individual_id === "number" && actor_individual_id > 0 ? actor_individual_id : null;
    if (!individualId) {
      return NextResponse.json({ error: "actor_individual_id is required (number > 0)" }, { status: 400 });
    }

    const existing = await db.prepare("SELECT * FROM initiatives WHERE id = ?").bind(initiativeId).first();
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const desiredState: InitiativeState | null =
      typeof state === "string" && ["draft", "chartered", "funded", "executing", "evaluating", "closed"].includes(state)
        ? (state as InitiativeState)
        : null;

    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        `UPDATE initiatives
         SET title = COALESCE(?, title),
             summary = COALESCE(?, summary),
             state = COALESCE(?, state),
             governance_json = COALESCE(?, governance_json),
             budget_json = COALESCE(?, budget_json),
             payout_rules_json = COALESCE(?, payout_rules_json),
             metadata_json = COALESCE(?, metadata_json),
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        typeof title === "string" && title.trim() ? title.trim() : null,
        typeof summary === "string" ? summary : null,
        desiredState,
        typeof governance_json === "string" ? governance_json : governance_json ? JSON.stringify(governance_json) : null,
        typeof budget_json === "string" ? budget_json : budget_json ? JSON.stringify(budget_json) : null,
        typeof payout_rules_json === "string" ? payout_rules_json : payout_rules_json ? JSON.stringify(payout_rules_json) : null,
        typeof metadata_json === "string" ? metadata_json : metadata_json ? JSON.stringify(metadata_json) : null,
        now,
        initiativeId,
      )
      .run();

    await emitAttestation(db, {
      attestation_type: "initiative.updated",
      payload: { title, summary, state: desiredState },
      initiative_id: initiativeId,
      actor_individual_id: individualId,
    });

    const updated = await db.prepare("SELECT * FROM initiatives WHERE id = ?").bind(initiativeId).first();
    return NextResponse.json({ initiative: updated });
  } catch (error) {
    console.error("[initiatives/:id] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update initiative", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

