/**
 * URL utilities for server-side requests
 */

/**
 * Create headers for middleware routing when making server-side requests
 * to agent endpoints that use subdomain routing
 * 
 * Note: We don't set the 'host' header as Node.js fetch may ignore it.
 * Instead, we rely on x-agent-name and x-ens-name headers which the
 * middleware checks first before extracting from the host header.
 */
export function createMiddlewareHeaders(
  agentName: string | null,
  ensName: string | null,
  originalHost: string | null
): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (agentName && ensName) {
    headers['x-agent-name'] = agentName;
    headers['x-ens-name'] = ensName;
    // Note: We don't set 'host' header as Node.js fetch may ignore it
    // The middleware will check x-agent-name and x-ens-name headers first
  }

  return headers;
}

/**
 * Extract agent name from ENS name
 * e.g., "gmail-itg.8004-agent.eth" -> "gmail-itg"
 */
export function extractAgentNameFromEns(ensName: string): string | null {
  const match = ensName.match(/^([^.]+)\.8004-agent\.eth$/);
  return match ? match[1] : null;
}

