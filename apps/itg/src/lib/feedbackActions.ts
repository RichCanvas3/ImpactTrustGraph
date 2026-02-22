import type { SafeEventEmitterProvider } from '@web3auth/base';

export interface NormalizeA2aOptions {
  endpoint?: string | null;
}

/**
 * Normalize any user-provided agent endpoint to a usable /api/a2a HTTPS URL.
 */
export function normalizeA2aEndpoint(rawEndpoint?: string | null): string | null {
  if (!rawEndpoint) return null;

  let endpoint = rawEndpoint.trim();
  if (!endpoint) return null;

  if (endpoint.includes('/.well-known/agent-card.json')) {
    endpoint = endpoint.replace('/.well-known/agent-card.json', '/api/a2a');
  }

  if (!endpoint.endsWith('/api/a2a')) {
    endpoint = `${endpoint.replace(/\/$/, '')}/api/a2a`;
  }

  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    endpoint = endpoint.replace(/^\/+/, '');
    endpoint = `https://${endpoint}`;
  }

  return endpoint;
}

export interface ApproveFeedbackRequestArgs {
  agentA2aEndpoint?: string | null;
  clientAddress: string;
  agentId: string | number | bigint;
  feedbackRequestId: string | number;
}

export interface ApproveFeedbackRequestResult {
  endpoint: string;
  response: any;
}

export async function approveFeedbackRequestAction(
  args: ApproveFeedbackRequestArgs,
): Promise<ApproveFeedbackRequestResult> {
  const { agentA2aEndpoint, clientAddress, agentId, feedbackRequestId } = args;
  const normalizedEndpoint = normalizeA2aEndpoint(agentA2aEndpoint);

  if (!normalizedEndpoint) {
    throw new Error('Agent A2A endpoint is required to approve feedback requests.');
  }

  const normalizedAgentId =
    typeof agentId === 'bigint' ? agentId.toString() : String(agentId);

  const payload = {
    skillId: 'agent.feedback.requestAuth',
    payload: {
      clientAddress,
      agentId: normalizedAgentId,
      feedbackRequestId,
    },
  };

  const response = await fetch(normalizedEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error ||
        errorData.message ||
        `Feedback approval failed with status ${response.status}`,
    );
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || result.response?.error || 'Failed to approve feedback request');
  }

  return {
    endpoint: normalizedEndpoint,
    response: result,
  };
}

export interface ResolveClientAddressOptions {
  walletAddress?: string | null;
  web3Provider?: SafeEventEmitterProvider | null;
}

export async function resolveClientAddress({
  walletAddress,
  web3Provider,
}: ResolveClientAddressOptions): Promise<string> {
  if (walletAddress) {
    return walletAddress;
  }

  if (web3Provider) {
    try {
      const { getWalletAddress } = await import('@agentic-trust/core/client');
      const providerAddress = await getWalletAddress(web3Provider as any);
      if (providerAddress) {
        return providerAddress;
      }
    } catch (err) {
      console.warn('[feedbackActions] Failed to resolve wallet from provider:', err);
    }
  }

  const resp = await fetch('/api/client-address');
  if (resp.ok) {
    const data = await resp.json();
    if (data?.clientAddress) {
      return data.clientAddress;
    }
  }

  throw new Error('Client address not available. Please connect your wallet.');
}

export interface SubmitFeedbackArgs {
  walletAddress?: string | null;
  web3Provider?: SafeEventEmitterProvider | null;
  rating: number;
  comment: string;
  agentName?: string | null;
  fallbackAgentId?: string | number | bigint | null;
  fallbackChainId?: number | null;
  preExistingFeedbackAuth?: any;
  preExistingFeedbackAgentId?: string | number | bigint | null;
  preExistingFeedbackChainId?: number | null;
  preExistingFeedbackRequestId?: number | string | null;
  tag1?: string;
  tag2?: string;
  skillId?: string;
  context?: string;
  capability?: string;
  markFeedbackGivenEndpoint?: string;
}

export interface SubmitFeedbackResult {
  txHash?: string;
  feedbackAuthUsed?: any;
  feedbackRequestId?: number | string | null;
}

