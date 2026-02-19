import {
  createWalletClient,
  createPublicClient,
  custom,
  type WalletClient,
  type PublicClient,
  type Chain
} from "viem";
import { sepolia } from "viem/chains";
import type { Address } from "viem";
import { Implementation, toMetaMaskSmartAccount } from "@metamask/smart-accounts-kit";

type GetAAAccountClientOptions = {
  chain?: Chain;
  walletClient?: WalletClient;
  publicClient?: PublicClient;
  ethereumProvider?: any; // EIP-1193 provider (e.g. Web3Auth / MetaMask)
};

/**
 * Individual Service
 * 
 * Provides utilities for managing individual (person) account abstraction clients.
 */
export class IndivService {
  /**
   * Build a counterfactual AA account client for an individual using a fixed salt (0x1),
   * rather than deriving the salt from a name.
   *
   * This mirrors the getCounterfactualAccountClientByAgentName flow but
   * uses a constant deploySalt so the address is only keyed on EOA + implementation.
   */
  static async getCounterfactualAccountClientByIndividual(
    eoaAddress: `0x${string}`,
    options?: GetAAAccountClientOptions
  ): Promise<any> {
    const chain = options?.chain || sepolia;

    console.info(" @@@@@@@@@@@@ getting counterfactual account client by individual: ", eoaAddress);
    let walletClient: WalletClient;
    if (options?.walletClient) {
      walletClient = options.walletClient;
    } else if (options?.ethereumProvider) {
      walletClient = createWalletClient({
        chain: chain as any,
        transport: custom(options.ethereumProvider),
        account: eoaAddress as Address
      });
    } else {
      throw new Error(
        "No wallet client found. Ensure MetaMask/Web3Auth is available or pass walletClient in options."
      );
    }

    let publicClient: PublicClient;
    if (options?.publicClient) {
      publicClient = options.publicClient;
    } else if (options?.ethereumProvider) {
      publicClient = createPublicClient({
        chain: chain as any,
        transport: custom(options.ethereumProvider)
      }) as any;
    } else {
      throw new Error(
        "No public client found. Ensure RPC URL is available or pass publicClient in options."
      );
    }

    // Use a fixed salt rather than deriving from a name/individualId.
    const salt = "0x1" as `0x${string}`;

    const clientConfig: Record<string, unknown> = {
      client: publicClient,
      implementation: Implementation.Hybrid,
      signer: {
        walletClient
      },
      deployParams: [eoaAddress as `0x${string}`, [], [], []],
      deploySalt: salt
    };

    const counterfactualAccountClient = await toMetaMaskSmartAccount(
      clientConfig as any
    );
    console.info(" @@@@@@@@@@@@ counterfactual account client: ", counterfactualAccountClient.address);
    return counterfactualAccountClient;
  }
}

// Export a convenience function for backwards compatibility
export const getCounterfactualAccountClientByIndividual =
  IndivService.getCounterfactualAccountClientByIndividual;

