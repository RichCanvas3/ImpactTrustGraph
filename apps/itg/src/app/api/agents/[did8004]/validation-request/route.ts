export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prepareValidationRequestCore, ValidationApiError } from '@my-scope/core';
import { getAgenticTrustClient, getValidationRegistryClient } from '@agentic-trust/core/server';

async function getDidParam(params: Promise<Record<string, string | undefined>>): Promise<string> {
  const resolved = await params;
  const did = resolved['did8004'];
  if (did) {
    // Decode if URL encoded
    try {
      const decoded = decodeURIComponent(did);
      if (decoded !== did) {
        return decoded;
      }
      if (did.includes('%')) {
        return decodeURIComponent(did);
      }
      return did;
    } catch {
      return did;
    }
  }
  throw new Error('Missing did8004 parameter');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Record<string, string | undefined>> },
) {
  try {
    const agentDid8004 = await getDidParam(params);
    
    // Parse request body
    const body = await request.json().catch(() => ({}));
    console.log('[validation-request] Body:', body);
    
    // Get validator account from request body or use default
    // The validatorAccount should be provided by the client
    const validatorAddress = body.validatorAddress || body.validatorAccount || process.env.AGENTIC_TRUST_VALIDATOR_ADDRESS;
    
    if (!validatorAddress) {
      return NextResponse.json(
        {
          error: 'Validator address is required',
          message: 'Either provide validatorAddress in request body or set AGENTIC_TRUST_VALIDATOR_ADDRESS environment variable',
        },
        { status: 400 }
      );
    }

    // Prepare validation request using the local core package
    // Pass getValidationRegistryClient in context to avoid import issues
    const plan = await prepareValidationRequestCore(
      {
        getClient: getAgenticTrustClient,
        getValidationRegistryClient: getValidationRegistryClient,
      },
      {
        agentDid8004,
        validatorAddress,
        mode: 'aa',
        requestUri: body.requestUri,
        requestHash: body.requestHash,
      },
      getAgenticTrustClient,
    );

    return NextResponse.json(plan);
  } catch (error: any) {
    console.error('[validation-request] Error:', error);
    
    // Handle ValidationApiError with proper status code
    if (error instanceof ValidationApiError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status }
      );
    }
    
    return NextResponse.json(
      {
        error: 'Invalid request',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

