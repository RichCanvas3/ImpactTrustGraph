export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createAgentRouteHandler } from '@agentic-trust/core/server';

/**
 * Agent creation endpoint. Normal flow uses the connected wallet; if the core
 * library falls back to server-side signer it may require AGENTIC_TRUST_ADMIN_PRIVATE_KEY.
 */
const coreHandler = createAgentRouteHandler();

export async function POST(request: NextRequest) {
  try {
    return await coreHandler(request);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes('AGENTIC_TRUST_ADMIN_PRIVATE_KEY') ||
      msg.includes('AdminApp') ||
      msg.includes('private key')
    ) {
      return NextResponse.json(
        {
          error: 'Agent creation requires AGENTIC_TRUST_ADMIN_PRIVATE_KEY in production.',
          hint: 'Set it in your deployment env (e.g. Cloudflare/Vercel → Environment variables). If you do not use it locally, ensure all other AGENTIC_TRUST_* vars from .env are set in production first (RPC, discovery, ENS keys).',
        },
        { status: 503 }
      );
    }
    throw e;
  }
}

