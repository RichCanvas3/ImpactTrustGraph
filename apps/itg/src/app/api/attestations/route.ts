export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ensureInitiativesSchema, emitAttestation, getDB, resolveIndividualIdByEoa } from "../initiatives/_db";

function cleanEoa(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return /^0x[a-fA-F0-9]{40}$/.test(v) ? v.toLowerCase() : null;
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const initiativeIdRaw = sp.get("initiativeId");
    const initiativeId = initiativeIdRaw ? Number.parseInt(initiativeIdRaw, 10) : null;

    const db = await getDB();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureInitiativesSchema(db);

    if (initiativeId && Number.isFinite(initiativeId)) {
      const rows = await db
        .prepare("SELECT * FROM attestations WHERE initiative_id = ? ORDER BY created_at DESC, id DESC LIMIT 200")
        .bind(initiativeId)
        .all();
      return NextResponse.json({ attestations: rows.results || [] });
    }

    const rows = await db.prepare("SELECT * FROM attestations ORDER BY created_at DESC, id DESC LIMIT 200").all();
    return NextResponse.json({ attestations: rows.results || [] });
  } catch (error) {
    console.error("[attestations] GET error:", error);
    return NextResponse.json(
      { error: "Failed to list attestations", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      attestation_type,
      payload,
      initiative_id,
      opportunity_id,
      engagement_id,
      milestone_id,
      actor_individual_id,
      actor_eoa,
      actor_org_id,
      chain_id,
      tx_hash,
      eas_uid,
    } = body || {};

    if (!attestation_type || typeof attestation_type !== "string") {
      return NextResponse.json({ error: "attestation_type is required" }, { status: 400 });
    }

    const db = await getDB();
    if (!db) return NextResponse.json({ error: "Database not available" }, { status: 500 });
    await ensureInitiativesSchema(db);

    const eoa = cleanEoa(actor_eoa);
    const actorIndividualId =
      typeof actor_individual_id === "number" ? actor_individual_id : eoa ? await resolveIndividualIdByEoa(db, eoa) : null;

    await emitAttestation(db, {
      attestation_type,
      payload,
      initiative_id: typeof initiative_id === "number" ? initiative_id : null,
      opportunity_id: typeof opportunity_id === "number" ? opportunity_id : null,
      engagement_id: typeof engagement_id === "number" ? engagement_id : null,
      milestone_id: typeof milestone_id === "number" ? milestone_id : null,
      actor_individual_id: actorIndividualId,
      actor_org_id: typeof actor_org_id === "number" ? actor_org_id : null,
      chain_id: typeof chain_id === "number" ? chain_id : null,
      tx_hash: typeof tx_hash === "string" ? tx_hash : null,
      eas_uid: typeof eas_uid === "string" ? eas_uid : null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[attestations] POST error:", error);
    return NextResponse.json(
      { error: "Failed to write attestation", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

