export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentName, orgName, agentAddress, agentUrl, agentDescription, chainId } = body;

    if (!agentName || !orgName || !agentAddress) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const client = await getAgenticTrustClient();
    
    // This prepares calls for the client (AA) to execute
    const { calls } = await client.prepareL1AgentNameInfoCalls({
      agentName,
      orgName,
      agentAddress,
      agentUrl,
      agentDescription,
      chainId: chainId || 11155111
    });

    // Serialize BigInts in calls to avoid JSON serialization error
    const serializedCalls = calls.map((call: any) => ({
      ...call,
      value: typeof call.value === 'bigint' ? call.value.toString() : call.value
    }));

    return NextResponse.json({ calls: serializedCalls });
  } catch (error) {
    console.error('Error preparing L1 name info calls:', error);
    return NextResponse.json({ error: 'Failed to prepare name info calls', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
