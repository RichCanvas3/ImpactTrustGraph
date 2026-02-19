export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient, updateAgentRegistrationRouteHandler } from '@agentic-trust/core/server';

async function getDidParam(params: Promise<Record<string, string | undefined>>): Promise<string> {
  const resolved = await params;
  const did = resolved['did8004'];
  if (did) {
    // Decode the DID parameter (it may be URL encoded multiple times)
    let decoded = decodeURIComponent(did);
    // If still encoded, decode again
    if (decoded.includes('%')) {
      decoded = decodeURIComponent(decoded);
    }
    return decoded;
  }
  throw new Error('Missing did8004 parameter');
}

/**
 * GET /api/agents/[did8004]/registration
 * Get registration data for an agent
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string | undefined>> },
) {
  try {
    const didAgent = await getDidParam(params);
    console.log('[agents/registration] GET request for DID:', didAgent);

    const client = await getAgenticTrustClient();
    const agentInfo = await client.getAgentDetailsByDid(didAgent);

    const tokenUri = agentInfo.identityMetadata.tokenUri;
    if (!tokenUri) {
      return NextResponse.json(
        { error: 'tokenUri not found for this agent' },
        { status: 404 }
      );
    }

    const tokenUriString = typeof tokenUri === 'string' ? tokenUri : String(tokenUri);
    if (!tokenUriString || tokenUriString.trim() === '') {
      return NextResponse.json(
        { error: 'Invalid tokenUri format' },
        { status: 400 }
      );
    }

    // Fetch the registration data
    let registrationData = null;
    try {
      const { getRegistration } = await import('@agentic-trust/core/server');
      registrationData = await getRegistration(tokenUriString);
    } catch (fetchError) {
      console.warn('[agents/registration] Failed to fetch registration data:', fetchError);
      return NextResponse.json(
        { 
          error: 'Failed to fetch registration data',
          message: fetchError instanceof Error ? fetchError.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      registrationData,
      tokenUri: tokenUriString,
      agentId: agentInfo.agentId,
      chainId: agentInfo.chainId,
    });
  } catch (error) {
    console.error('[agents/registration] Error:', error);
    if (
      error instanceof Error &&
      (error.message.toLowerCase().includes('8004 did') ||
        error.message.toLowerCase().includes('did8004') ||
        error.message.toLowerCase().includes('invalid agentid'))
    ) {
      return NextResponse.json(
        { error: 'Invalid 8004 DID', message: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: 'Failed to get registration data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/agents/[did8004]/registration
 * Update registration data for an agent
 */
export const PUT = updateAgentRegistrationRouteHandler();

