export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

/**
 * GET /api/names/[didens]
 * Get ENS name information including account address
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ didens: string }> },
) {
  try {
    const resolvedParams = await params;
    const rawDidEns = resolvedParams['didens'];
    
    // Decode the DID parameter (it may be URL encoded multiple times)
    let didEns = rawDidEns;
    try {
      const decoded = decodeURIComponent(didEns);
      if (decoded !== didEns) {
        didEns = decoded;
      }
      if (didEns.includes('%')) {
        didEns = decodeURIComponent(didEns);
      }
    } catch (e) {
      console.warn("Failed to decode DID parameter, using as-is:", didEns);
    }

    if (!didEns.startsWith('did:ens:')) {
      return NextResponse.json(
        { error: 'Invalid DID format. Expected did:ens:...' },
        { status: 400 }
      );
    }

    // Parse the ENS name from the DID
    // Format: did:ens:chainId:name.8004-agent.eth
    const parts = didEns.split(':');
    if (parts.length < 4) {
      return NextResponse.json(
        { error: 'Invalid did:ens format' },
        { status: 400 }
      );
    }

    const chainId = parts[2] ? parseInt(parts[2], 10) : undefined;
    const fullName = parts.slice(3).join(':');

    if (!fullName || !chainId) {
      return NextResponse.json(
        { error: 'Missing chainId or ENS name in DID' },
        { status: 400 }
      );
    }

    const client = await getAgenticTrustClient();

    // Get agent by name
    try {
      const agent = await client.getAgentByName(fullName);
      
      if (!agent) {
        return NextResponse.json(
          {
            error: 'ENS name not found',
            ensName: fullName,
            chainId,
          },
          { status: 404 }
        );
      }

      // Extract agent account from agent info
      const agentAccount = (agent as any).agentAccount || (agent as any).account;

      return NextResponse.json({
        nameInfo: {
          name: fullName,
          account: agentAccount,
          chainId,
          did: didEns,
        },
      });
    } catch (error) {
      console.error('[names] Error getting agent account:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // If agent not found, return 404
      if (errorMessage.toLowerCase().includes('not found') || 
          errorMessage.toLowerCase().includes('no agent')) {
        return NextResponse.json(
          {
            error: 'ENS name not found',
            ensName: fullName,
            chainId,
          },
          { status: 404 }
        );
      }

      return NextResponse.json(
        {
          error: 'Failed to get ENS name information',
          message: errorMessage,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[names] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to get ENS name information',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

