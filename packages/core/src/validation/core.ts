/**
 * Validation Core Functions
 * Customizable validation request functions for ITG project
 */

import type { Chain } from 'viem';
import { http } from 'viem';
import { createBundlerClient } from 'viem/account-abstraction';
import type { SmartAccount } from 'viem/account-abstraction';
import type { AgenticTrustClient } from '../a2a/server';

// Re-export buildDid8004 from @agentic-trust/core
// Note: We define our own parseDid8004 below for customization
// Implement locally to avoid static import issues
export function buildDid8004(chainId: number, agentId: bigint | string): string {
  return `did:8004:${chainId}:${agentId}`;
}

// Types
export interface ValidationRequestOptions {
  agentDid: string; // The DID of the agent requesting validation
  validatorAddress: string; // The address of the validator agent
  chain: Chain;
  requesterAccountClient: any; // The account client for the requester
  onStatusUpdate?: (message: string) => void;
  requestUri?: string;
  requestHash?: string;
}

export interface ValidationRequestResult {
  txHash: string;
  validatorAddress: string;
  requestHash?: string;
}

export interface AgentOperationPlan {
  success: boolean;
  operation: 'create' | 'update';
  mode: 'aa' | 'eoa';
  chainId: number;
  tokenUri?: string;
  cid?: string;
  identityRegistry?: string;
  bundlerUrl?: string;
  calls?: Array<{
    to: string;
    data: string;
    value: string;
  }>;
  transaction?: {
    to: string;
    data: string;
    value: string;
    gas?: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    nonce?: number;
    chainId: number;
  };
  metadata?: Record<string, unknown>;
}

export interface PrepareValidationRequestPayload {
  agentDid8004: string;
  validatorAddress: string;
  mode?: 'aa' | 'eoa';
  requestUri?: string;
  requestHash?: string;
}

export interface AgentApiContext {
  tenantId?: string;
  requestId?: string;
  /**
   * Optional override for providing a pre-configured AgenticTrustClient.
   * Falls back to the shared singleton if not provided.
   */
  getClient?: () => Promise<AgenticTrustClient>;
  /**
   * Optional override for providing getValidationRegistryClient function.
   * If not provided, will attempt to import from @agentic-trust/core/server.
   */
  getValidationRegistryClient?: (chainId: number) => Promise<any>;
}

export class ValidationApiError extends Error {
  constructor(
    message: string,
    public status: number = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ValidationApiError';
  }
}

/**
 * Parse did:8004 identifier into chainId and agentId
 */
export function parseDid8004(did8004: string): { chainId: number; agentId: bigint } {
  if (!did8004 || typeof did8004 !== 'string') {
    throw new ValidationApiError('did8004 must be a non-empty string', 400);
  }

  // Handle URL encoding
  let decoded = did8004;
  try {
    decoded = decodeURIComponent(did8004);
  } catch {
    // If decoding fails, use original
    decoded = did8004;
  }

  // Format: did:8004:chainId:agentId
  if (!decoded.startsWith('did:8004:')) {
    throw new ValidationApiError(
      `Invalid did:8004 format. Expected did:8004:chainId:agentId, got: ${decoded}`,
      400,
    );
  }

  const parts = decoded.split(':');
  if (parts.length < 4) {
    throw new ValidationApiError(
      `Invalid did:8004 format. Expected did:8004:chainId:agentId, got: ${decoded}`,
      400,
    );
  }

  const chainIdStr = parts[2];
  const agentIdStr = parts.slice(3).join(':'); // Handle cases where agentId might contain colons

  const chainId = Number.parseInt(chainIdStr, 10);
  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new ValidationApiError(
      `Invalid chainId in did:8004: ${chainIdStr}`,
      400,
    );
  }

  const agentId = BigInt(agentIdStr);
  if (agentId < 0) {
    throw new ValidationApiError(
      `Invalid agentId in did:8004: ${agentIdStr}`,
      400,
    );
  }

  return { chainId, agentId };
}

/**
 * Get bundler URL for a given chain ID
 */
function getChainBundlerUrl(chainId: number): string | undefined {
  // These should be set as environment variables
  if (chainId === 11155111) {
    return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA || process.env.AGENTIC_TRUST_BUNDLER_URL_SEPOLIA;
  }
  if (chainId === 84532) {
    return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA || process.env.AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA;
  }
  if (chainId === 11155420) {
    return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA || process.env.AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA;
  }
  return undefined;
}

/**
 * Normalize call value to string
 */
function normalizeCallValue(value: unknown): string {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return '0';
}

/**
 * Normalize calls array
 */
function normalizeCalls(
  rawCalls?: Array<{ to?: string; data?: string; value?: unknown }>,
): Array<{ to: string; data: string; value: string }> {
  if (!Array.isArray(rawCalls)) {
    return [];
  }
  return rawCalls.map((call) => {
    if (!call?.to || !call?.data) {
      throw new ValidationApiError('Invalid call returned from agent preparation', 500, {
        call,
      });
    }
    return {
      to: call.to,
      data: call.data,
      value: normalizeCallValue(call.value),
    };
  });
}

