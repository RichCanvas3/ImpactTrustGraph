export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

/**
 * GET /api/agents/token-uri?did=... - Get tokenUri data for an agent
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const didParam = searchParams.get('did');

    if (!didParam) {
      return NextResponse.json(
        { error: 'Missing did parameter' },
        { status: 400 }
      );
    }

    // Decode the DID parameter (it may be URL encoded multiple times)
    let did = didParam;
    try {
      const decoded = decodeURIComponent(did);
      if (decoded !== did) {
        did = decoded;
      }
      if (did.includes('%')) {
        did = decodeURIComponent(did);
      }
    } catch (e) {
      console.warn("Failed to decode DID parameter, using as-is:", did);
    }

    const client = await getAgenticTrustClient();
    
    // Get agent details which includes tokenUri
    const agentInfo = await client.getAgentDetailsByDid(did);

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
      console.warn('Failed to fetch registration data:', fetchError);
    }

    return NextResponse.json({
      tokenUri: tokenUriString,
      registrationData,
      agentInfo: {
        name: agentInfo.name,
        description: agentInfo.description,
        image: agentInfo.image,
        agentUrl: agentInfo.agentUrl,
        metadata: agentInfo.metadata,
        a2aEndpoint: agentInfo.a2aEndpoint,
      }
    });
  } catch (error) {
    console.error('Error fetching tokenUri:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch tokenUri',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

