export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAgenticTrustClient } from "@agentic-trust/core/server";

function toAgentCardUrl(endpoint: string): string {
  const raw = String(endpoint || "").trim();
  if (!raw) throw new Error("Missing A2A endpoint.");

  // Common form: https://host/api/a2a → https://host/.well-known/agent-card.json
  if (raw.includes("/api/a2a")) {
    return raw.replace(/\/api\/a2a\/?$/, "/.well-known/agent-card.json");
  }
  if (raw.includes("/.well-known/agent-card.json")) return raw;

  // Fallback: treat as base URL (origin) and append card path.
  const u = new URL(raw);
  return `${u.origin}/.well-known/agent-card.json`;
}

function pickA2aEndpoint(details: any): string | null {
  const candidates = [
    details?.a2aEndpoint,
    details?.a2a_endpoint,
    details?.agentA2aEndpoint,
    details?.agent?.a2aEndpoint,
    details?.agent?.a2a_endpoint,
    details?.agentInfo?.a2aEndpoint,
    details?.agentInfo?.a2a_endpoint,
    details?.agent?.agentCard?.a2aEndpoint,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  // Some KB payloads put the A2A service URL under registration "services".
  // That endpoint is often already `/.well-known/agent-card.json`.
  const serviceLists = [
    details?.services,
    details?.identityRegistration?.services,
    details?.identityRegistration?.registration?.services,
    details?.discovery?.services,
    details?.discovery?.identityRegistration?.services,
  ];
  for (const list of serviceLists) {
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      const type = typeof s?.type === "string" ? s.type.trim().toLowerCase() : "";
      const endpoint = typeof s?.endpoint === "string" ? s.endpoint.trim() : "";
      if (!endpoint) continue;
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

    const a2aEndpoint = pickA2aEndpoint(details);
    if (!a2aEndpoint) {
      return NextResponse.json({ success: false, error: "Missing agent A2A endpoint", uaid }, { status: 400 });
    }

    const cardUrl = toAgentCardUrl(a2aEndpoint);
    const res = await fetch(cardUrl, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const card = await res.json().catch(() => null);
    if (!res.ok || !card) {
      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch agent card JSON",
          uaid,
          cardUrl,
          status: res.status,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      uaid,
      a2aEndpoint,
      cardUrl,
      card,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: "Failed to load agent card JSON", message }, { status: 400 });
  }
}

