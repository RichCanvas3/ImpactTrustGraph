export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { generateHcs14UaidDidTarget } from '@agentic-trust/core/server';
import { buildDidEthr } from '@agentic-trust/core';

/**
 * POST /api/agents/generate-uaid
 * Body (expected by @agentic-trust/core client flows):
 * { agentAccount: string, chainId: number, uid?: string, registry?: string, proto?: string, nativeId?: string, domain?: string }
 *
 * Minimal UAID generator to satisfy @agentic-trust/core client flow.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as any));

    // If caller already has a UAID, just echo it.
    const uaidProvided = typeof body?.uaid === 'string' ? body.uaid.trim() : '';
    if (uaidProvided.startsWith('uaid:')) {
      return NextResponse.json({ uaid: uaidProvided });
    }

    const agentAccountRaw =
      body?.agentAccount ??
      body?.agent_account ??
      body?.account ??
      body?.agent?.agentAccount ??
      body?.agent?.agent_account ??
      body?.agent?.account;

    if (!agentAccountRaw || typeof agentAccountRaw !== 'string') {
      return NextResponse.json({ error: 'agentAccount is required' }, { status: 400 });
    }
    const agentAccount = agentAccountRaw.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(agentAccount)) {
      return NextResponse.json({ error: 'agentAccount must be a valid 0x-prefixed address' }, { status: 400 });
    }

    const chainIdRaw = body?.chainId ?? body?.chain_id;
    const chainId = typeof chainIdRaw === 'number' ? chainIdRaw : Number(chainIdRaw);
    if (!Number.isFinite(chainId)) {
      return NextResponse.json({ error: 'chainId is required' }, { status: 400 });
    }

    const didEthr = buildDidEthr(chainId, agentAccount as `0x${string}`, { encode: false });
    const caip10 = `eip155:${chainId}:${agentAccount}`;

    const { uaid } = await generateHcs14UaidDidTarget({
      targetDid: didEthr,
      routing: {
        registry: typeof body?.registry === 'string' && body.registry.trim() ? body.registry.trim() : 'erc-8004',
        proto: typeof body?.proto === 'string' && body.proto.trim() ? body.proto.trim() : 'a2a',
        nativeId: typeof body?.nativeId === 'string' && body.nativeId.trim() ? body.nativeId.trim() : caip10,
        uid: typeof body?.uid === 'string' && body.uid.trim() ? body.uid.trim() : didEthr,
        domain: typeof body?.domain === 'string' && body.domain.trim() ? body.domain.trim() : undefined,
      },
    });

    return NextResponse.json({ uaid });
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to generate UAID', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405 });
}
