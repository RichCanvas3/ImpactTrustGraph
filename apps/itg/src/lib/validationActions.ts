import { normalizeA2aEndpoint } from './feedbackActions';

export interface AcceptValidationRequestArgs {
  agentA2aEndpoint?: string | null;
  agentId: string | number | bigint;
  chainId: number;
  requestHash?: string | null;
  targetAgentId?: string | number | bigint | null;
  targetAgentDid?: string | null;
}

export interface AcceptValidationRequestResult {
  endpoint: string;
  response: any;
}

/**
 * Accept a validation request by calling the agent's validation.respond skill.
 * This is similar to approveFeedbackRequestAction but for validation requests.
 */
export async function acceptValidationRequestAction(
  args: AcceptValidationRequestArgs,
): Promise<AcceptValidationRequestResult> {
  const { agentA2aEndpoint, agentId, chainId, requestHash, targetAgentId, targetAgentDid } = args;
  const normalizedEndpoint = normalizeA2aEndpoint(agentA2aEndpoint);

  if (!normalizedEndpoint) {
    throw new Error('Agent A2A endpoint is required to accept validation requests.');
  }

  const normalizedAgentId =
    typeof agentId === 'bigint' ? agentId.toString() : String(agentId);

  const normalizedTargetAgentId = targetAgentId
    ? (typeof targetAgentId === 'bigint' ? targetAgentId.toString() : String(targetAgentId))
    : undefined;

  const payload: any = {
    skillId: 'agent.validation.respond',
    payload: {
      agentId: normalizedTargetAgentId || normalizedAgentId,
      chainId,
      ...(requestHash && { requestHash }),
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
        `Validation acceptance failed with status ${response.status}`,
    );
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || result.response?.error || 'Failed to accept validation request');
  }

  return {
    endpoint: normalizedEndpoint,
    response: result,
  };
}

/**
 * Send a validation request message to an coalition agent.
 * This is called after a validation request is submitted on-chain.
 * Messages are sent through the inbox service so they appear in the validator's inbox.
 */
export async function sendValidationRequestMessage(args: {
  fromAgentDid?: string;
  fromAgentName?: string;
  toAgentDid?: string;
  toAgentName?: string;
  requestHash: string;
  subject?: string;
  body?: string;
}): Promise<void> {
  const {
    fromAgentDid,
    fromAgentName,
    toAgentDid,
    toAgentName,
    requestHash,
    subject = 'Validation Request',
    body,
  } = args;

  // Use the inbox service endpoint to ensure message is stored in inbox database
  const inboxEndpoint = 'https://agents-inbox.impact-agent.io/api/a2a';

  if (!toAgentDid && !toAgentName) {
    throw new Error('Either toAgentDid or toAgentName is required to send message.');
  }

  if (!fromAgentDid && !fromAgentName) {
    throw new Error('Either fromAgentDid or fromAgentName is required to send message.');
  }

  const messageBody = body || `A validation request has been submitted for your review.\n\nRequest Hash: ${requestHash}`;

  const payload = {
    skillId: 'agent.inbox.sendMessage',
    payload: {
      fromAgentDid,
      fromAgentName,
      toAgentDid,
      toAgentName,
      subject,
      body: messageBody,
      contextType: 'validation_request',
      contextId: requestHash,
    },
  };

  const response = await fetch(inboxEndpoint, {
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
        `Failed to send validation request message: ${response.status} ${response.statusText}`,
    );
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || result.response?.error || 'Failed to send validation request message');
  }
}

