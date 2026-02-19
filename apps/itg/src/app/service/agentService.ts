import {
  getAdminApp,
  getChainById,
  getChainRpcUrl,
  DEFAULT_CHAIN_ID
} from "@agentic-trust/core/server";
import {
  createPublicClient,
  http,
  type PublicClient,
  keccak256,
  stringToHex
} from "viem";
import {
  Implementation,
  toMetaMaskSmartAccount
} from "@metamask/smart-accounts-kit";

/**
 * Build a counterfactual Agent Account Abstraction client by agent name,
 * using the admin app (server-side) and a name-derived salt.
 *
 * This follows the AgenticTrust admin pattern, but returns the
 * MetaMaskSmartAccount client rather than just its address.
 */
export async function getCounterfactualAccountClientByAgentName(
  agentName: string,
  chainId?: number
): Promise<any> {
  if (!agentName || agentName.trim().length === 0) {
    throw new Error("agentName is required");
  }

  const targetChainId = chainId || DEFAULT_CHAIN_ID;
  const adminApp = await getAdminApp(undefined, targetChainId);

  if (!adminApp) {
    throw new Error(
      "AdminApp not initialized. Private key mode is required for server-side counterfactual address computation."
    );
  }

  // Check hasPrivateKey first - this is the primary check
  if (!adminApp.hasPrivateKey) {
    throw new Error(
      "AdminApp does not have a private key. Private key mode is required for server-side counterfactual address computation. " +
        "Set AGENTIC_TRUST_ADMIN_PRIVATE_KEY environment variable."
    );
  }

  if (!adminApp.address) {
    throw new Error("AdminApp address is not available");
  }

  // Verify that we have either walletClient or account (required for signing)
  // Even if hasPrivateKey is true, we need to ensure the signer is available
  if (!adminApp.walletClient && !adminApp.account) {
    throw new Error(
      "AdminApp does not have a signer (walletClient or account). " +
        "Private key mode is required, but AdminApp was initialized without a signer. " +
        "This may indicate that AGENTIC_TRUST_ADMIN_PRIVATE_KEY was not properly loaded from the environment."
    );
  }

  const chain = getChainById(targetChainId);
  const rpcUrl = getChainRpcUrl(targetChainId);
  if (!rpcUrl) {
    throw new Error(
      `Missing RPC URL for chain ${targetChainId}. Configure AGENTIC_TRUST_RPC_URL_{CHAIN} environment variable.`
    );
  }

  // Use existing publicClient if available, else create an HTTP client
  const publicClient: PublicClient =
    (adminApp.publicClient as any) ||
    (createPublicClient({
      chain: chain as any,
      transport: http(rpcUrl)
    }) as any);

  const salt = keccak256(stringToHex(agentName)) as `0x${string}`;

  // Create signer object - must have either walletClient or account
  // toMetaMaskSmartAccount expects signer to have either walletClient or account, not both
  // Prefer walletClient over account if both are available
  const signer: { walletClient?: any; account?: any } = adminApp.walletClient
    ? { walletClient: adminApp.walletClient as any }
    : { account: adminApp.account! };

  const clientConfig: Record<string, unknown> = {
    client: publicClient,
    implementation: Implementation.Hybrid,
    signer,
    deployParams: [adminApp.address as `0x${string}`, [], [], []],
    deploySalt: salt
  };

  const accountClient = await toMetaMaskSmartAccount(clientConfig as any);
  return accountClient;
}


