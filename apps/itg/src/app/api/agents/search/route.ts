export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

function buildWhereInput(params: any) {
  const where: any = {};
  if (!params) return where;

  if (params.chains && params.chains.length > 0) where.chainId_in = params.chains;
  if (params.agentName) where.agentName_contains_nocase = params.agentName;
  if (params.agentId) where.agentId = params.agentId;
  if (params.agentAccount) where.agentOwner = params.agentAccount.toLowerCase();
  
  if (params.a2a) where.hasA2aEndpoint = true;
  if (params.mcp) where.mcp = true;
  
  if (params.minFeedbackCount) where.feedbackCount_gte = params.minFeedbackCount;
  if (params.minValidationCompletedCount) where.validationCompletedCount_gte = params.minValidationCompletedCount;
  if (params.minFeedbackAverageScore) where.feedbackAverageScore_gte = params.minFeedbackAverageScore;
  
  if (params.createdWithinDays) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const windowSeconds = Math.floor(params.createdWithinDays * 24 * 60 * 60);
      where.createdAtTime_gte = nowSeconds - windowSeconds;
  }
  
  return where;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const client = await getAgenticTrustClient();
    
    // Use custom GraphQL query to fetch all fields including validationRequestedCount
    const query = `
      query SearchAgentsGraph($where: AgentWhereInput, $first: Int, $skip: Int, $orderBy: AgentOrderBy, $orderDirection: OrderDirection) {
        searchAgentsGraph(where: $where, first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection) {
          agents {
            chainId
            agentId
            agentAccount
            agentName
            agentOwner
            tokenUri
            createdAtBlock
            createdAtTime
            updatedAtTime
            description
            image
            a2aEndpoint
            ensEndpoint
            agentAccountEndpoint
            supportedTrust
            did
            mcp
            x402support
            active
            feedbackCount
            feedbackAverageScore
            validationCompletedCount
            validationRequestedCount
            validationPendingCount
          }
          total
          hasMore
        }
      }
    `;

    const where = buildWhereInput(body.params);
    const variables = {
        where,
        first: body.pageSize || 10,
        skip: (body.page && body.page > 0 ? (body.page - 1) : 0) * (body.pageSize || 10),
        orderBy: body.orderBy || 'createdAtTime',
        orderDirection: body.orderDirection || 'DESC'
    };

    // Get discovery client and execute query
    // Cast to any to access getDiscoveryClient if it's not in public interface of the type
    const discovery = await (client as any).getDiscoveryClient();
    const response = await discovery.request(query, variables);
    
    return NextResponse.json(response.searchAgentsGraph);
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ 
      error: 'Search failed',
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

// Keep GET if needed, or remove/replace
export async function GET(request: NextRequest) {
  // Simple default search
  return POST(request);
}