/**
 * Prepare validation request - server-side function
 * This prepares the validation request transaction but doesn't execute it
 */
export async function prepareValidationRequestCore(
  ctx: AgentApiContext | undefined,
  input: PrepareValidationRequestPayload,
  getClient: () => Promise<AgenticTrustClient>,
): Promise<AgentOperationPlan> {
  if (!input.agentDid8004?.trim()) {
    throw new ValidationApiError('agentDid8004 parameter is required', 400);
  }

  const mode: 'aa' | 'eoa' = input.mode ?? 'aa';
  if (mode !== 'aa') {
    throw new ValidationApiError(
      `mode "${mode}" is not supported for validation requests. Only "aa" mode is supported.`,
      400,
    );
  }

  const parsed = (() => {
    try {
      return parseDid8004(input.agentDid8004);
    } catch (error) {
      throw new ValidationApiError(
        `Invalid agentDid8004 identifier: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        400,
      );
    }
  })();

  const client = await (ctx?.getClient ? ctx.getClient() : getClient());
  
  // Get agent to verify it exists
  const agent = await client.agents.getAgent(parsed.agentId.toString());
  if (!agent) {
    throw new ValidationApiError('Agent not found', 404, { agentDid8004: input.agentDid8004 });
  }

  // Get validation client
  // Use the provided getValidationRegistryClient from context, or try to import it
  let getValidationRegistryClientFn: (chainId: number) => Promise<any>;

  if (ctx?.getValidationRegistryClient) {
    getValidationRegistryClientFn = ctx.getValidationRegistryClient;
  } else {
    try {
      // First try ESM dynamic import
      const serverModule = '@agentic-trust/core' + '/server';
      const mod = await import(serverModule);
      getValidationRegistryClientFn = mod.getValidationRegistryClient;
      if (!getValidationRegistryClientFn) {
        throw new Error('getValidationRegistryClient not found in module');
      }
    } catch (esmErr) {
      try {
        // Fallback to CommonJS require (works in Node.js)
        // @ts-ignore - require is available in Node.js
        const req = new Function('return require')();
        const mod = req('@agentic-trust/core/server');
        getValidationRegistryClientFn = mod.getValidationRegistryClient;
        if (!getValidationRegistryClientFn) {
          throw new Error('getValidationRegistryClient not found in module');
        }
      } catch (requireErr) {
        const errorMsg = esmErr instanceof Error ? esmErr.message : String(esmErr);
        throw new ValidationApiError(
          `Could not import getValidationRegistryClient from @agentic-trust/core/server. ESM error: ${errorMsg}. Please provide getValidationRegistryClient in the context.`,
          500,
        );
      }
    }
  }

  const validationRegistryClient = await getValidationRegistryClientFn(parsed.chainId);

  const validatorAddress = input.validatorAddress;
  if (!validatorAddress) {
    throw new ValidationApiError(
      'validatorAddress is required',
      400,
    );
  }

  // Prepare the validation request transaction
  // Type assertion needed because TypeScript may not see the method on the base class type
  const { txRequest, requestHash } = await (validationRegistryClient as any).prepareValidationRequestTx({
    agentId: parsed.agentId,
    validatorAddress,
    requestUri: input.requestUri,
    requestHash: input.requestHash,
  });

  // Get bundler URL for AA mode
  const bundlerUrl = getChainBundlerUrl(parsed.chainId);
  if (!bundlerUrl) {
    throw new ValidationApiError(
      `Bundler URL not configured for chain ${parsed.chainId}`,
      500,
    );
  }

  // Map TxRequest into AgentOperationCall for AA mode
  const call = {
    to: txRequest.to,
    data: txRequest.data,
    value: normalizeCallValue(txRequest.value),
  };

  // Return the plan with validator address and request hash in metadata
  return {
    success: true,
    operation: 'update',
    mode: 'aa',
    chainId: parsed.chainId,
    bundlerUrl,
    calls: [call],
    transaction: undefined,
    metadata: {
      validatorAddress,
      requestHash: requestHash || input.requestHash,
    },
  };
}

/**
 * Request validation with wallet - client-side function
 * This executes the validation request using the account client
 * 
 * This function uses the original requestValidationWithWallet from @agentic-trust/core
 * and wraps it with custom error handling for the ITG project.
 */
export async function requestValidationWithWallet(
  options: ValidationRequestOptions,
): Promise<ValidationRequestResult> {
  const { agentDid, validatorAddress, chain, requesterAccountClient, onStatusUpdate, requestUri, requestHash } = options;

  if (!agentDid) {
    throw new ValidationApiError('agentDid is required', 400);
  }

  if (!validatorAddress) {
    throw new ValidationApiError('validatorAddress is required', 400);
  }

  if (!requesterAccountClient) {
    throw new ValidationApiError('requesterAccountClient is required', 400);
  }

  onStatusUpdate?.('Preparing validation request...');

  try {
    // Local implementation: Call API to prepare request instead of using imported library function
    // This avoids complex import issues with @agentic-trust/core in different environments
    
    // 1. Prepare request via API
    console.log('[requestValidationWithWallet] Sending request to API:', {
      url: `/api/agents/${encodeURIComponent(agentDid)}/validation-request`,
      validatorAccount: validatorAddress,
      requestUri,
      requestHash
    });

    const response = await fetch(`/api/agents/${encodeURIComponent(agentDid)}/validation-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        validatorAddress: validatorAddress,
        requestUri,
        requestHash
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as any;
      throw new Error(err.message || err.error || `Failed to prepare validation request: ${response.statusText}`);
    }

    const plan = await response.json() as AgentOperationPlan;

    if (!plan.success) {
      throw new Error('Validation preparation failed on server');
    }

    onStatusUpdate?.('Signing and sending validation request...');

    // 2. Execute transaction using requesterAccountClient
    let txHash: string = '';

    if (plan.calls && plan.calls.length > 0) {
      // Transform calls to the format expected by the client
      const txCalls = plan.calls.map(call => ({
        to: call.to as `0x${string}`,
        data: call.data as `0x${string}`,
        value: BigInt(call.value)
      }));

      // ALWAYS use Bundler Client for Smart Accounts (per user request)
      if (typeof (requesterAccountClient as any).signUserOperation === 'function') {
         console.log('[requestValidationWithWallet] Using Bundler Client for Smart Account...');
         
         if (!plan.bundlerUrl) {
            throw new Error('Bundler URL is required to send UserOperation with Smart Account, but missing in plan');
         }

         // 1. Create Bundler Client with sponsored paymaster
         const bundlerClient = createBundlerClient({
            transport: http(plan.bundlerUrl),
            chain: chain as any,
            paymaster: true as any,
            paymasterContext: { mode: 'SPONSORED' },
         } as any);

         // 2. Optional Gas Estimation (Pimlico)
         let fee: any = {};
         try {
            // Dynamic import to avoid bundling issues if package missing
            // @ts-ignore
            const { createPimlicoClient } = await import('permissionless/clients/pimlico');
            const pimlico = createPimlicoClient({ transport: http(plan.bundlerUrl) } as any);
            const gas = await (pimlico as any).getUserOperationGasPrice();
            fee = gas.fast || {};
            console.log('[requestValidationWithWallet] Fetched Pimlico gas prices:', fee);
         } catch (e) {
            console.warn('[requestValidationWithWallet] Failed to fetch Pimlico gas prices, using default:', e);
         }

         // 3. Send UserOperation
         const userOperationHash = await (bundlerClient as any).sendUserOperation({
            account: requesterAccountClient as SmartAccount,
            calls: txCalls,
            ...fee,
         });

         console.log('[requestValidationWithWallet] UserOp sent:', userOperationHash);

         // 4. Wait for Receipt
         const receipt = await (bundlerClient as any).waitForUserOperationReceipt({ 
            hash: userOperationHash 
         });
         
         // Use transaction hash from receipt
         txHash = receipt.receipt.transactionHash;
      }
      else {
         console.error('Client methods:', Object.keys(requesterAccountClient));
         throw new Error('Account client must be a Smart Account (signUserOperation missing). Validation requires Account Abstraction.');
      }
    } else if (plan.transaction) {
       // EOA mode or raw transaction fallback
       if (typeof (requesterAccountClient as any).sendTransaction === 'function') {
           txHash = await (requesterAccountClient as any).sendTransaction({
              to: plan.transaction.to as `0x${string}`,
              data: plan.transaction.data as `0x${string}`,
              value: BigInt(plan.transaction.value)
           });
       } else {
           throw new Error('Account client does not support sendTransaction for EOA mode');
       }
    } else {
       throw new Error('No transaction calls returned from validation preparation');
    }

    onStatusUpdate?.('Validation request submitted successfully!');

    // Return result
    return {
      txHash,
      validatorAddress: validatorAddress,
      requestHash: plan.metadata?.requestHash as string,
    };
  } catch (error) {
    // Custom error handling for ITG project
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Check for specific error cases and provide better messages
    if (errorMessage.includes('exists') || errorMessage.includes('0x08c379a0')) {
      throw new ValidationApiError(
        'A validation request for this agent already exists',
        400,
        { did8004: agentDid, originalError: errorMessage },
      );
    }

    // Re-throw ValidationApiError as-is
    if (error instanceof ValidationApiError) {
      throw error;
    }

    // Re-throw as ValidationApiError for consistent error handling
    throw new ValidationApiError(
      errorMessage,
      500,
      { did8004: agentDid, originalError: error },
    );
  }
}

