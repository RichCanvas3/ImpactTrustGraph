import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  getCorsHeaders,
  handleFeedbackAuthRequest,
  loadAgentCard,
  generateAgentCardFromSessionPackage,
  parseDid8004,
} from './lib/a2a-core.js';

// Define SessionPackage type locally to avoid import resolution issues with tsx
type SessionPackage = {
  agentId: number | string | bigint;
  chainId: number;
  [key: string]: any;
};

/**
 * Recursively convert BigInt values to strings for JSON serialization
 */
function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt);
  }
  
  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInt(value);
    }
    return result;
  }
  
  return obj;
}

// NOTE: The upstream agentic-trust SDKs make the Worker bundle far too large.
// We keep these stubs so the server compiles; related skills will return errors.
const getAgenticTrustClient = async (): Promise<any> => {
  throw new Error("Agentic Trust SDK is disabled in the full-Worker build (size limits).");
};
const processValidationRequests = async (..._args: any[]): Promise<any[]> => {
  throw new Error("Validation processing is disabled in the full-Worker build (size limits).");
};
const getAgentValidationsSummary = async (..._args: any[]): Promise<any> => {
  throw new Error("Validation summary is disabled in the full-Worker build (size limits).");
};

import { getD1Database } from './lib/d1-wrapper.js';
import type { Organization, AgentFeedbackRequest } from './lib/db.js';
import { parseUaidParts } from './lib/uaid.js';

const DEPLOY_TIMESTAMP = new Date().toISOString();

// Key identifier (kid) used in DNS /.well-known/agent and HTTP Message Signatures
// This should match the `kid`/`i` value (e.g. "g1"), not the full public key.
const A2A_KEY_ID = 'g1';

/**
 * Load Ed25519 private key for HTTP Message Signatures from environment.
 * Expected format: PKCS#8 PEM in A2A_ED25519_PRIVATE_KEY_PEM.
 */
function pemToDerBytes(pem: string): Uint8Array | null {
  try {
    const normalized = String(pem || '')
      .replace(/\r/g, '')
      .replace(/-----BEGIN [^-]+-----/g, '')
      .replace(/-----END [^-]+-----/g, '')
      .replace(/\s+/g, '')
      .trim();
    if (!normalized) return null;

    // atob is available in Workers; Buffer is available in Node.
    const bin =
      typeof atob === 'function'
        ? atob(normalized)
        : typeof Buffer !== 'undefined'
          ? Buffer.from(normalized, 'base64').toString('binary')
          : '';
    if (!bin) return null;
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  // Signature is small (~64 bytes). Safe to use string conversion.
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  const btoaFn = (globalThis as any).btoa as ((s: string) => string) | undefined;
  if (typeof btoaFn !== 'function') {
    throw new Error('No base64 encoder available (missing Buffer/btoa)');
  }
  return btoaFn(bin);
}

let a2aPrivateKeyPromise: Promise<any> | null = null;

async function getA2aPrivateKey(): Promise<any | null> {
  if (a2aPrivateKeyPromise) return a2aPrivateKeyPromise;

  const pem = typeof process !== 'undefined' ? process.env.A2A_ED25519_PRIVATE_KEY_PEM : undefined;
  if (!pem) {
    console.warn('[IMPACT-AGENT] A2A_ED25519_PRIVATE_KEY_PEM is not set; HTTP signatures will be omitted.');
    a2aPrivateKeyPromise = Promise.resolve(null);
    return a2aPrivateKeyPromise;
  }

  a2aPrivateKeyPromise = (async () => {
    try {
      const der = pemToDerBytes(pem);
      if (!der) throw new Error('Invalid PEM');
      if (!globalThis.crypto?.subtle) {
        throw new Error('WebCrypto subtle is not available');
      }
      return await globalThis.crypto.subtle.importKey(
        'pkcs8',
        der,
        { name: 'Ed25519' } as any,
        false,
        ['sign'],
      );
    } catch (e) {
      console.error('[IMPACT-AGENT] Failed to import Ed25519 key from A2A_ED25519_PRIVATE_KEY_PEM:', e);
      return null;
    }
  })();

  return a2aPrivateKeyPromise;
}

/**
 * Add HTTP Message Signature headers (RFC 9421 style) to the response.
 * Covers: "AID-Challenge", @method, @target-uri, host, date
 */
async function addHttpSignatureHeaders(c: any, targetUri: string) {
  const key = await getA2aPrivateKey();
  if (!key) return;

  try {
    const method = c.req.method.toUpperCase();
    const created = Math.floor(Date.now() / 1000);
    const host = c.req.header('host') || '';
    // Header name on the wire is "AID-Challenge", but header lookups are case-insensitive
    const aidChallenge = c.req.header('aid-challenge') || c.req.header('AID-Challenge') || '';

    // Ensure we have a Date header that matches what we sign
    const dateHeader = new Date().toUTCString();
    c.header('Date', dateHeader);

    // Signature parameters: label "sig", kid "g1", alg "ed25519"
    const signatureParams =
      '("AID-Challenge" "@method" "@target-uri" "host" "date");' +
      `created=${created};keyid="${A2A_KEY_ID}";alg="ed25519"`;

    // Canonical signature base (order of lines must match covered fields)
    const signatureBase =
      `"AID-Challenge": ${aidChallenge}\n` +
      `"@method": ${method}\n` +
      `"@target-uri": ${targetUri}\n` +
      `"host": ${host}\n` +
      `"date": ${dateHeader}\n` +
      `"@signature-params": ${signatureParams}`;

    const enc = (globalThis as any).TextEncoder ? new (globalThis as any).TextEncoder() : null;
    if (!enc) throw new Error('TextEncoder is not available');
    const data = enc.encode(signatureBase) as Uint8Array;
    const sigBuf = await globalThis.crypto.subtle.sign({ name: 'Ed25519' } as any, key, data);
    const sigB64 = bytesToBase64(new Uint8Array(sigBuf));

    // RFC 9421 headers
    c.header('Signature-Input', `sig=${signatureParams}`);
    c.header('Signature', `sig=:${sigB64}:`);

    console.log(
      '[IMPACT-AGENT] Added HTTP Message Signature headers for A2A GET handshake',
      {
        method,
        targetUri,
        created,
        keyId: A2A_KEY_ID,
        aidChallenge,
        host,
        dateHeader,
        signatureParams,
        signatureBase,
      },
    );
  } catch (e) {
    console.error('[IMPACT-AGENT] Failed to add HTTP Message Signature headers:', e);
  }
}

/**
 * Simple Hono-based Impact Agent Provider
 * Exposes:
 * - GET /.well-known/agent-card.json
 * - POST /api/a2a
 * - GET /health
 *
 * Domain / ENS mapping:
 * - Subdomain: {agent-name}.8004-agent.eth
 * - Local dev: {agent-name}.localhost:3000
 */

interface DomainInfo {
  agentName: string;
  ensName: string;
}

// Create Hono app
const app = new Hono<{ Variables: { domainInfo: DomainInfo }, Bindings: Record<string, any> }>();

// Middleware to populate process.env from Cloudflare bindings
// The core library relies on process.env, but Cloudflare provides env in the request context
app.use('*', async (c, next) => {
  if (c.env && typeof process !== 'undefined') {
    // Copy all bindings to process.env
    // Note: This might not work for all binding types (like D1), but works for strings/secrets
    try {
      Object.keys(c.env).forEach(key => {
        const val = c.env[key];
        if (typeof val === 'string') {
          process.env[key] = val;
        }
      });
      
      // Expose DB binding globally for d1-wrapper
      if (c.env.DB) {
        (globalThis as any).DB = c.env.DB;
      }
    } catch (e) {
      console.warn('[IMPACT-AGENT] Failed to populate process.env from c.env:', e);
    }
  }
  await next();
});

// Middleware to attach domain/ENS info to the request
app.use('*', async (c, next) => {
  const host = c.req.header('host') || '';
  let domainInfo: DomainInfo | undefined;

  // 1) ENS-style host: {agent-name}.8004-agent.(eth|io|com|net|org|xyz)
  const ensHostMatch = host.match(/^([^.]+)\.8004-agent\.(?:eth|io|com|net|org|xyz)/i);
  if (ensHostMatch) {
    const agentName = ensHostMatch[1];
    // Always construct the ENS name with .eth for internal lookup
    domainInfo = { agentName, ensName: `${agentName}.8004-agent.eth` };
  } else {
    // 2) Localhost subdomain: {agent-name}.localhost:3000
    const localMatch = host.match(/^([^.]+)\.localhost(?::\d+)?$/i);
    if (localMatch) {
      const agentName = localMatch[1];
      domainInfo = { agentName, ensName: `${agentName}.8004-agent.eth` };
    }
  }

  // 3) Fallback to environment or default
  if (!domainInfo) {
    const fallbackAgentName = process.env.AGENT_NAME || 'default-itg';
    const fallbackEnsName = `${fallbackAgentName}.8004-agent.eth`;
    domainInfo = {
      agentName: fallbackAgentName,
      ensName: fallbackEnsName,
    };
  }

  c.set('domainInfo', domainInfo);
  await next();
});

// CORS
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    // Expose signature headers so browsers can read them for PKA verification
    exposeHeaders: ['Signature-Input', 'Signature', 'Date'],
  }),
);

