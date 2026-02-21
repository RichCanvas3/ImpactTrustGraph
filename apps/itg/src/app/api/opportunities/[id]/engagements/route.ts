export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ensureInitiativesSchema, emitAttestation, getDB, resolveIndividualIdByEoa } from "../../../initiatives/_db";

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
    const opportunityId = parseId(id);
    if (!opportunityId) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const {
      initiative_id,
      requesting_organization_id,
      contributor_individual_id,
      contributor_eoa,
      contributor_agent_row_id,
      terms_json,
      status,
      actor_individual_id,
      actor_eoa,
    } = body || {};

    const db = await getDB();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureInitiativesSchema(db);

    const opp = await db.prepare("SELECT * FROM opportunities WHERE id = ?").bind(opportunityId).first<any>();
    if (!opp) return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });

    const initId = typeof initiative_id === "number" ? initiative_id : Number(opp.initiative_id);
    if (!Number.isFinite(initId) || initId <= 0) {
      return NextResponse.json({ error: "initiative_id is required" }, { status: 400 });
    }

    const contributorEoaClean = cleanEoa(contributor_eoa);
    const contributorIndividualResolved =
      typeof contributor_individual_id === "number"
        ? contributor_individual_id
        : contributorEoaClean
          ? await resolveIndividualIdByEoa(db, contributorEoaClean)
          : null;

    const now = Math.floor(Date.now() / 1000);
    const ins = await db
      .prepare(
        `INSERT INTO engagements
         (initiative_id, opportunity_id, requesting_organization_id, contributor_individual_id, contributor_agent_row_id,
          terms_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        initId,
        opportunityId,
        typeof requesting_organization_id === "number" ? requesting_organization_id : null,
        contributorIndividualResolved,
        typeof contributor_agent_row_id === "number" ? contributor_agent_row_id : null,
        typeof terms_json === "string" ? terms_json : terms_json ? JSON.stringify(terms_json) : null,
        typeof status === "string" && status ? status : "proposed",
        now,
        now,
      )
      .run();

    const engagementId = Number(ins.meta.last_row_id);
    const eoa = cleanEoa(actor_eoa);
    const actorIndividualId =
      typeof actor_individual_id === "number" ? actor_individual_id : eoa ? await resolveIndividualIdByEoa(db, eoa) : null;
    await emitAttestation(db, {
      attestation_type: typeof status === "string" && status === "active" ? "engagement.activated" : "engagement.created",
      payload: { opportunity_id: opportunityId, status: typeof status === "string" ? status : "proposed" },
      initiative_id: initId,
      opportunity_id: opportunityId,
      engagement_id: engagementId,
      actor_individual_id: actorIndividualId,
      actor_org_id: typeof requesting_organization_id === "number" ? requesting_organization_id : null,
    });

    // If engagement becomes active, mark opportunity as filled (best-effort)
    if (typeof status === "string" && status === "active") {
      try {
        await db.prepare("UPDATE opportunities SET status = 'filled', updated_at = ? WHERE id = ?").bind(now, opportunityId).run();
      } catch {
        // ignore
      }
    }

    const created = await db.prepare("SELECT * FROM engagements WHERE id = ?").bind(engagementId).first();
    return NextResponse.json({ engagement: created });
  } catch (error) {
    console.error("[opportunities/:id/engagements] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create engagement", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

