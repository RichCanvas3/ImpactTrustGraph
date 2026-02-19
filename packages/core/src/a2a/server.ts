/**
 * A2A Server Utilities
 * Core functionality for building A2A provider applications
 */

import type { Request, Response, NextFunction } from 'express';
// Define types locally to avoid import resolution issues with tsx
// These match the types from @agentic-trust/core/server
export type SessionPackage = {
  agentId: number | string | bigint;
  chainId: number;
  [key: string]: any;
};
export type AgenticTrustClient = any; // Type will be resolved by consumers

// Re-export express types for convenience (express should be a peer dependency)
export type { Request, Response, NextFunction } from 'express';

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  provider: {
    organization: string;
    url: string;
  };
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    examples: string[];
    inputModes: string[];
    outputModes: string[];
  }>;
  registrations: Array<{
    agentId: number | string;
    agentAddress: string;
    signature: string;
  }>;
  trustModels: string[];
  supportsAuthenticatedExtendedCard: boolean;
  feedbackDataURI: string;
}

export interface A2ARequest {
  fromAgentId?: string | number;
  toAgentId?: string | number;
  message?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  skillId?: string;
  auth?: AuthChallenge;
}

export interface AuthChallenge {
  did: string;
  kid: string;
  algorithm: string;
  challenge: string;
  signature: string;
  ethereumAddress?: string;
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
  clientAddress?: string;
}

export interface A2AResponse {
  success: boolean;
  messageId: string;
  response: Record<string, unknown>;
  error?: string;
}

/**
 * Generate agent card from session package
 */
export function generateAgentCardFromSessionPackage(
  sessionPackage: SessionPackage,
  options?: {
    providerUrl?: string;
    providerOrganization?: string;
    agentName?: string;
    agentDescription?: string;
    agentVersion?: string;
    capabilities?: Partial<AgentCard['capabilities']>;
    skills?: AgentCard['skills'];
    defaultInputModes?: string[];
    defaultOutputModes?: string[];
    trustModels?: string[];
  }
): AgentCard {
  const providerUrl = options?.providerUrl || process.env.PROVIDER_BASE_URL || '';
  const agentName = options?.agentName || process.env.AGENT_NAME || 'Agent Provider';
  const agentDescription = options?.agentDescription || process.env.AGENT_DESCRIPTION || 'A sample agent provider for A2A communication';

  // Extract agent info from session package
  // Convert agentId to string | number (handle bigint case)
  const rawAgentId = sessionPackage.agentId || 0;
  const agentId: string | number = typeof rawAgentId === 'bigint' 
    ? rawAgentId.toString() 
    : rawAgentId;
  // SessionPackage doesn't have agentAccount, get from environment or use aa address
  const agentAddress = process.env.AGENT_ADDRESS || (sessionPackage.aa as string) || '';
  const agentSignature = process.env.AGENT_SIGNATURE || '';

  return {
    name: agentName,
    description: agentDescription,
    url: providerUrl,
    provider: {
      organization: options?.providerOrganization || process.env.PROVIDER_ORGANIZATION || 'A2A Provider',
      url: providerUrl,
    },
    version: options?.agentVersion || process.env.AGENT_VERSION || '0.0.2',
    capabilities: {
      streaming: options?.capabilities?.streaming ?? process.env.CAPABILITY_STREAMING === 'true',
      pushNotifications: options?.capabilities?.pushNotifications ?? process.env.CAPABILITY_PUSH_NOTIFICATIONS === 'true',
      stateTransitionHistory: options?.capabilities?.stateTransitionHistory ?? process.env.CAPABILITY_STATE_HISTORY === 'true',
    },
    defaultInputModes: options?.defaultInputModes || ['text'],
    defaultOutputModes: options?.defaultOutputModes || ['text', 'task-status'],
    skills: options?.skills || [],
    registrations: [
      {
        agentId,
        agentAddress,
        signature: agentSignature,
      },
    ],
    trustModels: options?.trustModels || ['feedback'],
    supportsAuthenticatedExtendedCard: false,
    feedbackDataURI: '',
  };
}

/**
 * Load agent card from session package file or environment
 */
export function loadAgentCard(options?: {
  sessionPackagePath?: string;
  providerUrl?: string;
  providerOrganization?: string;
  agentName?: string;
  agentDescription?: string;
  agentVersion?: string;
  capabilities?: Partial<AgentCard['capabilities']>;
  skills?: AgentCard['skills'];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  trustModels?: string[];
}): AgentCard {
  let sessionPackage: SessionPackage | null = null;

  // Try to load from file path or environment variable
  const sessionPackagePath = options?.sessionPackagePath || process.env.AGENTIC_TRUST_SESSION_PACKAGE_PATH;
  if (sessionPackagePath) {
    try {
      // Use dynamic require to avoid tsx static analysis
      let loadSP: (path: string) => SessionPackage;
      try {
        // Use string concatenation and Function constructor to prevent static analysis
        const serverPath = '@agentic-trust/core' + '/server';
        // @ts-ignore - dynamic require using Function to bypass static analysis
        const req = new Function('return require')();
        loadSP = req(serverPath).loadSessionPackage;
      } catch {
        // @ts-ignore - fallback path
        const req = new Function('return require')();
        loadSP = req('@agentic-trust/core/dist/server.js').loadSessionPackage;
      }
      sessionPackage = loadSP(sessionPackagePath);
    } catch (error) {
      console.warn('[A2A Core] Failed to load session package from file, using minimal structure:', error);
      // Create minimal session package - we can't create a full SessionPackage without all required fields
      // So we'll use null and get agent info from environment
      sessionPackage = null;
    }
  } else {
    // No session package available, use null
    sessionPackage = null;
  }

  // If we don't have a session package, create a minimal one from environment
  if (!sessionPackage) {
    const agentId = parseInt(process.env.AGENT_ID || '0', 10);
    const chainId = parseInt(process.env.AGENT_CHAIN_ID || '11155111', 10);
    // Create a minimal structure - we'll need to load a real session package or get agent info another way
    // For now, we'll use environment variables directly in generateAgentCardFromSessionPackage
    sessionPackage = {
      agentId,
      chainId,
    } as Partial<SessionPackage> as SessionPackage;
  }

  return generateAgentCardFromSessionPackage(sessionPackage, options);
}