/**
 * Health check
 */
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Agent account endpoint: GET /api/agent/account?ensName=...
 * Resolves an agent by ENS name and returns its account address.
 */
app.get('/api/agent/account', async (c) => {
  try {
    const ensNameParam = c.req.query('ensName');
    const { ensName: ensFromDomain } = c.get('domainInfo');
    const ensName = ensNameParam || ensFromDomain;

    if (!ensName) {
      return c.json({
        error: 'ENS name is required. Provide ?ensName=... or use a subdomain like {agent}.localhost:3000',
      }, 400);
    }

    console.log('[Agent Account] Resolving account for ENS name:', ensName);

    const db = await getD1Database();
    if (!db) {
      return c.json(
        {
          error: 'D1 database not available',
          message:
            'Configure D1 binding or set USE_REMOTE_D1=true with Cloudflare credentials for remote access.',
        },
        500,
      );
    }

    const org = await db
      .prepare('SELECT uaid, session_package, agent_card_json FROM organizations WHERE ens_name = ?')
      .bind(ensName)
      .first<{ uaid: string | null; session_package: string | null; agent_card_json?: string | null }>();

    if (!org) {
      return c.json({ error: 'Organization not found for ENS name', ensName }, 404);
    }

    const parsed = parseUaidParts(org.uaid);
    if (!parsed?.agentAccount) {
      return c.json({ error: 'Missing UAID/account for organization', ensName, uaid: org.uaid ?? null }, 400);
    }

    let agentId: string | undefined;
    try {
      const sp = org.session_package ? JSON.parse(org.session_package) : null;
      const raw = sp?.agentId ?? null;
      if (raw != null) agentId = typeof raw === 'bigint' ? raw.toString() : String(raw);
    } catch {
      // ignore
    }
    if (!agentId) {
      try {
        const card = org.agent_card_json ? JSON.parse(org.agent_card_json) : null;
        const raw = card?.agentId ?? card?.agent?.agentId ?? card?.agentInfo?.agentId ?? null;
        if (raw != null) agentId = String(raw);
      } catch {
        // ignore
      }
    }

    return c.json({
      ensName,
      agentId,
      account: parsed.agentAccount,
      chainId: parsed.chainId,
    });
  } catch (error) {
    console.error('[Agent Account] Error:', error);
    return c.json({
      error: 'Failed to get agent account',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

/**
 * Agent Card endpoint: GET /.well-known/agent-card.json
 */
app.get('/.well-known/agent-card.json', async (c) => {
  try {
    const { agentName, ensName } = c.get('domainInfo');

    // UAID-only: do not resolve agent via SDK here; use D1 org record (uaid/session_package/agent_card_json).
    let agentId: string | undefined;
    let agentAccount: string | undefined;
    let chainId = '11155111';
    let agentDid: string | undefined;

    // Fetch organization + session package from D1
    let orgData: Organization | null = null;
    let sessionPackageFromDb: any = null;
    try {
      const db = await getD1Database();
      if (db) {
        console.log('[Agent Card] Querying D1 database for organization:', ensName);
        orgData = await db
          .prepare('SELECT * FROM organizations WHERE ens_name = ?')
          .bind(ensName)
          .first<Organization>();

        if (orgData) {
          console.log('[Agent Card] Found organization in D1:', {
            org_name: orgData.org_name,
            email_domain: orgData.email_domain,
            has_session_package: !!orgData.session_package,
          });

          if (orgData.session_package) {
            try {
              sessionPackageFromDb = JSON.parse(orgData.session_package);
              console.log('[Agent Card] Loaded sessionPackage from database');
            } catch (parseError) {
              console.warn('[Agent Card] Failed to parse sessionPackage from database:', parseError);
            }
          }
        } else {
          console.log('[Agent Card] No organization found in D1 for:', ensName);
        }
      } else {
        console.warn(
          '[Agent Card] D1 database not available. Set USE_REMOTE_D1=true with CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN',
        );
      }
    } catch (error) {
      console.warn('[Agent Card] Error querying D1 database:', error);
    }

    // Note: We only use session package from database, no file fallback
    // If session package is not in database, agentCard will be generated without it

    console.log('[Agent Card] Generating card for:', {
      agentName,
      ensName,
      agentId,
      agentAccount,
      hasOrgData: !!orgData,
    });

    const displayName = orgData?.org_name || agentName;
    const description = `${displayName} - Impact Agent`;

    const url = new URL(c.req.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    // Core skills definition
    const skills = [
      {
        id: 'general_movie_chat',
        name: 'General Movie Chat',
        description: 'Answer general questions or chat about movies, actors, directors.',
        tags: ['movies', 'actors', 'directors'],
        examples: [
          'Tell me about the plot of Inception.',
          'Recommend a good sci-fi movie.',
          'Who directed The Matrix?',
          'What other movies has Scarlett Johansson been in?',
          'Find action movies starring Keanu Reeves',
          'Which came out first, Jurassic Park or Terminator 2?',
        ],
        inputModes: ['text'],
        outputModes: ['text', 'task-status'],
      },
      {
        id: 'agent.feedback.requestAuth',
        name: 'agent.feedback.requestAuth',
        tags: ['erc8004', 'feedback', 'auth', 'a2a'],
        examples: [
          'Client requests feedbackAuth after receiving results',
          'Request feedback authorization for submitting agent feedback',
        ],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description:
          'Issue a signed ERC-8004 feedbackAuth token for a client to submit feedback to the identity registry. Requires clientAddress in payload.',
      },
      {
        id: 'agent.status',
        name: 'agent.status',
        tags: ['a2a', 'status', 'health'],
        examples: ['Check agent status', 'Return agent health/status'],
        inputModes: ['text', 'json'],
        outputModes: ['json'],
        description: 'Return basic status/health information for this agent endpoint.',
      },
      {
        id: 'agent.validation.respond',
        name: 'agent.validation.respond',
        tags: ['erc8004', 'validation', 'ens', 'a2a'],
        examples: [
          'Process ENS validation requests for agents',
          'Respond to validation requests for agent validation',
        ],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description:
          'Process validation requests by validating ENS names and submitting validation responses. Requires agentId in payload.',
      },
    ];

    // Add agents-admin only skills
    // These skills are only available on the agents-admin subdomain
    if (agentName === 'agents-admin') {
      skills.push({
        id: 'agent.feedback.request',
        name: 'agent.feedback.request',
        tags: ['erc8004', 'feedback', 'request', 'a2a', 'admin'],
        examples: [
          'Request to give feedback to an agent',
          'Submit a feedback request for an agent',
        ],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description:
          'Request to give feedback to an agent. Requires clientAddress (EOA), targetAgentId (agent ID to give feedback to), and comment (reason for feedback) in payload.',
      });
      skills.push({
        id: 'agent.feedback.getRequests',
        name: 'agent.feedback.getRequests',
        tags: ['erc8004', 'feedback', 'query', 'a2a', 'admin'],
        examples: [
          'Get all feedback requests for a wallet address',
          'Query feedback requests by client address',
        ],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description:
          'Get all feedback requests associated with a wallet address. Requires clientAddress (EOA) in payload.',
      });
      skills.push({
        id: 'agent.feedback.getRequestsByAgent',
        name: 'agent.feedback.getRequestsByAgent',
        tags: ['erc8004', 'feedback', 'query', 'a2a', 'admin'],
        examples: [
          'Get all feedback requests for a specific agent',
          'Query feedback requests by target agent ID',
        ],
        inputModes: ['text', 'json'],
        outputModes: ['text', 'json'],
        description:
          'Get all feedback requests for a specific agent. Requires targetAgentId (agent ID) in payload.',
      });
    }

    // UAID-only: derive chain/account and agentId from D1 data.
    try {
      const parsed = parseUaidParts(orgData?.uaid ?? null);
      if (parsed?.chainId) chainId = String(parsed.chainId);
      if (parsed?.agentAccount) agentAccount = parsed.agentAccount;
      if (!agentId && sessionPackageFromDb?.agentId != null) {
        const raw = sessionPackageFromDb.agentId;
        agentId = typeof raw === 'bigint' ? raw.toString() : String(raw);
      }
      if (!agentId && typeof orgData?.agent_card_json === 'string' && orgData.agent_card_json.trim()) {
        const card = JSON.parse(orgData.agent_card_json);
        const raw = card?.agentId ?? card?.agent?.agentId ?? card?.agentInfo?.agentId ?? null;
        if (raw != null) agentId = String(raw);
      }
      if (agentAccount && chainId) {
        agentDid = `did:ethr:${chainId}:${agentAccount}`;
      }
    } catch {
      // ignore
    }

    let agentCard: any;
    if (sessionPackageFromDb) {
      agentCard = generateAgentCardFromSessionPackage(sessionPackageFromDb as SessionPackage, {
        providerUrl: baseUrl,
        agentName: displayName,
        agentDescription: description,
        skills,
      });
    } else {
      agentCard = loadAgentCard({
        providerUrl: baseUrl,
        agentName: displayName,
        agentDescription: description,
        skills,
      });
    }

    // Ensure a2aEndpoint is set correctly (/api/a2a, original behavior)
    (agentCard as any).a2aEndpoint = `${baseUrl}/api/a2a`;

    // Enrich metadata
    if (orgData) {
      (agentCard as any).metadata = {
        ...((agentCard as any).metadata || {}),
        organization: {
          org_name: orgData.org_name,
          email_domain: orgData.email_domain,
          org_address: orgData.org_address,
        },
        ensName: ensName,
        agentId,
        chainId: chainId ? Number(chainId) : undefined,
        agentAccount: agentAccount,
        did: agentDid,
      } as any;
    } else {
      (agentCard as any).metadata = {
        ...((agentCard as any).metadata || {}),
        ensName: ensName,
        agentId,
        chainId: chainId ? Number(chainId) : undefined,
        agentAccount,
        did: agentDid,
      } as any;
    }

    const headers = getCorsHeaders();
    Object.entries(headers).forEach(([key, value]) => c.header(key, value));

    // Serialize BigInt values in agentCard before returning
    const serializedAgentCard = serializeBigInt(agentCard);
    return c.json(serializedAgentCard);
  } catch (error) {
    console.error('[Agent Card] Error generating agent card:', error);
    return c.json({ error: 'Failed to generate agent card', message: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

/**
 * Simple Agent discovery endpoint: GET /.well-known/agent
 * Returns a minimal A2A descriptor document.
 */
app.get('/.well-known/agent', async (c) => {
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  // u: A2A endpoint for this agent instance
  const a2aUrl = `${baseUrl}/api/a2a`;

  const payload = {
    v: 'aid1',
    u: a2aUrl,
    p: 'a2a',
    s: 'Test',
    k: 'z4DJEoFdJsd4WnGJK1ebLoQnxz1vaLGgHBYoZ1Ycg4uXY',
    i: 'g1',
  };

  return c.json(payload);
});

/**
 * A2A GET handshake endpoint: supports HTTP Message Signatures for key proof.
 */
async function handleA2aGet(c: any) {
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const targetUri = `${baseUrl}${url.pathname}`;

  const body = {
    status: 'ok',
    endpoint: targetUri,
    method: 'GET',
  };

  const headers = getCorsHeaders();
  Object.entries(headers).forEach(([key, value]) => c.header(key, value));

  // Attach HTTP Message Signature headers if key is configured
  await addHttpSignatureHeaders(c, targetUri);

  return c.json(body);
}

/**
 * Core A2A handler used for both POST / and POST /api/a2a
 */
async function handleA2aRequest(c: any) {
  console.log('\n\n\n');
  console.log('========================================');
  console.log('[IMPACT-AGENT] POST A2A RECEIVED');
  console.log('[IMPACT-AGENT] Timestamp:', new Date().toISOString());
  console.log('[IMPACT-AGENT] Headers:', JSON.stringify(c.req.header(), null, 2));
  
  let body: any;
  try {
    body = await c.req.json();
    console.log('[IMPACT-AGENT] Body:', JSON.stringify(body, null, 2));
  } catch (e) {
    console.error('[IMPACT-AGENT] Failed to parse JSON body:', e);
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }
  
  console.log('========================================');
  console.log('\n\n\n');

  try {
    const { fromAgentId, toAgentId, message, payload, metadata, skillId, auth } = body;

    const { agentName, ensName } = c.get('domainInfo');

    // Resolve agent info (UAID-only) from D1 organizations table.
    let agentId: string | undefined;
    let agentAccount: string | undefined;
    let chainId = '11155111';
    try {
      const db = await getD1Database();
      if (db && ensName) {
        const org = await db
          .prepare('SELECT uaid, session_package, agent_card_json FROM organizations WHERE ens_name = ?')
          .bind(ensName)
          .first<{ uaid: string | null; session_package: string | null; agent_card_json?: string | null }>();
        const parsed = parseUaidParts(org?.uaid ?? null);
        if (parsed?.agentAccount) agentAccount = parsed.agentAccount;
        if (parsed?.chainId) chainId = String(parsed.chainId);
        try {
          const sp = org?.session_package ? JSON.parse(org.session_package) : null;
          const raw = sp?.agentId ?? null;
          if (raw != null) agentId = typeof raw === 'bigint' ? raw.toString() : String(raw);
        } catch {
          // ignore
        }
        if (!agentId) {
          try {
            const card = org?.agent_card_json ? JSON.parse(org.agent_card_json) : null;
            const raw = card?.agentId ?? card?.agent?.agentId ?? card?.agentInfo?.agentId ?? null;
            if (raw != null) agentId = String(raw);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    console.log('[IMPACT-AGENT] Processing A2A for agent:', { agentName, ensName, agentId, agentAccount });

    // Validate base fields
    // NOTE: Previously we required fromAgentId and toAgentId when no skillId was provided.
    // This broke generic MCP / AID handshakes that only probe the endpoint without IDs.
    // We now allow requests without these IDs and let individual skills enforce their own requirements.
    if (!skillId && (!fromAgentId || !toAgentId)) {
      console.warn(
        '[IMPACT-AGENT] A2A request without fromAgentId/toAgentId and no skillId – treating as generic handshake/echo',
      );
    }

    // Auth challenges are currently treated as optional metadata in this Worker build.
    // (Full challenge verification requires heavier dependencies than fit the Worker size limit.)
    if (!auth) console.warn('[IMPACT-AGENT] A2A request received without authentication');

    console.log('[IMPACT-AGENT] Received A2A message:', {
      fromAgentId,
      toAgentId,
      message,
      payload,
      metadata,
      skillId,
      timestamp: new Date().toISOString(),
    });

    // Check if this is a feedbackAuth request
    if (skillId === 'agent.feedback.requestAuth') {
      console.log('[IMPACT-AGENT] ========================================');
      console.log('[IMPACT-AGENT] DETECTED: Feedback Auth Request');
      console.log('[IMPACT-AGENT] ========================================');
      console.log('[IMPACT-AGENT] Feedback Auth Request Details:', {
        skillId,
        clientAddress: (payload as any)?.clientAddress,
        agentId: (payload as any)?.agentId,
        agentName: (payload as any)?.agentName,
        chainId: (payload as any)?.chainId,
        ensName,
        agentIdFromDomain: agentId,
      });
    }

    const responseContent: Record<string, unknown> = {
      received: true,
      processedAt: new Date().toISOString(),
      deployTimestamp: DEPLOY_TIMESTAMP,
      echo: message || 'Message received',
      ...(payload && { receivedPayload: payload }),
      agentName,
      ensName,
    };

    // Skill handlers
    if (skillId === 'agent.status' || skillId === 'a2a.status' || skillId === 'status') {
      responseContent.skill = 'agent.status';
      responseContent.status = {
        ok: true,
        agentName,
        ensName,
        agentId: agentId || null,
        timestamp: new Date().toISOString(),
        deployTimestamp: DEPLOY_TIMESTAMP,
      };
      return c.json({
        success: true,
        messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        response: responseContent,
      });
    } else if (skillId === 'general_movie_chat') {
      const userMessage = (message || '').toLowerCase();
      if (userMessage.includes('inception')) {
        responseContent.response =
          'Inception is a 2010 science fiction film directed by Christopher Nolan. It follows Dom Cobb (Leonardo DiCaprio), a skilled thief who enters people\'s dreams to steal secrets from their subconscious. The film explores themes of reality, dreams, and the nature of consciousness.';
      } else if (userMessage.includes('matrix') || userMessage.includes('keanu')) {
        responseContent.response =
          "The Matrix is a 1999 science fiction film directed by the Wachowskis, starring Keanu Reeves as Neo. It's a groundbreaking film that explores themes of reality, simulation, and human consciousness.";
      } else if (userMessage.includes('recommend') || userMessage.includes('sci-fi')) {
        responseContent.response =
          'Here are some great sci-fi movie recommendations: Blade Runner 2049, Interstellar, The Matrix, Ex Machina, and Arrival.';
      } else {
        responseContent.response =
          "I'd be happy to help with movie questions! Try asking about specific movies, actors, directors, or request recommendations. For example: \"Tell me about Inception\" or \"Recommend a good sci-fi movie.\"";
      }
      responseContent.skill = 'general_movie_chat';
    } else if (skillId === 'agent.feedback.requestAuth') {
      try {
        const atClient = await getAgenticTrustClient();
        const clientAddress = (payload as any)?.clientAddress as string | undefined;
        const { agentId: agentIdParam, expirySeconds, feedbackRequestId } = (payload || {}) as {
          agentId?: string | number;
          expirySeconds?: number;
          feedbackRequestId?: number | string;
        };

        if (!clientAddress) {
          responseContent.error =
            'clientAddress is required in payload for agent.feedback.requestAuth skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        const resolvedAgentId = agentIdParam || (agentId ? parseInt(agentId, 10) : undefined);
        if (!resolvedAgentId) {
          responseContent.error =
            'Agent ID is required. Could not resolve agent ID from ENS name or payload.';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        // Load session package from database (required, no file fallback)
        let sessionPackage: SessionPackage | undefined;
        try {
          const db = await getD1Database();
          if (!db) {
            throw new Error('D1 database is not available. Cannot load session package.');
          }
          
          console.log('[IMPACT-AGENT] Loading session package from database for:', ensName);
          const org = await db
            .prepare('SELECT session_package FROM organizations WHERE ens_name = ?')
            .bind(ensName)
            .first<{ session_package: string | null }>();
          
          if (org?.session_package) {
            sessionPackage = JSON.parse(org.session_package);
            console.log('[IMPACT-AGENT] Session package loaded from database');
            console.log('[IMPACT-AGENT] Session package has secret:', !!(sessionPackage as any)?.secret);
            console.log('[IMPACT-AGENT] Session package agentId:', (sessionPackage as any)?.agentId);
          } else {
            throw new Error(`No session package found in database for: ${ensName}. Please store the session package in the organizations table.`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error('[IMPACT-AGENT] Failed to load session package from database:', errorMessage);
          responseContent.error = `Session package not available. ${errorMessage}`;
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 500);
        }

        // The sessionPackage is passed to handleFeedbackAuthRequest
        console.log('[IMPACT-AGENT] Calling handleFeedbackAuthRequest with sessionPackage:', {
          hasSessionPackage: !!sessionPackage,
          agentId: (sessionPackage as any)?.agentId,
          hasSecret: !!(sessionPackage as any)?.secret,
        });

        // Use core utility (with new + legacy fallback)
        const feedbackAuthResponse = await handleFeedbackAuthRequest(
          atClient as any,
          {
            clientAddress,
            agentId: resolvedAgentId,
            skillId,
            expirySeconds,
          },
          sessionPackage,
        );

        responseContent.feedbackAuth = feedbackAuthResponse.feedbackAuth;
        responseContent.agentId = feedbackAuthResponse.agentId;
        responseContent.clientAddress = feedbackAuthResponse.clientAddress;
        responseContent.skill = feedbackAuthResponse.skill;

        console.log('[IMPACT-AGENT] Feedback auth created successfully:', {
          agentId: feedbackAuthResponse.agentId,
          clientAddress: feedbackAuthResponse.clientAddress,
          hasFeedbackAuth: !!feedbackAuthResponse.feedbackAuth,
        });

        // Update or create feedback request record with feedback auth
        try {
          const db = await getD1Database();
          if (db) {
            const now = Date.now();
            const feedbackAuthJson = JSON.stringify(feedbackAuthResponse.feedbackAuth);
            let updated = false;
            let effectiveRequestId: number | undefined;
            
            console.log('[IMPACT-AGENT] Starting feedback request update logic:', {
              feedbackRequestId,
              clientAddress: clientAddress.toLowerCase(),
              resolvedAgentId: String(resolvedAgentId),
            });
            
            // If feedbackRequestId is provided, update that specific record
            if (feedbackRequestId !== undefined && feedbackRequestId !== null) {
              console.log('[IMPACT-AGENT] FeedbackRequestId provided, attempting to update by ID:', feedbackRequestId);
              const requestId = typeof feedbackRequestId === 'string' 
                ? parseInt(feedbackRequestId, 10) 
                : Number(feedbackRequestId);
              
              console.log('[IMPACT-AGENT] Parsed requestId:', requestId, 'isFinite:', Number.isFinite(requestId));
              
              if (Number.isFinite(requestId)) {
                // Verify the record exists and matches the client/agent
                console.log('[IMPACT-AGENT] Querying for feedback request:', {
                  requestId,
                  clientAddress: clientAddress.toLowerCase(),
                  targetAgentId: String(resolvedAgentId),
                });
                
                const existing = await db
                  .prepare(
                    'SELECT id FROM agent_feedback_requests WHERE id = ? AND client_address = ? AND target_agent_id = ?'
                  )
                  .bind(requestId, clientAddress.toLowerCase(), String(resolvedAgentId))
                  .first<{ id: number }>();

                console.log('[IMPACT-AGENT] Query result:', existing);

                if (existing?.id) {
                  // Update the specific record by ID
                  await db
                    .prepare(
                      'UPDATE agent_feedback_requests SET feedback_auth = ?, status = ?, updated_at = ? WHERE id = ?'
                    )
                    .bind(feedbackAuthJson, 'processed', now, requestId)
                    .run();
                  console.log('[IMPACT-AGENT] Updated feedback request by ID with feedback auth:', requestId);
                  updated = true;
                  effectiveRequestId = existing.id;
                  console.log('[IMPACT-AGENT] Set effectiveRequestId to:', effectiveRequestId);
                } else {
                  console.warn('[IMPACT-AGENT] Feedback request ID not found or does not match client/agent:', {
                    requestId,
                    clientAddress: clientAddress.toLowerCase(),
                    targetAgentId: String(resolvedAgentId),
                    existing,
                  });
                }
              } else {
                console.warn('[IMPACT-AGENT] Invalid requestId (not a number):', requestId);
              }
            } else {
              console.log('[IMPACT-AGENT] No feedbackRequestId provided in payload');
            }
            
            // If no feedbackRequestId provided, or if the ID lookup failed, use existing logic
            if (!updated) {
              console.log('[IMPACT-AGENT] No update yet, trying to find existing feedback request by client/agent');
              // Check if a feedback request already exists for this client and agent
              const existing = await db
                .prepare(
                  'SELECT id FROM agent_feedback_requests WHERE client_address = ? AND target_agent_id = ?'
                )
                .bind(clientAddress.toLowerCase(), String(resolvedAgentId))
                .first<{ id: number }>();

              console.log('[IMPACT-AGENT] Existing feedback request lookup result:', existing);

              if (existing?.id) {
                // Update existing record
                await db
                  .prepare(
                    'UPDATE agent_feedback_requests SET feedback_auth = ?, status = ?, updated_at = ? WHERE id = ?'
                  )
                  .bind(feedbackAuthJson, 'processed', now, existing.id)
                  .run();
                console.log('[IMPACT-AGENT] Updated existing feedback request with feedback auth:', existing.id);
                effectiveRequestId = existing.id;
                console.log('[IMPACT-AGENT] Set effectiveRequestId to:', effectiveRequestId);
              } else {
                // Create new record
                console.log('[IMPACT-AGENT] No existing request found, creating new feedback request record');
                const result = await db
                  .prepare(
                    'INSERT INTO agent_feedback_requests (client_address, target_agent_id, comment, status, feedback_auth, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
                  )
                  .bind(
                    clientAddress.toLowerCase(),
                    String(resolvedAgentId),
                    'Feedback auth requested via A2A',
                    'processed',
                    feedbackAuthJson,
                    now,
                    now
                  )
                  .run();
                console.log('[IMPACT-AGENT] Created new feedback request record with feedback auth:', result.meta.last_row_id);
                effectiveRequestId = result.meta.last_row_id as number;
                console.log('[IMPACT-AGENT] Set effectiveRequestId to:', effectiveRequestId);
              }
            }
            
            console.log('[IMPACT-AGENT] Final effectiveRequestId before message creation:', effectiveRequestId);

            // If we have an effective request id, send a message back to the requester
            if (effectiveRequestId !== undefined) {
              console.log('[IMPACT-AGENT] ========================================');
              console.log('[IMPACT-AGENT] Creating notification message for feedback auth approval');
              console.log('[IMPACT-AGENT] ========================================');
              
              // Build fromAgentDid - need resolvedAgentId (number) and chainId (number)
              const chainIdNum = chainId ? Number(chainId) : undefined;
              const fromAgentDid = resolvedAgentId && chainIdNum && Number.isFinite(chainIdNum)
                ? `did:8004:${chainIdNum}:${resolvedAgentId}`
                : undefined;
              
              console.log('[IMPACT-AGENT] Message details:', {
                effectiveRequestId,
                clientAddress,
                resolvedAgentId,
                chainId,
                chainIdNum,
                fromAgentDid,
                fromAgentName: ensName,
                contextType: 'feedback_auth_granted',
              });
              
              try {
                console.log('[IMPACT-AGENT] Inserting message into database...');
                const messageResult = await db
                  .prepare(
                    'INSERT INTO messages (from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                  )
                  .bind(
                    null,
                    fromAgentDid || null,
                    ensName || null,
                    clientAddress.toLowerCase(),
                    null,
                    null,
                    'Feedback authorization granted',
                    'Your request to give feedback has been approved. Open the ITG dashboard to submit your feedback for this agent.',
                    'feedback_auth_granted',
                    String(effectiveRequestId),
                    now,
                    null,
                  )
                  .run();
                
                console.log('[IMPACT-AGENT] Message inserted successfully. Message ID:', messageResult.meta.last_row_id);
                console.log('[IMPACT-AGENT] Created inbox message notifying client of feedback auth:', {
                  messageId: messageResult.meta.last_row_id,
                  clientAddress,
                  requestId: effectiveRequestId,
                  fromAgentDid,
                  fromAgentName: ensName,
                });
                console.log('[IMPACT-AGENT] ========================================');
                console.log('[IMPACT-AGENT] Notification message creation completed');
                console.log('[IMPACT-AGENT] ========================================');
              } catch (messageError) {
                console.error('[IMPACT-AGENT] ========================================');
                console.error('[IMPACT-AGENT] Failed to create notification message:', messageError);
                console.error('[IMPACT-AGENT] Error details:', messageError instanceof Error ? messageError.stack : messageError);
                console.error('[IMPACT-AGENT] ========================================');
                // Don't fail the whole request if message creation fails
              }
            } else {
              console.warn('[IMPACT-AGENT] No effectiveRequestId available, skipping notification message creation');
              console.warn('[IMPACT-AGENT] Debug info:', {
                feedbackRequestId,
                updated,
              });
            }
          } else {
            console.warn('[IMPACT-AGENT] Database not available, cannot save feedback request record');
          }
        } catch (dbError) {
          console.error('[IMPACT-AGENT] Error saving feedback request record:', dbError);
          // Don't fail the request if database save fails
        }
      } catch (error: any) {
        console.error('[IMPACT-AGENT] Error creating feedback auth:', error);
        responseContent.error = error?.message || 'Failed to create feedback auth';
        responseContent.skill = skillId;
      }
    } else if (skillId === 'agent.validation.respond') {
      // Validation respond skill handler
      try {
        responseContent.skill = skillId;
        const agentIdParam =
          (payload as any)?.agentId ??
          (payload as any)?.agentID ??
          (metadata as any)?.agentId ??
          (metadata as any)?.agentID ??
          agentId;
        
        if (!agentIdParam) {
          responseContent.error = 'agentId is required in payload for agent.validation.respond skill';
          responseContent.success = false;
          responseContent.message = responseContent.error;
        } else {
          const resolvedAgentId = String(agentIdParam);
          const resolvedChainId =
            typeof (payload as any)?.chainId === 'number'
              ? (payload as any).chainId
              : typeof (metadata as any)?.chainId === 'number'
                ? (metadata as any).chainId
                : Number.parseInt(chainId, 10) || 11155111;
          const requestHash = (payload as any)?.requestHash as string | undefined;
          
          console.log('[IMPACT-AGENT] ========================================');
          console.log('[IMPACT-AGENT] DETECTED: Validation Respond Request');
          console.log('[IMPACT-AGENT] ========================================');
          console.log('[IMPACT-AGENT] Validation Request Details:', {
            skillId,
            agentId: resolvedAgentId,
            chainId: resolvedChainId,
            requestHash: requestHash || 'ALL',
            ensName,
          });
          
          // Load session package from database (required, no file fallback)
          let sessionPackage: SessionPackage | undefined;
          try {
            const db = await getD1Database();
            if (!db) {
              throw new Error('D1 database is not available. Cannot load session package.');
            }
            
            console.log('[IMPACT-AGENT] Loading session package from database for:', ensName);
            const org = await db
              .prepare('SELECT session_package FROM organizations WHERE ens_name = ?')
              .bind(ensName)
              .first<{ session_package: string | null }>();
            
            if (org?.session_package) {
              sessionPackage = JSON.parse(org.session_package);
              console.log('[IMPACT-AGENT] Session package loaded from database');
              console.log('[IMPACT-AGENT] Session package structure:', {
                hasAgentId: !!(sessionPackage as any)?.agentId,
                hasChainId: !!(sessionPackage as any)?.chainId,
                hasSignedDelegation: !!(sessionPackage as any)?.signedDelegation,
                signedDelegationKeys: (sessionPackage as any)?.signedDelegation ? Object.keys((sessionPackage as any).signedDelegation) : [],
                hasSecret: !!(sessionPackage as any)?.secret,
                hasAa: !!(sessionPackage as any)?.aa,
              });
            } else {
              throw new Error(`No session package found in database for: ${ensName}. Please store the session package in the organizations table.`);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('[IMPACT-AGENT] Failed to load session package from database:', errorMessage);
            throw new Error(`Failed to load session package from database: ${errorMessage}`);
          }
          
          if (!sessionPackage) {
            throw new Error('SessionPackage is required for validation. Please store the session package in the database.');
          }
          
          console.log('[IMPACT-AGENT] Processing validation requests via internal validation service');
          console.log('[IMPACT-AGENT] Agent ID:', resolvedAgentId, 'Chain ID:', resolvedChainId, 'Request Hash:', requestHash || 'ALL');
          
          // Process validation requests using internal validation service with sessionPackage
          const validationResults = await processValidationRequests(
            sessionPackage,
            resolvedChainId,
            resolvedAgentId,
            requestHash,
          );
          
          // Format response similar to the external validator service
          const successCount = validationResults.filter((r: any) => r.success).length;
          const failureCount = validationResults.filter((r: any) => !r.success).length;
          
          // Serialize BigInt values in validationResults before adding to response
          const serializedResults = serializeBigInt(validationResults);
          
          responseContent.validationResult = {
            success: true,
            chainId: resolvedChainId,
            processed: validationResults.length,
            successful: successCount,
            failed: failureCount,
            results: serializedResults,
          };
          
          // Also fetch validation summary
          try {
            const summary = await getAgentValidationsSummary(resolvedChainId, resolvedAgentId);
            // Serialize BigInt values in summary before adding to response
            responseContent.validationSummary = serializeBigInt(summary);
          } catch (summaryError) {
            responseContent.summaryError =
              summaryError instanceof Error
                ? summaryError.message
                : 'Failed to load validation summary';
          }

          // Send notification message to requester after successful validation processing
          if (successCount > 0 && requestHash) {
            try {
              const db = await getD1Database();
              if (!db) {
                console.warn('[IMPACT-AGENT] D1 database not available for notification message');
              } else {
                // Look up the original validation request message to get requester details
                const originalMessage = await db
                  .prepare('SELECT from_agent_did, from_agent_name, to_agent_did FROM messages WHERE context_type = ? AND context_id = ? LIMIT 1')
                  .bind('validation_request', requestHash)
                  .first<{ from_agent_did: string | null; from_agent_name: string | null; to_agent_did: string | null }>();

                if (originalMessage && originalMessage.from_agent_did) {
                  // Send notification to the requester (from_agent_did)
                  const validatorAgentDid = originalMessage.to_agent_did;
                  const requesterAgentDid = originalMessage.from_agent_did;
                  const requesterAgentName = originalMessage.from_agent_name;

                  const validatorDid = validatorAgentDid || `did:8004:${resolvedChainId}:${agentId}`;
                  
                  // Construct validator agent name from current agent context
                  const validatorAgentName = ensName || null;

                  const now = Date.now();
                  const messageBody = `Your validation request has been processed successfully. ${successCount} validation(s) completed.\n\nRequest Hash: ${requestHash}`;

                  await db
                    .prepare(
                      'INSERT INTO messages (from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    )
                    .bind(
                      null,
                      validatorDid || null,
                      validatorAgentName || null,
                      null,
                      requesterAgentDid || null,
                      requesterAgentName || null,
                      'Validation request processed',
                      messageBody,
                      'validation_response',
                      requestHash,
                      now,
                      null,
                    )
                    .run();

                  console.log('[IMPACT-AGENT] Created notification message for validation response:', {
                    requestHash,
                    validatorAgentDid: validatorDid,
                    requesterAgentDid,
                    successfulValidations: successCount,
                  });
                } else {
                  console.warn('[IMPACT-AGENT] Could not find original validation request message for requestHash:', requestHash);
                }
              }
            } catch (messageError) {
              console.warn('[IMPACT-AGENT] Failed to create validation response notification message:', messageError);
              // Don't fail the whole request if message creation fails
            }
          }
        }
      } catch (validationError: any) {
        console.error('[IMPACT-AGENT] Error processing validation request:', validationError);
        const errorMessage = validationError instanceof Error
          ? validationError.message
          : 'Failed to process validation request';
        responseContent.error = errorMessage;
        responseContent.success = false;
        // Ensure the error is visible to the caller
        responseContent.message = errorMessage;
      }
    } else if (skillId === 'agent.feedback.request') {
      // This skill is only accessible on the agents-admin subdomain
      if (agentName !== 'agents-admin') {
        responseContent.error = 'agent.feedback.request skill is only available on the agents-admin subdomain';
        responseContent.skill = skillId;
        return c.json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        }, 403);
      }

      try {
        const clientAddress = payload?.clientAddress || payload?.client_address;
        const targetAgentId = payload?.targetAgentId || payload?.target_agent_id || payload?.agentId;
        const targetAgentDid = payload?.targetAgentDid || payload?.agentDid || null;
        const targetAgentName = payload?.targetAgentName || payload?.agentName || null;
        const comment = payload?.comment || '';

        if (!clientAddress) {
          responseContent.error = 'clientAddress (EOA address) is required in payload for agent.feedback.request skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        if (!targetAgentId) {
          responseContent.error = 'targetAgentId (agent ID to give feedback to) is required in payload for agent.feedback.request skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        if (!comment || comment.trim().length === 0) {
          responseContent.error = 'comment (reason for feedback) is required in payload for agent.feedback.request skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        // Store feedback request in database
        const db = await getD1Database();
        if (!db) {
          throw new Error('D1 database is not available. Cannot store feedback request.');
        }

        const now = Date.now();
        const result = await db
          .prepare(
            'INSERT INTO agent_feedback_requests (client_address, target_agent_id, comment, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .bind(clientAddress, String(targetAgentId), comment.trim(), 'pending', now, now)
          .run();

        const feedbackRequestId = result.meta.last_row_id;

        console.log('[IMPACT-AGENT] Stored feedback request:', {
          clientAddress,
          targetAgentId: String(targetAgentId),
          comment: comment.trim(),
          id: feedbackRequestId,
        });

        // Also create a corresponding inbox message so the request shows in messaging UIs
        try {
          const messagesDb = db;
          const messageBody = `Feedback request for agent ${targetAgentName || String(
            targetAgentId,
          )} (ID: ${String(targetAgentId)}):\n\n${comment.trim()}`;

          await messagesDb
            .prepare(
              'INSERT INTO messages (from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .bind(
              clientAddress.toLowerCase(),
              null,
              null,
              null,
              targetAgentDid,
              targetAgentName,
              'Feedback request',
              messageBody,
              'feedback_request',
              String(feedbackRequestId),
              now,
              null,
            )
            .run();
          console.log('[IMPACT-AGENT] Created inbox message for feedback request:', {
            feedbackRequestId,
            clientAddress,
            targetAgentDid,
            targetAgentName,
          });
        } catch (msgError) {
          console.warn('[IMPACT-AGENT] Failed to create inbox message for feedback request:', msgError);
        }

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.feedbackRequest = {
          id: feedbackRequestId,
          clientAddress,
          targetAgentId: String(targetAgentId),
          comment: comment.trim(),
          status: 'pending',
          createdAt: now,
        };
        responseContent.message = 'Feedback request stored successfully';
      } catch (error: any) {
        console.error('[IMPACT-AGENT] Error processing feedback request:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to process feedback request';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'agent.feedback.getRequests') {
      // This skill is only accessible on the agents-admin subdomain
      if (agentName !== 'agents-admin') {
        responseContent.error = 'agent.feedback.getRequests skill is only available on the agents-admin subdomain';
        responseContent.skill = skillId;
        return c.json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        }, 403);
      }

      try {
        const clientAddress = payload?.clientAddress || payload?.client_address;

        if (!clientAddress) {
          responseContent.error = 'clientAddress (EOA address) is required in payload for agent.feedback.getRequests skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        // Validate address format (basic check)
        if (!/^0x[a-fA-F0-9]{40}$/.test(clientAddress)) {
          responseContent.error = 'Invalid clientAddress format. Must be a valid Ethereum address (0x followed by 40 hex characters)';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        // Query database for feedback requests
        const db = await getD1Database();
        if (!db) {
          throw new Error('D1 database is not available. Cannot query feedback requests.');
        }

        console.log('[IMPACT-AGENT] Querying feedback requests for client address:', clientAddress);

        const requests = await db
          .prepare(
            'SELECT id, client_address, target_agent_id, comment, status, feedback_auth, feedback_tx_hash, created_at, updated_at FROM agent_feedback_requests WHERE client_address = ? ORDER BY created_at DESC'
          )
          .bind(clientAddress.toLowerCase())
          .all<AgentFeedbackRequest>();

        const feedbackRequests = (requests.results || []).map((req: AgentFeedbackRequest) => ({
          id: req.id,
          clientAddress: req.client_address,
          targetAgentId: req.target_agent_id,
          comment: req.comment,
          status: req.status,
          feedbackAuth: req.feedback_auth ? JSON.parse(req.feedback_auth) : null,
          feedbackTxHash: (req as any).feedback_tx_hash || null,
          createdAt: req.created_at,
          updatedAt: req.updated_at,
        }));

        console.log('[IMPACT-AGENT] Found feedback requests:', feedbackRequests.length);

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.feedbackRequests = feedbackRequests;
        responseContent.count = feedbackRequests.length;
        responseContent.message = `Found ${feedbackRequests.length} feedback request(s) for ${clientAddress}`;
      } catch (error: any) {
        console.error('[IMPACT-AGENT] Error querying feedback requests:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to query feedback requests';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'agent.feedback.getRequestsByAgent') {
      // This skill is only accessible on the agents-admin subdomain
      if (agentName !== 'agents-admin') {
        responseContent.error = 'agent.feedback.getRequestsByAgent skill is only available on the agents-admin subdomain';
        responseContent.skill = skillId;
        return c.json({
          success: false,
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          response: responseContent,
        }, 403);
      }

      try {
        const targetAgentId = payload?.targetAgentId || payload?.target_agent_id || payload?.agentId;

        if (!targetAgentId) {
          responseContent.error = 'targetAgentId (agent ID) is required in payload for agent.feedback.getRequestsByAgent skill';
          responseContent.skill = skillId;
          return c.json({
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          }, 400);
        }

        // Query database for feedback requests by target agent ID
        const db = await getD1Database();
        if (!db) {
          throw new Error('D1 database is not available. Cannot query feedback requests.');
        }

        console.log('[IMPACT-AGENT] Querying feedback requests for target agent ID:', targetAgentId);

        const requests = await db
          .prepare(
            'SELECT id, client_address, target_agent_id, comment, status, feedback_auth, feedback_tx_hash, created_at, updated_at FROM agent_feedback_requests WHERE target_agent_id = ? ORDER BY created_at DESC'
          )
          .bind(String(targetAgentId))
          .all<AgentFeedbackRequest>();

        const feedbackRequests = (requests.results || []).map((req: AgentFeedbackRequest) => ({
          id: req.id,
          clientAddress: req.client_address,
          targetAgentId: req.target_agent_id,
          comment: req.comment,
          status: req.status,
          feedbackAuth: req.feedback_auth ? JSON.parse(req.feedback_auth) : null,
          feedbackTxHash: (req as any).feedback_tx_hash || null,
          createdAt: req.created_at,
          updatedAt: req.updated_at,
        }));

        console.log('[IMPACT-AGENT] Found feedback requests for agent:', feedbackRequests.length);

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.feedbackRequests = feedbackRequests;
        responseContent.count = feedbackRequests.length;
        responseContent.message = `Found ${feedbackRequests.length} feedback request(s) for agent ID ${targetAgentId}`;
      } catch (error: any) {
        console.error('[IMPACT-AGENT] Error querying feedback requests by agent:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to query feedback requests';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'agent.feedback.markGiven') {
      // Mark a feedback request as having feedback given, storing the tx hash
      // This skill is only accessible on the agents-admin subdomain
      if (agentName !== 'agents-admin') {
        responseContent.error = 'agent.feedback.markGiven skill is only available on the agents-admin subdomain';
        responseContent.skill = skillId;
        return c.json(
          {
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          },
          403,
        );
      }

      try {
        const { feedbackRequestId, txHash } = (payload || {}) as {
          feedbackRequestId?: number | string;
          txHash?: string;
        };

        if (!feedbackRequestId || !txHash) {
          responseContent.error =
            'feedbackRequestId and txHash are required in payload for agent.feedback.markGiven skill';
          responseContent.skill = skillId;
          return c.json(
            {
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            },
            400,
          );
        }

        const db = await getD1Database();
        if (!db) {
          throw new Error('D1 database is not available. Cannot update feedback request.');
        }

        const requestId =
          typeof feedbackRequestId === 'string' ? parseInt(feedbackRequestId, 10) : Number(feedbackRequestId);

        if (!Number.isFinite(requestId)) {
          throw new Error('Invalid feedbackRequestId');
        }

        const now = Date.now();

        await db
          .prepare(
            'UPDATE agent_feedback_requests SET status = ?, feedback_tx_hash = ?, updated_at = ? WHERE id = ?',
          )
          .bind('feedback_given', txHash, now, requestId)
          .run();

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.feedbackRequestId = requestId;
        responseContent.feedbackTxHash = txHash;
      } catch (error: any) {
        console.error('[IMPACT-AGENT] Error marking feedback request as given:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to mark feedback as given';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'agent.inbox.sendMessage') {
      // Generic message send skill, only on agents-inbox subdomain
      if (agentName !== 'agents-inbox') {
        responseContent.error = 'agent.inbox.sendMessage skill is only available on the agents-inbox subdomain';
        responseContent.skill = skillId;
        return c.json(
          {
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          },
          403,
        );
      }

      try {
        const {
          fromClientAddress,
          fromAgentDid: rawFromAgentDid,
          fromAgentName: rawFromAgentName,
          toClientAddress,
          toAgentDid: rawToAgentDid,
          toAgentName: rawToAgentName,
          subject,
          body,
          contextType,
          contextId,
        } = (payload || {}) as {
          fromClientAddress?: string;
          fromAgentDid?: string;
          fromAgentName?: string;
          toClientAddress?: string;
          toAgentDid?: string;
          toAgentName?: string;
          subject?: string;
          body?: string;
          contextType?: string;
          contextId?: string | number;
        };

        if (!body || body.trim().length === 0) {
          responseContent.error = 'body is required in payload for agent.inbox.sendMessage';
          responseContent.skill = skillId;
          return c.json(
            {
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            },
            400,
          );
        }

        // Normalize agent origin/destination:
        // - If we only have name, resolve DID
        // - If only DID, resolve name
        let fromAgentDid = rawFromAgentDid || null;
        let fromAgentName = rawFromAgentName || null;
        let toAgentDid = rawToAgentDid || null;
        let toAgentName = rawToAgentName || null;

        try {
          const client = await getAgenticTrustClient();

          // Resolve FROM agent
          if (!fromAgentDid && fromAgentName) {
            try {
              let agent: any = null;
              let lookupName = fromAgentName;

              try {
                agent = await client.getAgentByName(lookupName);
              } catch {
                agent = null;
              }

              // If direct lookup fails, try ENS-style name
              if (!agent && !lookupName.includes('.8004-agent.eth')) {
                const ensCandidate = `${lookupName}.8004-agent.eth`.toLowerCase();
                try {
                  agent = await client.getAgentByName(ensCandidate);
                  if (agent) {
                    lookupName = ensCandidate;
                  }
                } catch {
                  agent = null;
                }
              }

              if (agent && (agent as any).agentId && (agent as any).chainId) {
                const chainId = Number((agent as any).chainId);
                const agentIdStr = String((agent as any).agentId);
                fromAgentDid = `did:8004:${chainId}:${agentIdStr}`;
                fromAgentName = (agent as any).agentName || lookupName;
              }
            } catch (e) {
              console.warn('[IMPACT-AGENT] Failed to resolve FROM agent DID from name for inbox message:', e);
            }
          } else if (fromAgentDid && !fromAgentName) {
            try {
              const { agentId } = parseDid8004(fromAgentDid);
              const agent = await client.agents.getAgent(agentId.toString());
              if (agent && (agent as any).agentName) {
                fromAgentName = (agent as any).agentName as string;
              }
            } catch (e) {
              console.warn('[IMPACT-AGENT] Failed to resolve FROM agent name from DID for inbox message:', e);
            }
          }

          // Resolve TO agent if no explicit client recipient
          if (!toClientAddress && (toAgentName || toAgentDid)) {
            try {
              if (!toAgentDid && toAgentName) {
                // Resolve by name/ENS to get chainId + agentId and build did:8004
                let agent: any = null;
                let lookupName = toAgentName;

                try {
                  agent = await client.getAgentByName(lookupName);
                } catch {
                  agent = null;
                }

                // If direct lookup fails, try ENS-style name
                if (!agent && !lookupName.includes('.8004-agent.eth')) {
                  const ensCandidate = `${lookupName}.8004-agent.eth`.toLowerCase();
                  try {
                    agent = await client.getAgentByName(ensCandidate);
                    if (agent) {
                      lookupName = ensCandidate;
                    }
                  } catch {
                    agent = null;
                  }
                }

                if (agent && (agent as any).agentId && (agent as any).chainId) {
                  const chainId = Number((agent as any).chainId);
                  const agentIdStr = String((agent as any).agentId);
                  toAgentDid = `did:8004:${chainId}:${agentIdStr}`;
                  toAgentName = (agent as any).agentName || lookupName;
                }
              } else if (toAgentDid && !toAgentName) {
                // Resolve by DID to get a friendly name if available
                const { agentId } = parseDid8004(toAgentDid);
                const agent = await client.agents.getAgent(agentId.toString());
                if (agent && (agent as any).agentName) {
                  toAgentName = (agent as any).agentName as string;
                }
              }
            } catch (e) {
              console.warn('[IMPACT-AGENT] Failed to resolve TO agent identity for inbox message:', e);
            }
          }
        } catch (resolveError) {
          console.warn('[IMPACT-AGENT] Failed to resolve agent identity for inbox message:', resolveError);
        }

        // Require at least one destination hint: user address, agent DID, or agent name
        if (!toClientAddress && !toAgentDid && !toAgentName) {
          responseContent.error =
            'Either toClientAddress, toAgentDid, or toAgentName is required in payload for agent.inbox.sendMessage';
          responseContent.skill = skillId;
          return c.json(
            {
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            },
            400,
          );
        }

        // Also ensure we have at least some "from" identity: either client address or agent
        if (!fromClientAddress && !fromAgentDid && !fromAgentName) {
          responseContent.error =
            'Either fromClientAddress, fromAgentDid, or fromAgentName is required in payload for agent.inbox.sendMessage';
          responseContent.skill = skillId;
          return c.json(
            {
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            },
            400,
          );
        }

        const db = await getD1Database();
        if (!db) {
          throw new Error('D1 database is not available. Cannot store message.');
        }

        const now = Date.now();

        const result = await db
          .prepare(
            'INSERT INTO messages (from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            fromClientAddress ? fromClientAddress.toLowerCase() : null,
            fromAgentDid || null,
            fromAgentName || null,
            toClientAddress ? toClientAddress.toLowerCase() : null,
            toAgentDid || null,
            toAgentName || null,
            subject || null,
            body.trim(),
            contextType || null,
            contextId != null ? String(contextId) : null,
            now,
            null,
          )
          .run();

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.messageId = result.meta.last_row_id;
        responseContent.message = 'Message stored successfully';
      } catch (error: any) {
        console.error('[IMPACT-AGENT] Error storing inbox message:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to store message';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'agent.inbox.listClientMessages') {
      // List messages for a client address (both sent and received), agents-inbox only
      if (agentName !== 'agents-inbox') {
        responseContent.error =
          'agent.inbox.listClientMessages skill is only available on the agents-inbox subdomain';
        responseContent.skill = skillId;
        return c.json(
          {
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          },
          403,
        );
      }

      try {
        const clientAddress = payload?.clientAddress || payload?.client_address;

        if (!clientAddress) {
          responseContent.error =
            'clientAddress (EOA address) is required in payload for agent.inbox.listClientMessages';
          responseContent.skill = skillId;
          return c.json(
            {
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            },
            400,
          );
        }

        const db = await getD1Database();
        if (!db) {
          throw new Error('D1 database is not available. Cannot query messages.');
        }

        const addr = clientAddress.toLowerCase();
        const rows = await db
          .prepare(
            'SELECT id, from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, created_at, read_at FROM messages WHERE to_client_address = ? OR from_client_address = ? ORDER BY created_at DESC',
          )
          .bind(addr, addr)
          .all<any>();

        const messages = (rows.results || []).map((row: any) => ({
          id: row.id,
          fromClientAddress: row.from_client_address,
          fromAgentDid: row.from_agent_did,
          fromAgentName: row.from_agent_name,
          toClientAddress: row.to_client_address,
          toAgentDid: row.to_agent_did,
          toAgentName: row.to_agent_name,
          subject: row.subject,
          body: row.body,
          contextType: row.context_type,
          contextId: row.context_id,
          createdAt: row.created_at,
          readAt: row.read_at,
        }));

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.messages = messages;
        responseContent.count = messages.length;
      } catch (error: any) {
        console.error('[IMPACT-AGENT] Error querying client messages:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to query messages';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'agent.inbox.listAgentMessages') {
      // List messages for an agent DID (both sent and received), agents-inbox only
      if (agentName !== 'agents-inbox') {
        responseContent.error =
          'agent.inbox.listAgentMessages skill is only available on the agents-inbox subdomain';
        responseContent.skill = skillId;
        return c.json(
          {
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          },
          403,
        );
      }

      try {
        let agentDid = payload?.agentDid || payload?.agent_did;

        if (!agentDid) {
          responseContent.error = 'agentDid is required in payload for agent.inbox.listAgentMessages';
          responseContent.skill = skillId;
          return c.json(
            {
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            },
            400,
          );
        }

        // Normalize the agent DID: trim whitespace and ensure consistent format
        agentDid = String(agentDid).trim();

        console.log('[IMPACT-AGENT] ========================================');
        console.log('[IMPACT-AGENT] Querying agent messages for DID:', agentDid);
        console.log('[IMPACT-AGENT] DID length:', agentDid.length);
        console.log('[IMPACT-AGENT] ========================================');

        const db = await getD1Database();
        if (!db) {
          throw new Error('D1 database is not available. Cannot query messages.');
        }

        // First, let's check what's actually in the database for debugging
        const debugRows = await db
          .prepare('SELECT DISTINCT to_agent_did, from_agent_did FROM messages WHERE to_agent_did IS NOT NULL OR from_agent_did IS NOT NULL LIMIT 10')
          .all<any>();
        
        console.log('[IMPACT-AGENT] Sample DIDs in database:', {
          sampleDIDs: debugRows.results?.map((r: any) => ({
            to_agent_did: r.to_agent_did,
            from_agent_did: r.from_agent_did,
            to_length: r.to_agent_did?.length,
            from_length: r.from_agent_did?.length,
          })),
        });

        // Query for messages where the agent DID matches in either to_agent_did or from_agent_did
        const rows = await db
          .prepare(
            'SELECT id, from_client_address, from_agent_did, from_agent_name, to_client_address, to_agent_did, to_agent_name, subject, body, context_type, context_id, created_at, read_at FROM messages WHERE to_agent_did = ? OR from_agent_did = ? ORDER BY created_at DESC',
          )
          .bind(agentDid, agentDid)
          .all<any>();

        console.log('[IMPACT-AGENT] Query result:', {
          queryDid: agentDid,
          queryDidLength: agentDid.length,
          messageCount: rows.results?.length || 0,
          messages: rows.results?.slice(0, 5).map((r: any) => ({
            id: r.id,
            to_agent_did: r.to_agent_did,
            to_agent_did_length: r.to_agent_did?.length,
            from_agent_did: r.from_agent_did,
            from_agent_did_length: r.from_agent_did?.length,
            subject: r.subject,
            contextType: r.context_type,
            matchesTo: r.to_agent_did === agentDid,
            matchesFrom: r.from_agent_did === agentDid,
          })),
        });
        console.log('[IMPACT-AGENT] ========================================');

        const messages = (rows.results || []).map((row: any) => ({
          id: row.id,
          fromClientAddress: row.from_client_address,
          fromAgentDid: row.from_agent_did,
          fromAgentName: row.from_agent_name,
          toClientAddress: row.to_client_address,
          toAgentDid: row.to_agent_did,
          toAgentName: row.to_agent_name,
          subject: row.subject,
          body: row.body,
          contextType: row.context_type,
          contextId: row.context_id,
          createdAt: row.created_at,
          readAt: row.read_at,
        }));

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.messages = messages;
        responseContent.count = messages.length;
      } catch (error: any) {
        console.error('[IMPACT-AGENT] Error querying agent messages:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to query messages';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId === 'agent.inbox.markRead') {
      // Mark a message as read, agents-inbox only
      if (agentName !== 'agents-inbox') {
        responseContent.error = 'agent.inbox.markRead skill is only available on the agents-inbox subdomain';
        responseContent.skill = skillId;
        return c.json(
          {
            success: false,
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            response: responseContent,
          },
          403,
        );
      }

      try {
        const { messageId } = (payload || {}) as { messageId?: number | string };

        if (!messageId) {
          responseContent.error = 'messageId is required in payload for agent.inbox.markRead';
          responseContent.skill = skillId;
          return c.json(
            {
              success: false,
              messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              response: responseContent,
            },
            400,
          );
        }

        const db = await getD1Database();
        if (!db) {
          throw new Error('D1 database is not available. Cannot update messages.');
        }

        const id =
          typeof messageId === 'string'
            ? parseInt(messageId, 10)
            : Number(messageId);

        if (!Number.isFinite(id)) {
          throw new Error('Invalid messageId');
        }

        const now = Date.now();

        await db
          .prepare('UPDATE messages SET read_at = ? WHERE id = ?')
          .bind(now, id)
          .run();

        responseContent.success = true;
        responseContent.skill = skillId;
        responseContent.messageId = id;
        responseContent.readAt = now;
      } catch (error: any) {
        console.error('[IMPACT-AGENT] Error marking message as read:', error);
        responseContent.error = error instanceof Error ? error.message : 'Failed to mark message as read';
        responseContent.skill = skillId;
        responseContent.success = false;
      }
    } else if (skillId) {
      responseContent.response = `Received request for skill: ${skillId}. This skill is not yet implemented.`;
      responseContent.skill = skillId;
    }

    // Determine success based on whether there's an error in the response
    const hasError = responseContent.error || (responseContent as any).success === false;
    
    // Serialize BigInt values in the entire response before returning
    const serializedResponseContent = serializeBigInt(responseContent);
    
    const a2aResponse = {
      success: !hasError,
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
      response: serializedResponseContent,
    };

    const headers = getCorsHeaders();
    Object.entries(headers).forEach(([key, value]) => c.header(key, value));
    return c.json(a2aResponse);
  } catch (error) {
    console.error('[IMPACT-AGENT] Error processing A2A request:', error);
    const headers = getCorsHeaders();
    Object.entries(headers).forEach(([key, value]) => c.header(key, value));
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
}

/**
 * A2A endpoints
 * - GET  /api/a2a (handshake, signed)
 * - POST /api/a2a (primary A2A endpoint)
 */
app.get('/api/a2a', handleA2aGet);
app.post('/api/a2a', handleA2aRequest);

export default app;
