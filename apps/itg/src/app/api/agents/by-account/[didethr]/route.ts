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
      const agentInfo = await atp.getAgentByAccount(account, effectiveChainId);

      return NextResponse.json({
        found: true,
        ...agentInfo
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

