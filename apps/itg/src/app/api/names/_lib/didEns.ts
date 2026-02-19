/**
 * Helper functions for parsing and building did:ens strings
 */

export interface ParsedDidEns {
  ensName: string;
  chainId: number;
}

/**
 * Parse a did:ens string into its components
 * Format: did:ens:chainId:name.8004-agent.eth
 */
export function parseDidEns(didEns: string): ParsedDidEns {
  if (!didEns.startsWith('did:ens:')) {
    throw new Error('Invalid DID format. Expected did:ens:...');
  }

  // Parse the ENS name from the DID
  // Format: did:ens:chainId:name.8004-agent.eth
  const parts = didEns.split(':');
  if (parts.length < 4) {
    throw new Error('Invalid did:ens format');
  }

  const chainId = parts[2] ? parseInt(parts[2], 10) : undefined;
  const fullName = parts.slice(3).join(':');

  if (!fullName || !chainId || isNaN(chainId)) {
    throw new Error('Missing chainId or ENS name in DID');
  }

  return {
    ensName: fullName,
    chainId,
  };
}

/**
 * Build a did:ens string from agent name, org name, and chain ID
 * Format: did:ens:chainId:agentName.orgName.eth
 */
export function buildDidEnsFromAgentAndOrg(
  chainId: number,
  agentName: string,
  orgName: string,
): string {
  const ensName = `${agentName}.${orgName}.eth`;
  return `did:ens:${chainId}:${ensName}`;
}

