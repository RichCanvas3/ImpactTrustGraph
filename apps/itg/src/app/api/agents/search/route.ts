export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

function normalizeDiscoveryUrl(value: unknown) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  // Allow explicit endpoints.
  if (/\/graphql-kb$/i.test(raw)) return raw;
  if (/\/graphql$/i.test(raw)) return raw;
  // Default to KB endpoint for base URLs.
  return `${raw}/graphql-kb`;
}

function asDid8004(raw: string) {
  const did = raw.trim();
  if (!did.startsWith('did:8004:')) return null;
  const parts = did.split(':');
  // did:8004:<chainId>:<agentId>
  if (parts.length < 5) return null;
  const chainId = Number(parts[3]);
  const agentId = parts[4];
  if (!Number.isFinite(chainId) || !agentId) return null;
  return { did, chainId, agentId };
}

function extractIdentifier(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('uaid:')) return raw;
  if (raw.startsWith('did:')) return raw;
  return raw;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length) as any;
  let i = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await mapper(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function extractScopedAddress(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // core AgentInfo stores addresses as "{chainId}:{0x...}"
  const candidate = raw.includes(':') ? raw.split(':').slice(-1)[0] : raw;
  return /^0x[a-fA-F0-9]{40}$/.test(candidate) ? candidate : null;
}

function buildKbWhereInput(params: any, query: any) {
  const where: any = {};
  const p = params ?? {};

  if (Array.isArray(p.chains) && p.chains.length === 1) {
    const v = Number(p.chains[0]);
    if (Number.isFinite(v)) where.chainId = Math.floor(v);
  }

  const agentNameRaw = typeof p.agentName === 'string' ? p.agentName.trim() : '';
  if (agentNameRaw) where.agentName_contains = agentNameRaw;

  const agentIdRaw = typeof p.agentId === 'string' ? p.agentId.trim() : '';
  if (agentIdRaw) where.agentIdentifierMatch = agentIdRaw;

  const qRaw = typeof query === 'string' ? query.trim() : '';
  if (qRaw) {
    // If query looks like a concrete identifier, use identifier match.
    if (/^(uaid:|did:)/i.test(qRaw) || /^0x[a-fA-F0-9]{40}$/.test(qRaw)) {
      where.agentIdentifierMatch = qRaw;
    } else if (/\.eth$/i.test(qRaw)) {
      // Accept ENS names by searching the label portion (agentName is typically the label).
      const label = qRaw.split('.')[0] || qRaw;
      where.agentName_contains = label;
    } else {
      // Default: fuzzy name search.
      where.agentName_contains = qRaw;
    }
  }

  const minFeedbackCount = p.minFeedbackCount;
  if (typeof minFeedbackCount === 'number' && Number.isFinite(minFeedbackCount) && minFeedbackCount > 0) {
    where.minReviewAssertionCount = Math.floor(minFeedbackCount);
    where.hasReviews = true;
  }

  const minValidationCompletedCount = p.minValidationCompletedCount;
  if (
    typeof minValidationCompletedCount === 'number' &&
    Number.isFinite(minValidationCompletedCount) &&
    minValidationCompletedCount > 0
  ) {
    where.minValidationAssertionCount = Math.floor(minValidationCompletedCount);
    where.hasValidations = true;
  }

  return where;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const client = await getAgenticTrustClient();

    const endpoint = normalizeDiscoveryUrl(process.env.AGENTIC_TRUST_DISCOVERY_URL);
    if (!endpoint) {
      throw new Error('Missing required configuration: AGENTIC_TRUST_DISCOVERY_URL');
    }

    const apiKey = String(
      process.env.GRAPHQL_ACCESS_CODE || process.env.AGENTIC_TRUST_DISCOVERY_API_KEY || ''
    ).trim();

    const pageSize = typeof body.pageSize === 'number' && body.pageSize > 0 ? body.pageSize : 18;
    const page = typeof body.page === 'number' && body.page > 0 ? body.page : 1;
    const skip = (page - 1) * pageSize;

    const where = buildKbWhereInput(body.params, body.query);
    const allowedOrderBy = new Set(['createdAtTime', 'updatedAtTime', 'uaid', 'agentName', 'agentId8004']);
    const orderBy = allowedOrderBy.has(body.orderBy) ? body.orderBy : 'createdAtTime';
    const orderDirection = String(body.orderDirection || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const query = `
      query SearchKbAgents($where: KbAgentWhereInput, $first: Int, $skip: Int, $orderBy: KbAgentOrderBy, $orderDirection: OrderDirection) {
        kbAgents(where: $where, first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
          total
          hasMore
          agents {
            uaid
            agentName
            agentDescription
            agentImage
            createdAtTime
            createdAtBlock
            updatedAtTime
            assertions { reviewResponses { total } validationResponses { total } total }
          }
        }
      }
    `;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        query,
        variables: {
          where: Object.keys(where).length ? where : undefined,
          first: pageSize,
          skip,
          orderBy,
          orderDirection,
        },
      }),
    });

    const json = await res.json().catch(() => null as any);
    if (!res.ok) {
      throw new Error(json?.error || json?.message || `KB search failed (${res.status})`);
    }
    if (json?.errors?.length) {
      throw new Error(json.errors?.[0]?.message || 'KB search failed (GraphQL error)');
    }

    const payload = json?.data?.kbAgents;
    const rawAgents: any[] = Array.isArray(payload?.agents) ? payload.agents : [];

    const identifiers = rawAgents
      .map((a) => extractIdentifier(a?.uaid))
      .filter(Boolean) as string[];

    const details = await mapWithConcurrency(identifiers, 6, async (id) => {
      try {
        if (id.startsWith('did:8004:')) {
          return await client.getAgentDetailsByDid(id);
        }
        if (id.startsWith('uaid:')) {
          return await client.getAgentDetailsByUaidUniversal(id, { allowOnChain: true });
        }
        // If KB returns a DID without uaid: prefix, treat it as a DID.
        if (id.startsWith('did:')) {
          // If it's not did:8004, universal resolver can still return KB-first details.
          return await client.getAgentDetailsByUaidUniversal(`uaid:${id}`, { allowOnChain: true });
        }
        return null;
      } catch {
        return null;
      }
    });

    const agents = details
      .map((d: any, idx: number) => {
        if (!d || d.success !== true) return null;
        const chainId = typeof d.chainId === 'number' ? d.chainId : null;
        const agentId = typeof d.agentId === 'string' ? d.agentId : null;
        if (!chainId || !agentId) {
          // Fall back to KB uaid parsing when possible.
          const fallbackId = identifiers[idx] || '';
          const did8004 = fallbackId.startsWith('uaid:') ? fallbackId.split(';')[0].slice('uaid:'.length) : fallbackId;
          const parsed = asDid8004(did8004);
          if (!parsed) return null;
          return { ...d, chainId: parsed.chainId, agentId: parsed.agentId };
        }
        return d;
      })
      .filter(Boolean);

    const total = typeof payload?.total === 'number' ? payload.total : agents.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const hasMore = page < totalPages;

    return NextResponse.json({
      agents: agents.map((a: any) => {
        const agentAccount = extractScopedAddress(a?.agentAccount);
        const identityOwner = extractScopedAddress(a?.agentIdentityOwnerAccount);
        return {
          ...a,
          agentAccount: agentAccount ?? a?.agentAccount ?? null,
          agentIdentityOwnerAccount: identityOwner ?? a?.agentIdentityOwnerAccount ?? null,
          // Back-compat for the older UI shape.
          agentOwner: identityOwner ?? a?.agentOwner ?? null,
        };
      }),
      page,
      pageSize,
      total,
      totalPages,
      hasMore,
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ 
      error: 'Search failed',
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

// Keep GET if needed, or remove/replace
export async function GET(request: NextRequest) {
  // Simple default search
  return POST(request);
}