/**
 * Verify challenge using AgenticTrustClient
 */
/*
export async function verifyChallenge(
  client: AgenticTrustClient,
  auth: AuthChallenge,
  expectedAudience: string
): Promise<VerificationResult> {
  try {
    const verification = await (client as any).verifyChallenge(auth, expectedAudience);
    return {
      valid: verification.valid,
      error: verification.error,
      clientAddress: verification.clientAddress || auth.ethereumAddress || undefined,
    };
  } catch (error) {
    console.error('[A2A Core] Challenge verification error:', error);
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    };
  }
}
*/

/**
 * Handle feedback auth request
 */
export async function handleFeedbackAuthRequest(
  client: AgenticTrustClient,
  payload: {
    clientAddress: string;
    agentId?: string | number;
    skillId?: string;
    expirySeconds?: number;
  },
  sessionPackage?: SessionPackage
): Promise<{
  feedbackAuth: string;
  agentId: string | number;
  clientAddress: string;
  skill?: string;
}> {

  console.info('.............. handleFeedbackAuthRequest', payload, sessionPackage);
  const { clientAddress, agentId: agentIdParam, skillId, expirySeconds } = payload;

  if (!clientAddress) {
    throw new Error('clientAddress is required in payload for agent.feedback.requestAuth skill');
  }

  // Get agent ID from session package or parameter
  let agentIdForRequest: string | undefined;
  if (sessionPackage?.agentId) {
    agentIdForRequest = sessionPackage.agentId.toString();
  } else if (agentIdParam) {
    agentIdForRequest = agentIdParam.toString();
  } else {
    agentIdForRequest = process.env.AGENT_ID;
  }

  if (!agentIdForRequest) {
    throw new Error('Agent ID is required. Set AGENT_ID env var or provide in session package.');
  }

  const agent = await client.agents.getAgent(agentIdForRequest);
  if (!agent) {
    throw new Error('Agent not found. Cannot request feedback auth without agent instance.');
  }

  // Set SessionPackage on agent instance if provided
  // This will be used by requestAuth() instead of the singleton providerApp
  if (sessionPackage) {
    agent.setSessionPackage(sessionPackage);
  }

  console.info('[A2A Core] agent.requestAuth:', agentIdParam, clientAddress, expirySeconds);

  // Use the working approach: call agent.requestAuth() directly
  const feedbackAuthResponse = await agent.requestAuth({
    clientAddress,
    agentId: agentIdParam,
    skillId: skillId,
    expirySeconds,
  });

  return {
    feedbackAuth: feedbackAuthResponse.feedbackAuth,
    agentId: typeof feedbackAuthResponse.agentId === 'bigint' 
      ? feedbackAuthResponse.agentId 
      : (typeof feedbackAuthResponse.agentId === 'string' 
          ? feedbackAuthResponse.agentId 
          : String(feedbackAuthResponse.agentId)),
    clientAddress: feedbackAuthResponse.clientAddress as `0x${string}`,
    skill: feedbackAuthResponse.skill,
  };
}

/**
 * CORS headers helper
 */
export function getCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Middleware to wait for client initialization
 */
export function createClientInitMiddleware(
  clientInitPromise: Promise<void> | null
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (clientInitPromise) {
      try {
        await clientInitPromise;
      } catch (error) {
        console.warn('[A2A Core] Pre-initialization failed, will initialize on demand:', error);
      }
    }
    next();
  };
}

/**
 * Initialize AgenticTrustClient and return promise
 */
export function initializeAgenticTrustClient(): Promise<void> {
  return (async () => {
    try {
      console.log('[A2A Core] Pre-initializing AgenticTrustClient...');
      // Use dynamic require to avoid tsx static analysis
      let getATC: () => Promise<AgenticTrustClient>;
      try {
        // Use string concatenation and Function constructor to prevent static analysis
        const serverPath = '@agentic-trust/core' + '/server';
        // @ts-ignore - dynamic require using Function to bypass static analysis
        const req = new Function('return require')();
        getATC = req(serverPath).getAgenticTrustClient;
      } catch {
        // @ts-ignore - fallback path
        const req = new Function('return require')();
        getATC = req('@agentic-trust/core/dist/server.js').getAgenticTrustClient;
      }
      await getATC();
      console.log('[A2A Core] AgenticTrustClient initialized successfully');
    } catch (error) {
      console.error('[A2A Core] Failed to pre-initialize AgenticTrustClient:', error);
      // Don't throw - we'll initialize on first request if this fails
    }
  })();
}

