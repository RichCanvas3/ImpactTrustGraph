export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ensureInitiativesSchema, getDB, resolveOrganizationIdsForIndividual, emitAttestation } from "./_db";

type InitiativeState = "draft" | "chartered" | "funded" | "executing" | "evaluating" | "closed";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const individualIdParam = searchParams.get("individualId");
    const individualId =
      individualIdParam && Number.isFinite(Number(individualIdParam)) ? Number.parseInt(individualIdParam, 10) : null;
    const scope = (searchParams.get("scope") ?? "active").toLowerCase(); // active|mine|all

    const db = await getDB();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureInitiativesSchema(db);

    if (scope !== "active" && scope !== "mine" && scope !== "all") {
      return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
    }

    if (scope === "mine" && (typeof individualId !== "number" || individualId < 1)) {
      return NextResponse.json({ initiatives: [] });
    }

    const orgIds = individualId ? await resolveOrganizationIdsForIndividual(db, individualId) : [];

    const whereParts: string[] = [];
    const binds: any[] = [];

    if (scope === "active") {
      whereParts.push("state != 'closed'");
    }

    if (scope === "mine") {
      if (!individualId) return NextResponse.json({ initiatives: [] });
      // Mine = initiatives you created OR initiatives where you (or your orgs) are participants.
      const orgInClause =
        orgIds.length > 0
          ? `organization_id IN (${orgIds.map(() => "?").join(",")})`
          : "1=0";
      whereParts.push(
        `(created_by_individual_id = ?
          OR id IN (
            SELECT initiative_id FROM initiative_participants
            WHERE (participant_kind = 'individual' AND individual_id = ?)
               OR (participant_kind = 'organization' AND ${orgInClause})
          ))`,
      );
      binds.push(individualId, individualId);
      if (orgIds.length > 0) binds.push(...orgIds);
    }

    const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const rows = await db
      .prepare(
        `SELECT id, title, summary, state, created_by_individual_id, created_by_org_id,
                governance_json, budget_json, payout_rules_json, metadata_json,
                created_at, updated_at
         FROM initiatives
         ${where}
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 200`,
      )
      .bind(...binds)
      .all();

    const raw = rows.results;
    const list = Array.isArray(raw) ? raw : [];
    const initiatives = list.map((r: Record<string, unknown>) => ({
      ...r,
      id: typeof r.id === "string" ? Number(r.id) : r.id,
      created_by_individual_id: r.created_by_individual_id != null && typeof r.created_by_individual_id === "string" ? Number(r.created_by_individual_id) : r.created_by_individual_id,
      created_at: r.created_at != null && typeof r.created_at === "string" ? Number(r.created_at) : r.created_at,
      updated_at: r.updated_at != null && typeof r.updated_at === "string" ? Number(r.updated_at) : r.updated_at,
    }));
    return NextResponse.json({ initiatives });
  } catch (error) {
    console.error("[initiatives] GET error:", error);
    return NextResponse.json({ error: "Failed to list initiatives", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      title,
      summary,
      state,
      created_by_individual_id,
      created_by_org_id,
      governance_json,
      budget_json,
      payout_rules_json,
      metadata_json,
      initial_participants,
    } = body || {};

    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const individualId =
      typeof created_by_individual_id === "number" && created_by_individual_id > 0 ? created_by_individual_id : null;
    if (!individualId) {
      return NextResponse.json({ error: "created_by_individual_id is required (number > 0)" }, { status: 400 });
    }

    const db = await getDB();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureInitiativesSchema(db);
    const now = Math.floor(Date.now() / 1000);
    const desiredState: InitiativeState =
      typeof state === "string" && ["draft", "chartered", "funded", "executing", "evaluating", "closed"].includes(state)
        ? (state as InitiativeState)
        : "draft";

    const ins = await db
      .prepare(
        `INSERT INTO initiatives
         (title, summary, state, created_by_individual_id, created_by_org_id,
          governance_json, budget_json, payout_rules_json, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        title.trim(),
        typeof summary === "string" ? summary : null,
        desiredState,
        individualId,
        typeof created_by_org_id === "number" ? created_by_org_id : null,
        typeof governance_json === "string" ? governance_json : governance_json ? JSON.stringify(governance_json) : null,
        typeof budget_json === "string" ? budget_json : budget_json ? JSON.stringify(budget_json) : null,
        typeof payout_rules_json === "string" ? payout_rules_json : payout_rules_json ? JSON.stringify(payout_rules_json) : null,
        typeof metadata_json === "string" ? metadata_json : metadata_json ? JSON.stringify(metadata_json) : null,
        now,
        now,
      )
      .run();

    const initiativeId = Number(ins.meta.last_row_id);

    // Creator as participant (best-effort)
    if (individualId) {
      try {
        await db
          .prepare(
            `INSERT OR IGNORE INTO initiative_participants
             (initiative_id, participant_kind, individual_id, organization_id, role, status, invited_by_individual_id, created_at, updated_at)
             VALUES (?, 'individual', ?, NULL, 'steward', 'active', ?, ?, ?)`,
          )
          .bind(initiativeId, individualId, individualId, now, now)
          .run();
      } catch {
        // ignore
      }
    }

    // Optional: initial participants array
    if (Array.isArray(initial_participants)) {
      for (const p of initial_participants) {
        try {
          const kind = typeof p?.participant_kind === "string" ? p.participant_kind : null;
          if (kind !== "individual" && kind !== "organization") continue;
          const role = typeof p?.role === "string" ? p.role : "observer";
          const status = typeof p?.status === "string" ? p.status : "invited";
          const individual_id = kind === "individual" && typeof p?.individual_id === "number" ? p.individual_id : null;
          const organization_id = kind === "organization" && typeof p?.organization_id === "number" ? p.organization_id : null;
          await db
            .prepare(
              `INSERT OR IGNORE INTO initiative_participants
               (initiative_id, participant_kind, individual_id, organization_id, role, status, invited_by_individual_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(initiativeId, kind, individual_id, organization_id, role, status, individualId, now, now)
            .run();
        } catch {
          // ignore
        }
      }
    }

    await emitAttestation(db, {
      attestation_type: "initiative.created",
      payload: { title: title.trim(), state: desiredState },
      initiative_id: initiativeId,
      actor_individual_id: individualId,
      actor_org_id: typeof created_by_org_id === "number" ? created_by_org_id : null,
    });

    const created = await db.prepare("SELECT * FROM initiatives WHERE id = ?").bind(initiativeId).first();
    return NextResponse.json({ initiative: created });
  } catch (error) {
    console.error("[initiatives] POST error:", error);
    return NextResponse.json({ error: "Failed to create initiative", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

