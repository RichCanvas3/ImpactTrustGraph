export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[add-to-l1-org] Request Body:', body);
    const { agentName: name, orgName, agentAddress: addr, agentUrl, chainId } = body;
    
    // Handle aliases
    const agentName = name || body.name;
    const agentAddress = addr || body.agentAccount || body.address;

    if (!agentName || !orgName || !agentAddress) {
      console.error('[add-to-l1-org] Missing parameters:', { agentName, orgName, agentAddress });
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const client = await getAgenticTrustClient();
    
    // This executes the transaction on server (Admin key must be set)
    const txHash = await client.addAgentNameToL1Org({
      agentName,
      orgName,
      agentAddress,
      agentUrl,
      chainId: chainId || 11155111
    });

    return NextResponse.json({ txHash });
  } catch (error) {
    console.error('Error adding to L1 org:', error);
    return NextResponse.json({ error: 'Failed to add name to org', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
