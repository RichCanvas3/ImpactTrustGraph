export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAgenticTrustClient } from "@agentic-trust/core/server";

function toA2aEndpoint(endpoint: string): string {
  const raw = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("Missing agent endpoint.");
  if (raw.includes("/api/a2a")) return raw.replace(/\/+$/, "");
  if (raw.includes("/.well-known/agent-card.json")) {
    return raw.replace(/\/\.well-known\/agent-card\.json\/?$/, "/api/a2a");
  }
  const u = new URL(raw);
  return `${u.origin}/api/a2a`;
}

function pickA2aOrCardEndpoint(details: any): string | null {
  const direct = [
    details?.a2aEndpoint,
    details?.a2a_endpoint,
    details?.agentA2aEndpoint,
    details?.agent?.a2aEndpoint,
    details?.agentInfo?.a2aEndpoint,
  ];
  for (const c of direct) if (typeof c === "string" && c.trim()) return c.trim();

  const serviceLists = [
    details?.services,
    details?.identityRegistration?.services,
    details?.identityRegistration?.registration?.services,
    details?.discovery?.services,
  ];
  for (const list of serviceLists) {
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      const endpoint = typeof s?.endpoint === "string" ? s.endpoint.trim() : "";
      if (!endpoint) continue;
      const type = typeof s?.type === "string" ? s.type.trim().toLowerCase() : "";
      if (type === "a2a") return endpoint;
      if (endpoint.includes("/.well-known/agent-card.json")) return endpoint;
      if (endpoint.includes("/api/a2a")) return endpoint;
    }
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ uaid: string }> },
) {
  try {
    const resolvedParams = await params;
    const uaid = decodeURIComponent(resolvedParams.uaid || "").trim();
    if (!uaid) {
      return NextResponse.json({ success: false, error: "Missing UAID parameter" }, { status: 400 });
    }

    const atp = await getAgenticTrustClient();
    const details = await atp.getAgentDetailsByUaidUniversal(uaid, { allowOnChain: true } as any);
    if (!details || (details as any).success !== true) {
      return NextResponse.json({ success: false, error: "Agent details could not be resolved", uaid }, { status: 404 });
    }

    const candidate = pickA2aOrCardEndpoint(details);
    if (!candidate) {
      return NextResponse.json({ success: false, error: "Missing agent A2A endpoint", uaid }, { status: 400 });
    }

    const a2aEndpoint = toA2aEndpoint(candidate);
    const startedAt = Date.now();
    const res = await fetch(a2aEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        skillId: "agent.status",
        payload: {},
        message: "status",
      }),
    });
    const latencyMs = Date.now() - startedAt;
    const json = await res.json().catch(() => null as any);

    const ok = res.ok && json && json.success === true;
    return NextResponse.json(
      {
        success: ok,
        uaid,
        a2aEndpoint,
        status: res.status,
        latencyMs,
        response: json ?? null,
      },
      { status: ok ? 200 : 502 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: "Failed to call agent status", message }, { status: 400 });
  }
}

