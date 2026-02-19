import { notFound } from 'next/navigation';
import {
  buildDid8004,
  parseDid8004,
} from '@agentic-trust/core';
import {
  getAgenticTrustClient,
  getAgentValidationsSummary,
  type AgentValidationsSummary,
} from '@agentic-trust/core/server';
import {
  Box,
  Chip,
  Container,
  Divider,
  Grid,
  Typography,
  Card,
  CardContent,
} from '@mui/material';
import { OrganizationFeedbackControls } from '../../../components/OrganizationFeedbackControls';

type DetailsPageParams = {
  params: Promise<{
    did8004: string[];
  }>;
};

// Local representation of an agent, similar to AgentsPageAgent from the example
interface AgentsPageAgent {
  agentId: string;
  chainId: number;
  agentName: string | null;
  agentAccount: string | null;
  ownerAddress: string | null;
  tokenUri: string | null;
  description: string | null;
  image: string | null;
  contractAddress: string | null;
  a2aEndpoint: string | null;
  agentAccountEndpoint: string | null;
  mcp: unknown;
  did: string | null;
  createdAtTime: number | null;
  feedbackCount: number | null;
  feedbackAverageScore: number | null;
  validationPendingCount: number | null;
  validationCompletedCount: number | null;
  validationRequestedCount: number | null;
}

export type AgentDetailsFeedbackSummary = {
  count: string | number;
  averageScore: number | null;
} | null;

