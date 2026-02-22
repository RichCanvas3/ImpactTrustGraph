export type SessionPackage = {
  agentId: number | string | bigint;
  chainId: number;
  [key: string]: any;
};

export type AgenticTrustClient = any;

export function getCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function parseDid8004(did8004: string): { chainId: number; agentId: bigint } {
  if (!did8004 || typeof did8004 !== "string") {
    throw new Error("did8004 must be a non-empty string");
  }
  let decoded = did8004;
  try {
    decoded = decodeURIComponent(did8004);
  } catch {
    // ignore
  }
  if (!decoded.startsWith("did:8004:")) {
    throw new Error(`Invalid did:8004 format. Expected did:8004:chainId:agentId, got: ${decoded}`);
  }
  const parts = decoded.split(":");
  if (parts.length < 4) {
    throw new Error(`Invalid did:8004 format. Expected did:8004:chainId:agentId, got: ${decoded}`);
  }
  const chainIdStr = parts[2];
  const agentIdStr = parts.slice(3).join(":");
  const chainId = Number.parseInt(chainIdStr, 10);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error(`Invalid chainId in did:8004: ${chainIdStr}`);
  }
  const agentId = BigInt(agentIdStr);
  if (agentId < 0n) throw new Error(`Invalid agentId in did:8004: ${agentIdStr}`);
  return { chainId, agentId };
}

export function generateAgentCardFromSessionPackage(
  sessionPackage: SessionPackage,
  options?: {
    providerUrl?: string;
    providerOrganization?: string;
    agentName?: string;
    agentDescription?: string;
    agentVersion?: string;
    skills?: any[];
    defaultInputModes?: string[];
    defaultOutputModes?: string[];
    trustModels?: string[];
  },
): any {
  const providerUrl = options?.providerUrl || process.env.PROVIDER_BASE_URL || "";
  const agentName = options?.agentName || process.env.AGENT_NAME || "Agent Provider";
  const agentDescription =
    options?.agentDescription ||
    process.env.AGENT_DESCRIPTION ||
    "A sample agent provider for A2A communication";

  const rawAgentId = sessionPackage?.agentId ?? 0;
  const agentId: string | number = typeof rawAgentId === "bigint" ? rawAgentId.toString() : rawAgentId;
  const agentAddress = process.env.AGENT_ADDRESS || (sessionPackage as any)?.aa || "";
  const agentSignature = process.env.AGENT_SIGNATURE || "";

  return {
    name: agentName,
    description: agentDescription,
    url: providerUrl,
    provider: {
      organization: options?.providerOrganization || process.env.PROVIDER_ORGANIZATION || "A2A Provider",
      url: providerUrl,
    },
    version: options?.agentVersion || process.env.AGENT_VERSION || "0.0.2",
    capabilities: {
      streaming: process.env.CAPABILITY_STREAMING === "true",
      pushNotifications: process.env.CAPABILITY_PUSH_NOTIFICATIONS === "true",
      stateTransitionHistory: process.env.CAPABILITY_STATE_HISTORY === "true",
    },
    defaultInputModes: options?.defaultInputModes || ["text"],
    defaultOutputModes: options?.defaultOutputModes || ["text", "task-status"],
    skills: options?.skills || [],
    registrations: [
      {
        agentId,
        agentAddress,
        signature: agentSignature,
      },
    ],
    trustModels: options?.trustModels || ["feedback"],
    supportsAuthenticatedExtendedCard: false,
    feedbackDataURI: "",
  };
}

export function loadAgentCard(options?: {
  providerUrl?: string;
  providerOrganization?: string;
  agentName?: string;
  agentDescription?: string;
  agentVersion?: string;
  skills?: any[];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  trustModels?: string[];
}): any {
  const agentId = Number.parseInt(process.env.AGENT_ID || "0", 10);
  const chainId = Number.parseInt(process.env.AGENT_CHAIN_ID || "11155111", 10);
  const sessionPackage: SessionPackage = {
    agentId: Number.isFinite(agentId) ? agentId : 0,
    chainId: Number.isFinite(chainId) ? chainId : 11155111,
  } as any;
  return generateAgentCardFromSessionPackage(sessionPackage, options);
}

export async function handleFeedbackAuthRequest(
  client: AgenticTrustClient,
  payload: {
    clientAddress: string;
    agentId?: string | number;
    skillId?: string;
    expirySeconds?: number;
  },
  sessionPackage?: SessionPackage,
): Promise<{
  feedbackAuth: string;
  agentId: string | number;
  clientAddress: string;
  skill?: string;
}> {
  const { clientAddress, agentId: agentIdParam, skillId, expirySeconds } = payload;
  if (!clientAddress) {
    throw new Error("clientAddress is required in payload for agent.feedback.requestAuth skill");
  }

  let agentIdForRequest: string | undefined;
  if (sessionPackage?.agentId) {
    agentIdForRequest = sessionPackage.agentId.toString();
  } else if (agentIdParam) {
    agentIdForRequest = agentIdParam.toString();
  } else {
    agentIdForRequest = process.env.AGENT_ID;
  }

  if (!agentIdForRequest) {
    throw new Error("Agent ID is required. Set AGENT_ID env var or provide in session package.");
  }

  const agent = await client?.agents?.getAgent?.(agentIdForRequest);
  if (!agent) {
    throw new Error("Agent not found. Cannot request feedback auth without agent instance.");
  }

  if (sessionPackage && typeof agent?.setSessionPackage === "function") {
    agent.setSessionPackage(sessionPackage);
  }

  const feedbackAuthResponse = await agent.requestAuth({
    clientAddress,
    agentId: agentIdParam,
    skillId,
    expirySeconds,
  });

  return {
    feedbackAuth: feedbackAuthResponse.feedbackAuth,
    agentId:
      typeof feedbackAuthResponse.agentId === "bigint"
        ? feedbackAuthResponse.agentId.toString()
        : typeof feedbackAuthResponse.agentId === "string"
          ? feedbackAuthResponse.agentId
          : String(feedbackAuthResponse.agentId),
    clientAddress: feedbackAuthResponse.clientAddress,
    skill: feedbackAuthResponse.skill,
  };
}

