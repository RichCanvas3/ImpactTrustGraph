export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAgenticTrustClient } from "@agentic-trust/core/server";

function extractAgentId(details: any): number | null {
  const candidates = [
    details?.agentId,
    details?.agent_id,
    details?.id,
    details?.agent?.agentId,
    details?.agent?.agent_id,
    details?.agent?.id,
    details?.agentInfo?.agentId,
    details?.agentInfo?.agent_id,
    details?.agentInfo?.id,
  ];
  for (const c of candidates) {
    const n = typeof c === "number" ? c : typeof c === "string" && /^\d+$/.test(c.trim()) ? Number.parseInt(c, 10) : null;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ uaid: string }> },
) {
  try {
    const resolvedParams = await params;
    const raw = decodeURIComponent(resolvedParams.uaid || "").trim();
    if (!raw) {
      return NextResponse.json({ found: false, message: "Missing UAID parameter" }, { status: 400 });
    }
    const uaid = raw.startsWith("uaid:") ? raw : raw; // allow either already prefixed or raw UAID string

    const atp = await getAgenticTrustClient();
    const details = await atp.getAgentDetailsByUaidUniversal(uaid, { allowOnChain: true } as any);
    if (!details || (details as any).success !== true) {
      return NextResponse.json({ found: false, uaid, message: "Agent details could not be resolved" }, { status: 404 });
    }

    const agentId = extractAgentId(details);
    // Avoid duplicate `agentId` key warning when spreading `details` (which may already include it).
    const { agentId: _agentId, ...detailsRest } = details as any;
    return NextResponse.json({
      found: true,
      uaid,
      agentId,
      ...detailsRest,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ found: false, error: "Failed to resolve agent by UAID", message }, { status: 400 });
  }
}