export type ValidationEntry = {
  agentId: string | null;
  requestHash: string | null;
  validatorAddress: string | null;
  response: number;
  responseHash: string | null;
  tag: string | null;
  lastUpdate: number | null;
  txHash?: string | null;
  blockNumber?: number | null;
  timestamp?: number | null;
  requestUri?: string | null;
  requestJson?: string | null;
  responseUri?: string | null;
  responseJson?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export interface AgentDetailsValidationsSummary {
  pending: ValidationEntry[];
  completed: ValidationEntry[];
}

// Normalize requestHash for comparison between contract (bytes32) and GraphQL (string)
// Handles different formats: string, bigint, number, and ensures consistent 0x-prefixed lowercase hex
function normalizeRequestHash(hash: unknown): string | null {
  if (!hash) return null;
  let hashStr: string;
  if (typeof hash === 'string') {
    hashStr = hash;
  } else if (typeof hash === 'bigint' || typeof hash === 'number') {
    hashStr = hash.toString(16);
    if (!hashStr.startsWith('0x')) {
      hashStr = '0x' + hashStr.padStart(64, '0');
    }
  } else {
    hashStr = String(hash);
  }
  // Ensure 0x prefix and normalize to lowercase
  if (!hashStr.startsWith('0x')) {
    hashStr = '0x' + hashStr;
  }
  return hashStr.toLowerCase();
}

export default async function AgentDetailsPage({ params }: DetailsPageParams) {
  const { did8004: did8004Array } = await params;

  let decodedDid = '';

  // Handle legacy path format: /agents/[chainId]/[agentId]
  // If we have exactly 2 segments and the first one looks like a chain ID (numeric), construct a DID from it.
  if (Array.isArray(did8004Array) && did8004Array.length === 2 && /^\d+$/.test(did8004Array[0])) {
    const [chainId, agentId] = did8004Array;
    try {
      decodedDid = buildDid8004(Number(chainId), agentId);
    } catch {
      // Fallback to standard processing if build fails
      decodedDid = did8004Array.join('/');
    }
  } else {
    // Standard processing for DID paths (which might be split by slashes if encoded)
    decodedDid = Array.isArray(did8004Array) ? did8004Array.join('/') : (did8004Array as any);
  }

  let parsed;
  try {
    // Keep decoding until no more % encoded characters remain
    let previousDecoded = '';
    let decodeCount = 0;
    while (decodedDid !== previousDecoded && decodedDid.includes('%') && decodeCount < 5) {
      previousDecoded = decodedDid;
      try {
        decodedDid = decodeURIComponent(decodedDid);
        decodeCount++;
      } catch {
        // If decoding fails, break the loop
        break;
      }
    }

    parsed = parseDid8004(decodedDid);
  } catch (error) {
    console.error('[AgentDetailsPage] Failed to parse DID:', {
      original: did8004Array,
      decoded: decodedDid,
      error: error instanceof Error ? error.message : String(error),
    });
    notFound();
  }

  if (!parsed || !parsed.chainId || !parsed.agentId) {
    notFound();
  }

  const chainId = parsed.chainId;
  const agentIdParam = parsed.agentId.toString();

  const client = await getAgenticTrustClient();
  const agent = await client.agents.getAgent(agentIdParam, chainId);
  if (!agent) {
    notFound();
  }

  const numericAgentId = agent.agentId?.toString?.() ?? agentIdParam;
  let ownerAddress: string | null = null;
  try {
    ownerAddress = await client.getAgentOwner(numericAgentId, chainId);
  } catch (error) {
    console.warn('[AgentDetailsPage] Failed to resolve owner address:', error);
  }

  const [feedbackItems, feedbackSummary, validations] = await Promise.all([
    client
      .getAgentFeedback({
        agentId: numericAgentId,
        chainId,
        includeRevoked: true,
        limit: 200,
      })
      .catch(() => []),
    client
      .getReputationSummary({
        agentId: numericAgentId,
        chainId,
      })
      .catch(() => null),
    getAgentValidationsSummary(chainId, numericAgentId).catch(
      () => null as AgentValidationsSummary | null,
    ),
  ]);

  // Access image from agent data - try multiple paths
  const agentImage =
    (agent as any).image ??
    (agent as any).data?.image ??
    null;
  const agentTokenUri =
    (agent as any).tokenUri ??
    (agent as any).data?.tokenUri ??
    null;

  const serializedAgent: AgentsPageAgent = {
    agentId: agent.agentId?.toString?.() ?? agentIdParam,
    chainId,
    agentName: agent.agentName ?? null,
    agentAccount:
      (agent as any).agentAccount ??
      (agent as any).account ??
      (agent as any).owner ??
      (agent as any).data?.agentAccount ??
      (agent as any).data?.account ??
      (agent as any).data?.owner ??
      null,
    ownerAddress:
      ownerAddress ??
      (agent as any).ownerAddress ??
      (agent as any).data?.ownerAddress ??
      null,
    tokenUri: agentTokenUri,
    description: (agent as any).description ?? null,
    image: agentImage,
    contractAddress: (agent as any).contractAddress ?? null,
    a2aEndpoint: (agent as any).a2aEndpoint ?? null,
    agentAccountEndpoint: (agent as any).agentAccountEndpoint ?? null,
    mcp: (agent as any).mcp ?? null,
    did: (agent as any).did ?? null,
    createdAtTime: (agent as any).createdAtTime ?? null,
    feedbackCount: (agent as any).feedbackCount ?? null,
    feedbackAverageScore: (agent as any).feedbackAverageScore ?? null,
    validationPendingCount: (agent as any).validationPendingCount ?? null,
    validationCompletedCount: (agent as any).validationCompletedCount ?? null,
    validationRequestedCount: (agent as any).validationRequestedCount ?? null,
  };

  const serializedFeedback = JSON.parse(
    JSON.stringify(Array.isArray(feedbackItems) ? feedbackItems : []),
  ) as unknown[];

  const serializedSummary: AgentDetailsFeedbackSummary = feedbackSummary
    ? {
        count:
          typeof feedbackSummary.count === 'bigint'
            ? feedbackSummary.count.toString()
            : feedbackSummary.count ?? '0',
        averageScore: feedbackSummary.averageScore ?? null,
      }
    : null;

  const serializedValidations: AgentDetailsValidationsSummary | null = validations
    ? {
        pending: validations.pending.map((entry: any) => serializeValidationEntry(entry)),
        completed: validations.completed.map((entry: any) => serializeValidationEntry(entry)),
      }
    : null;

  const did8004 = buildDid8004(chainId, Number(numericAgentId));
  const shadowAgentSrc = '/8004ShadowAgent.png';
  const heroImageSrc = (await getAgentHeroImage(serializedAgent)) ?? shadowAgentSrc;

  const ownerDisplaySource =
    serializedAgent.ownerAddress ??
    serializedAgent.agentAccount ??
    null;

  const ownerDisplay =
    ownerDisplaySource && ownerDisplaySource.length > 10
      ? `${ownerDisplaySource.slice(0, 6)}…${ownerDisplaySource.slice(-4)}`
      : ownerDisplaySource || '—';

  // Use actual fetched validation data instead of agent object fields
  const validationCompletedCount = serializedValidations?.completed?.length ?? 0;
  const validationPendingCount = serializedValidations?.pending?.length ?? 0;
  const validationSummaryText = `${validationCompletedCount} completed · ${validationPendingCount} pending`;

  // Use actual fetched feedback summary instead of agent object fields
  const feedbackCount = feedbackSummary
    ? typeof feedbackSummary.count === 'bigint'
      ? Number(feedbackSummary.count)
      : typeof feedbackSummary.count === 'string'
        ? Number.parseInt(feedbackSummary.count, 10)
        : feedbackSummary.count ?? 0
    : Array.isArray(feedbackItems)
      ? feedbackItems.length
      : 0;

  const feedbackAvg = feedbackSummary?.averageScore ?? null;
  const reviewsSummaryText =
    feedbackCount > 0
      ? `${feedbackCount} reviews · ${feedbackAvg ?? 0} avg`
      : 'No reviews yet';

  const displayDid = decodeDid(serializedAgent.did) ?? did8004;

  return (
    <Container
      maxWidth="lg"
      sx={{
        py: { xs: 4, md: 6 },
      }}
    >
      <Grid container spacing={4}>
        <Grid item xs={12} md={4}>
          <Card>
            <Box
              component="img"
              src={heroImageSrc}
              alt={serializedAgent.agentName || displayDid}
              sx={{
                width: '100%',
                height: 220,
                objectFit: 'cover',
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            />
            <CardContent>
              <Typography variant="h6" gutterBottom noWrap>
                {serializedAgent.agentName || 'Organization Agent'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {displayDid}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Chain ID: {chainId}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Owner: {ownerDisplay}
              </Typography>
              <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <Chip label={validationSummaryText} size="small" color="primary" />
                <Chip label={reviewsSummaryText} size="small" variant="outlined" />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={8}>
          <Box sx={{ mb: 3 }}>
            <Typography variant="h5" gutterBottom>
              Organization details
            </Typography>
            {serializedAgent.description && (
              <Typography variant="body1" sx={{ mb: 2 }}>
                {serializedAgent.description}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              Agent ID: {serializedAgent.agentId}
            </Typography>
            {serializedAgent.agentAccount && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1, fontFamily: 'monospace', wordBreak: 'break-all' }}
              >
                Agent account: {serializedAgent.agentAccount}
              </Typography>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Validations
            </Typography>
            {serializedValidations && (serializedValidations.completed.length > 0 || serializedValidations.pending.length > 0) ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="subtitle2">Completed</Typography>
                {serializedValidations.completed.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No completed validations.
                  </Typography>
                ) : (
                  serializedValidations.completed.map((v, idx) => (
                    <Typography key={`completed-${idx}`} variant="body2" color="text.secondary">
                      ✅ {v.requestHash ?? 'unknown request'} · {v.validatorAddress ?? 'unknown validator'}
                    </Typography>
                  ))
                )}

                <Typography variant="subtitle2" sx={{ mt: 2 }}>
                  Pending
                </Typography>
                {serializedValidations.pending.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No pending validations.
                  </Typography>
                ) : (
                  serializedValidations.pending.map((v, idx) => (
                    <Typography key={`pending-${idx}`} variant="body2" color="text.secondary">
                      ⏳ {v.requestHash ?? 'unknown request'} · {v.validatorAddress ?? 'unknown validator'}
                    </Typography>
                  ))
                )}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No validation data available.
              </Typography>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Feedback
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {reviewsSummaryText}
            </Typography>
            {Array.isArray(serializedFeedback) && serializedFeedback.length > 0 && (
              <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {serializedFeedback.map((item, idx) => {
                  const f = item as any;
                  const score = f.score ?? f.rating ?? null;
                  const comment = f.comment ?? f.text ?? f.message ?? '';
                  const reviewer = f.reviewer ?? f.from ?? f.clientAddress ?? '';
                  return (
                    <Typography key={`feedback-${idx}`} variant="body2" color="text.secondary">
                      {score != null ? `⭐ ${score} - ` : ''}{comment || '(no comment)'} {reviewer ? `— ${reviewer}` : ''}
                    </Typography>
                  );
                })}
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          <OrganizationFeedbackControls
            agentId={serializedAgent.agentId}
            chainId={chainId}
            agentName={serializedAgent.agentName}
            agentA2aEndpoint={serializedAgent.a2aEndpoint}
          />
        </Grid>
      </Grid>
    </Container>
  );
}

async function getAgentHeroImage(agent: AgentsPageAgent): Promise<string | null> {
  // First, try direct image field (same as AgentsPage does)
  if (typeof agent.image === 'string' && agent.image.trim()) {
    const normalized = normalizeResourceUrl(agent.image.trim());
    if (normalized) {
      return normalized;
    }
  }

  // Fallback: try to fetch from tokenUri metadata
  const tokenUri = normalizeResourceUrl(agent.tokenUri);
  if (!tokenUri) {
    return null;
  }
  try {
    const response = await fetch(tokenUri, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    const metadata = await response.json().catch(() => null);
    if (!metadata || typeof metadata !== 'object') {
      return null;
    }
    const fromMetadata = extractImageFromMetadata(metadata as Record<string, unknown>);
    return normalizeResourceUrl(fromMetadata);
  } catch (error) {
    console.warn('[Agent Details] Failed to load tokenUri metadata for image', error);
    return null;
  }
}

function extractImageFromMetadata(metadata: Record<string, unknown>): string | null {
  const candidates: Array<unknown> = [
    metadata.image,
    (metadata as any).image_url,
    (metadata as any).imageUrl,
    (metadata as any).imageURI,
    (metadata as any).image_uri,
    (metadata as any).properties?.image,
    (metadata as any).properties?.image_url,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

function normalizeResourceUrl(src?: string | null): string | null {
  if (!src) {
    return null;
  }
  let value = src.trim();
  if (!value) {
    return null;
  }
  try {
    value = decodeURIComponent(value);
  } catch {
    // ignore
  }
  if (value.startsWith('ipfs://')) {
    const path = value.slice('ipfs://'.length).replace(/^ipfs\//i, '');
    return `https://ipfs.io/ipfs/${path}`;
  }
  if (value.startsWith('ar://')) {
    return `https://arweave.net/${value.slice('ar://'.length)}`;
  }
  return value;
}

function decodeDid(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function serializeValidationEntry(
  entry: AgentValidationsSummary['pending'][number],
): ValidationEntry {
  const agentIdValue = entry.agentId as unknown;
  let agentId: string | null = null;
  if (typeof agentIdValue === 'bigint') {
    agentId = agentIdValue.toString();
  } else if (typeof agentIdValue === 'string') {
    agentId = agentIdValue;
  } else if (typeof agentIdValue === 'number') {
    agentId = agentIdValue.toString();
  } else if (
    agentIdValue &&
    typeof agentIdValue === 'object' &&
    'toString' in agentIdValue &&
    typeof (agentIdValue as { toString(): unknown }).toString === 'function'
  ) {
    agentId = (agentIdValue as { toString(): string }).toString();
  }

  const responseValue =
    typeof entry.response === 'number'
      ? entry.response
      : Number(entry.response ?? 0);

  const baseEntry: ValidationEntry = {
    agentId,
    requestHash: (entry.requestHash as any) ?? null,
    validatorAddress: (entry.validatorAddress as any) ?? null,
    response: Number.isFinite(responseValue) ? responseValue : 0,
    responseHash: (entry.responseHash as any) ?? null,
    tag: (entry.tag as any) ?? null,
    lastUpdate: normalizeTimestamp(entry.lastUpdate as any),
  };

  return baseEntry;
}

function normalizeTimestamp(
  value: number | bigint | string | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}