export async function submitFeedbackAction({
  walletAddress,
  web3Provider,
  rating,
  comment,
  agentName,
  fallbackAgentId,
  fallbackChainId,
  preExistingFeedbackAuth,
  preExistingFeedbackAgentId,
  preExistingFeedbackChainId,
  preExistingFeedbackRequestId,
  tag1,
  tag2,
  skillId,
  context,
  capability,
  markFeedbackGivenEndpoint,
}: SubmitFeedbackArgs): Promise<SubmitFeedbackResult> {
  if (!comment.trim()) {
    throw new Error('Please enter a comment before submitting feedback.');
  }

  const clientAddress = await resolveClientAddress({ walletAddress, web3Provider });

  const fallbackAgentIdStr =
    fallbackAgentId !== null && fallbackAgentId !== undefined
      ? typeof fallbackAgentId === 'bigint'
        ? fallbackAgentId.toString()
        : String(fallbackAgentId)
      : undefined;

  const resolvedAgentId =
    (preExistingFeedbackAgentId !== null && preExistingFeedbackAgentId !== undefined
      ? String(preExistingFeedbackAgentId)
      : undefined) ||
    (preExistingFeedbackAuth && (preExistingFeedbackAuth as any)?.agentId
      ? String((preExistingFeedbackAuth as any).agentId)
      : undefined) ||
    fallbackAgentIdStr;

  if (!resolvedAgentId) {
    throw new Error('Agent ID is required to submit feedback.');
  }

  const resolvedChainId =
    (typeof preExistingFeedbackChainId === 'number' && preExistingFeedbackChainId) ||
    (typeof (preExistingFeedbackAuth as any)?.chainId === 'number'
      ? Number((preExistingFeedbackAuth as any).chainId)
      : undefined) ||
    (typeof fallbackChainId === 'number' ? fallbackChainId : undefined);

  if (!resolvedChainId) {
    throw new Error('Agent chain ID is required to submit feedback.');
  }

  let feedbackAuthToUse = preExistingFeedbackAuth;

  if (!feedbackAuthToUse) {
    const feedbackAuthParams = new URLSearchParams();
    feedbackAuthParams.set('clientAddress', clientAddress);
    if (agentName) {
      feedbackAuthParams.set('agentName', agentName);
    }
    if (fallbackAgentIdStr) {
      feedbackAuthParams.set('agentId', fallbackAgentIdStr);
    }
    if (fallbackChainId) {
      feedbackAuthParams.set('chainId', String(fallbackChainId));
    }

    const feedbackAuthResponse = await fetch(`/api/feedback-auth?${feedbackAuthParams.toString()}`);
    if (!feedbackAuthResponse.ok) {
      const errorData = await feedbackAuthResponse.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || 'Failed to get feedback authorization.');
    }

    const feedbackAuthData = await feedbackAuthResponse.json();
    const feedbackAuthId =
      feedbackAuthData.feedbackAuthId || feedbackAuthData.response?.feedbackAuth;

    if (!feedbackAuthId) {
      throw new Error('No feedback authorization returned by provider.');
    }

    feedbackAuthToUse = feedbackAuthId;
  }

  const score = rating * 20;

  const feedbackResponse = await fetch('/api/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      agentId: resolvedAgentId,
      chainId: resolvedChainId,
      score,
      feedback: comment,
      feedbackAuth: feedbackAuthToUse,
      clientAddress,
      ...(agentName && { agentName }),
      ...(tag1 && { tag1 }),
      ...(tag2 && { tag2 }),
      ...(skillId && { skill: skillId }),
      ...(context && { context }),
      ...(capability && { capability }),
    }),
  });

  if (!feedbackResponse.ok) {
    const errorData = await feedbackResponse.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || 'Failed to submit feedback.');
  }

  const feedbackResult = await feedbackResponse.json();
  const feedbackTxHash = feedbackResult?.txHash as string | undefined;

  if (feedbackTxHash && preExistingFeedbackRequestId) {
    try {
      await markFeedbackRequestGivenAction({
        feedbackRequestId: preExistingFeedbackRequestId,
        txHash: feedbackTxHash,
        endpoint: markFeedbackGivenEndpoint,
      });
    } catch (markError) {
      console.warn('[feedbackActions] Failed to mark feedback request as given:', markError);
    }
  }

  return {
    txHash: feedbackTxHash,
    feedbackAuthUsed: feedbackAuthToUse,
    feedbackRequestId: preExistingFeedbackRequestId ?? null,
  };
}

export interface MarkFeedbackRequestGivenArgs {
  feedbackRequestId: number | string;
  txHash: string;
  endpoint?: string;
}

export async function markFeedbackRequestGivenAction({
  feedbackRequestId,
  txHash,
  endpoint = 'https://agents-admin.impact-agent.io/api/a2a',
}: MarkFeedbackRequestGivenArgs): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      skillId: 'agent.feedback.markGiven',
      payload: {
        feedbackRequestId,
        txHash,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error ||
        errorData.message ||
        `Failed to mark feedback request as given (status ${response.status})`,
    );
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || result.response?.error || 'markGiven A2A call failed.');
  }
}


