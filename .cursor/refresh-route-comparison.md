# Refresh Route Comparison: ITG vs Agentic Trust Core

## ITG Implementation

**Location**: `apps/itg/src/app/api/agents/[did8004]/refresh/route.ts`

```typescript
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAgenticTrustClient } from '@agentic-trust/core/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ did8004: string }> },
) {
  try {
    const resolvedParams = await params;
    const didAgent = decodeURIComponent(resolvedParams.did8004);

    const client = await getAgenticTrustClient();
    // refreshAgentByDid exists on AgentsAPI at runtime but may not yet be in typings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (client.agents as any).refreshAgentByDid(didAgent);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in refresh agent route:', error);
    return NextResponse.json(
      {
        error: 'Failed to refresh agent',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
```

## Agentic Trust Core Implementation

**Location**: `packages/core/src/server/lib/agents.ts`

### `refreshAgentByDid` Method

```typescript
async refreshAgentByDid(agentDid: string): Promise<any> {
  const { agentId, chainId } = parseDid8004(agentDid);
  return this.refreshAgent(agentId, chainId);
}
```

### `refreshAgent` Method

```typescript
/**
 * Refresh/Index an agent in the GraphQL indexer
 * Triggers the indexer to re-index the specified agent
 * @param agentId - Agent ID to refresh (required)
 * @param chainId - Optional chain ID (defaults to 11155111 for Sepolia)
 */
async refreshAgent(agentId: string, chainId: number = 11155111): Promise<any> {
  const discoveryClient = await getDiscoveryClient();
  try {
    return await discoveryClient.refreshAgent(agentId, chainId);
  } catch (error) {
    rethrowDiscoveryError(error, 'agents.refreshAgent');
  }
}
```

## Analysis

### ✅ ITG Implementation is Correct

1. **Method Call**: ITG correctly calls `client.agents.refreshAgentByDid(didAgent)`
   - This method exists in `AgentsAPI` class (line ~280 in agents.ts)
   - It parses the DID to extract `agentId` and `chainId`
   - Then calls `refreshAgent(agentId, chainId)`

2. **Type Safety**: The `as any` cast is necessary because:
   - `refreshAgentByDid` exists at runtime on `AgentsAPI`
   - It may not be in TypeScript typings yet (as the comment indicates)
   - This is a known pattern in the agentic-trust library

3. **Error Handling**: ITG includes proper error handling:
   - Try/catch block
   - Structured error response with status 500
   - Error message extraction

4. **Next.js 15 Compatibility**: Uses `Promise<{ did8004: string }>` for params, which is correct for Next.js 15 async route parameters

### Implementation Flow

```
ITG Route Handler
  ↓
getAgenticTrustClient()
  ↓
client.agents.refreshAgentByDid(didAgent)
  ↓
AgentsAPI.refreshAgentByDid(agentDid)
  ↓
parseDid8004(agentDid) → { agentId, chainId }
  ↓
AgentsAPI.refreshAgent(agentId, chainId)
  ↓
getDiscoveryClient()
  ↓
discoveryClient.refreshAgent(agentId, chainId)
  ↓
GraphQL Indexer Refresh
```

## Recommendations

### ✅ No Changes Needed

The ITG implementation is correct and follows the agentic-trust pattern. The route:
- Properly extracts the DID from route parameters
- Calls the correct method on the client
- Handles errors appropriately
- Returns JSON responses

### Optional Enhancements

1. **Add Request Body Validation** (if needed):
   ```typescript
   // Currently accepts POST with no body - this is fine
   // If you want to accept optional parameters, add:
   const body = await request.json().catch(() => ({}));
   ```

2. **Add Response Type** (if you know the return type):
   ```typescript
   // The discovery client's refreshAgent may return a specific type
   // Check discoveryClient implementation for exact return type
   ```

3. **Add Logging** (optional):
   ```typescript
   console.log(`[refresh] Refreshing agent: ${didAgent}`);
   ```

## Conclusion

The ITG refresh route implementation is **correct and matches the agentic-trust core library pattern**. No changes are required.

