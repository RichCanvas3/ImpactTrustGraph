export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { DEFAULT_CHAIN_ID, getAgenticTrustClient } from '@agentic-trust/core/server';

function parseDidEthr(raw: string): { chainId: number; account: `0x${string}` } {
  const decoded = decodeURIComponent(raw || '').trim();
  if (!decoded) {
    throw new Error('Missing DID parameter');
  }

  if (!decoded.startsWith('did:ethr:')) {
    throw new Error('Unsupported DID format. Expected did:ethr:...');
  }

  const segments = decoded.split(':');
  const accountCandidate = segments[segments.length - 1];
  if (!accountCandidate || !accountCandidate.startsWith('0x')) {
    throw new Error('DID is missing account component');
  }

  const remaining = segments.slice(2, -1);
  let chainId: number = DEFAULT_CHAIN_ID;

  for (let i = remaining.length - 1; i >= 0; i -= 1) {
    const value = remaining[i];
    if (value && /^\d+$/.test(value)) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        chainId = parsed;
        break;
      }
    }
  }

  const account = accountCandidate as `0x${string}`;
  if (!isAddress(account)) {
    throw new Error('Invalid account address in DID');
  }

  return { chainId, account };
}

function normalizeDiscoveryUrl(value: unknown) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  if (/\/graphql-kb$/i.test(raw)) return raw;
  if (/\/graphql$/i.test(raw)) return raw.replace(/\/graphql$/i, '/graphql-kb');
  return `${raw}/graphql-kb`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ didethr: string }> },
) {
  try {
    const resolvedParams = await params;
    const rawParam = resolvedParams['didethr'];
    const { chainId: initialChainId, account } = parseDidEthr(rawParam);

    const effectiveChainId = Number.isFinite(initialChainId) && initialChainId > 0 ? initialChainId : DEFAULT_CHAIN_ID;

    const atp = await getAgenticTrustClient();

    try {
      // IMPORTANT: do not call atp.getAgentByAccount() here.
      // Upstream SDK tries a deprecated GraphQL field `searchAgents`, which our KB schema does not expose,
      // causing long delays before it falls back. Instead, query KB (`kbAgents`) directly.

      const endpoint = normalizeDiscoveryUrl(process.env.AGENTIC_TRUST_DISCOVERY_URL);
      if (!endpoint) {
        throw new Error('Missing required configuration: AGENTIC_TRUST_DISCOVERY_URL');
      }
      const apiKey = String(
        process.env.GRAPHQL_ACCESS_CODE || process.env.AGENTIC_TRUST_DISCOVERY_API_KEY || ''
      ).trim();

      const kbQuery = `
        query FindAgentByAccount($where: KbAgentWhereInput, $first: Int) {
          kbAgents(where: $where, first: $first, skip: 0, orderBy: updatedAtTime, orderDirection: DESC) {
            agents {
              uaid
              agentName
              createdAtTime
              updatedAtTime
            }
          }
        }
      `;

      const kbRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          query: kbQuery,
          variables: {
            where: {
              chainId: effectiveChainId,
              agentIdentifierMatch: account,
            },
            first: 1,
          },
        }),
      });

      const kbJson = await kbRes.json().catch(() => null as any);
      if (!kbRes.ok) {
        throw new Error(kbJson?.error || kbJson?.message || `KB lookup failed (${kbRes.status})`);
      }
      if (kbJson?.errors?.length) {
        throw new Error(kbJson.errors?.[0]?.message || 'KB lookup failed (GraphQL error)');
      }

      const uaid: string | null =
        kbJson?.data?.kbAgents?.agents?.[0]?.uaid && typeof kbJson.data.kbAgents.agents[0].uaid === 'string'
          ? kbJson.data.kbAgents.agents[0].uaid
          : null;

      if (!uaid) {
        return NextResponse.json({
          found: false,
          account,
          did: decodeURIComponent(rawParam),
          message: 'No agent found for this account address',
        });
      }

      const details = await atp.getAgentDetailsByUaidUniversal(uaid, { allowOnChain: true } as any);
      if (!details || (details as any).success !== true) {
        return NextResponse.json({
          found: false,
          account,
          did: decodeURIComponent(rawParam),
          message: 'Agent lookup succeeded but details could not be resolved',
        });
      }

      const agentInfo = details as any;

      return NextResponse.json({
        found: true,
        ...agentInfo,
        // Ensure UAID is always present at top-level (canonical identifier)
        uaid,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNotFound = 
        errorMessage.toLowerCase().includes('not found') ||
        errorMessage.toLowerCase().includes('no agent') ||
        (error as any)?.code === 'AGENT_NOT_FOUND' ||
        (error as any)?.status === 404;

      if (isNotFound) {
        return NextResponse.json({
          found: false,
          account,
          did: decodeURIComponent(rawParam),
          message: 'No agent found for this account address'
        });
      }

      throw error;
    }
  } catch (error) {
    console.error('Error resolving agent by DID:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to resolve agent by account', message },
      { status: 400 },
    );
  }
}

