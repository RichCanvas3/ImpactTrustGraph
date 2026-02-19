export const dynamic = 'force-dynamic';

import { createAgentRouteHandler } from '@agentic-trust/core/server';

/**
 * Agent creation endpoint.
 * Uses createAgentRouteHandler which can work with:
 * 1. Server-side admin private key (if AGENTIC_TRUST_ADMIN_PRIVATE_KEY is set)
 * 2. Connected user's wallet via ethereumProvider passed from client
 * 
 * The getAdminApp function inside createAgentRouteHandler should automatically
 * use the connected user's wallet when no admin private key is available.
 */
export const POST = createAgentRouteHandler();

