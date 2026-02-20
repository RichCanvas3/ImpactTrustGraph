'use client';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Container, Grid, Card, CardContent, CardMedia, Typography, TextField, Button, Chip, CircularProgress, Pagination, InputAdornment, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { type Address } from 'viem';
import { useRouter } from 'next/navigation';
import { getChainDisplayMetadataSafe, getDeployedAccountClientByAgentName } from '@agentic-trust/core';
import { buildDid8004, requestValidationWithWallet } from '@my-scope/core';
import { sepolia, baseSepolia, optimismSepolia } from 'viem/chains';
import { useWeb3Auth } from '../../components/Web3AuthProvider';
import { useConnection } from '../../components/connection-context';
import { useWallet } from '../../components/WalletProvider';
import { useDefaultOrgAgent } from '../../components/useDefaultOrgAgent';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import ClearIcon from '@mui/icons-material/Clear';
import FeedbackIcon from '@mui/icons-material/Feedback';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { keccak256, toHex } from "viem";
import { sendValidationRequestMessage } from '../../lib/validationActions';

type Agent = {
  agentId: string | number | bigint;
  chainId: number;
  agentAccount?: string;
  agentName?: string;
  ensName?: string;
  name?: string;
  description?: string;
  image?: string;
  agentUrl?: string;
  a2aEndpoint?: string;
  feedbackCount?: number;
  validationCompletedCount?: number;
  validationRequestedCount?: number;
  validationPendingCount?: number;
  feedbackAverageScore?: number;
  createdAtTime?: number;
  [key: string]: unknown;
};

type Filters = {
  chainId: string;
  address: string;
  name: string;
  agentId: string;
  mineOnly: boolean;
  only8004Agents: boolean;
  protocol: string;
  path: string;
  minReviews: string;
  minValidations: string;
  minAvgRating: string;
  createdWithinDays: string;
};

type DiscoverParams = {
  chains?: number[];
  agentAccount?: Address;
  agentName?: string;
  agentId?: string;
  a2a?: boolean;
  mcp?: boolean;
  minFeedbackCount?: number;
  minValidationCompletedCount?: number;
  minFeedbackAverageScore?: number;
  createdWithinDays?: number;
  only8004Agents?: boolean;
};

const DEFAULT_FILTERS: Filters = {
  // Default this app to Sepolia unless the user picks otherwise.
  chainId: String(sepolia.id),
  address: '',
  name: '',
  agentId: '',
  mineOnly: false,
  only8004Agents: false,
  protocol: 'all',
  path: '',
  minReviews: '',
  minValidations: '',
  minAvgRating: '',
  createdWithinDays: '',
};

const PAGE_SIZE = 18;

const OWNER_ABI = [
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const;

const GET_OWNER_ABI = [
  {
    name: 'getOwner',
    type: 'function',
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const;

const OWNERS_ABI = [
  {
    name: 'owners',
    type: 'function',
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
] as const;

export default function AgentsRoute() {
  const { web3auth, isInitializing } = useWeb3Auth();
  const { user } = useConnection();
  const { address: walletAddress, isConnected } = useWallet();
  const { defaultOrgAgent, isLoading: isLoadingAgent } = useDefaultOrgAgent();
  const router = useRouter();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownedMap, setOwnedMap] = useState<Record<string, boolean>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [totalPages, setTotalPages] = useState<number | undefined>(undefined);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [registrationSubmitting, setRegistrationSubmitting] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [feedbackAgent, setFeedbackAgent] = useState<Agent | null>(null);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  // Note: we intentionally avoid on-chain RPC calls from this page (CORS/rate limits).

  const supportedChainIds = [sepolia.id];
  const chainOptions = useMemo(
    () =>
      supportedChainIds.map((chainId: number) => {
        // UI-safe: does not require per-chain RPC env vars.
        const metadata = getChainDisplayMetadataSafe(chainId);
        const label = metadata?.displayName || metadata?.chainName || `Chain ${chainId}`;
        return { id: chainId, label };
      }),
    [supportedChainIds],
  );

  const buildParams = useCallback((source: Filters): DiscoverParams => {
    const params: DiscoverParams = {};
    
    if (source?.chainId && source.chainId !== 'all') {
      const parsed = Number(source.chainId);
      if (!Number.isNaN(parsed)) {
        params.chains = [parsed];
      }
    }
    
    const addressQuery = (source?.address || '').trim();
    if (addressQuery && /^0x[a-fA-F0-9]{40}$/.test(addressQuery)) {
      params.agentAccount = addressQuery as Address;
    }
    
    if ((source?.name || '').trim()) {
      params.agentName = (source.name || '').trim();
    }
    
    if ((source?.agentId || '').trim()) {
      params.agentId = (source.agentId || '').trim();
    }
    
    if (source?.protocol === 'a2a') {
      params.a2a = true;
    } else if (source?.protocol === 'mcp') {
      params.mcp = true;
    }

    const minReviews = Number.parseInt((source?.minReviews || '').trim(), 10);
    if (Number.isFinite(minReviews) && minReviews > 0) {
      params.minFeedbackCount = minReviews;
    }

    const minValidations = Number.parseInt((source?.minValidations || '').trim(), 10);
    if (Number.isFinite(minValidations) && minValidations > 0) {
      params.minValidationCompletedCount = minValidations;
    }

    const minAvgRating = Number.parseFloat((source?.minAvgRating || '').trim());
    if (Number.isFinite(minAvgRating) && minAvgRating > 0) {
      params.minFeedbackAverageScore = minAvgRating;
    }

    const createdWithinDays = Number.parseInt((source?.createdWithinDays || '').trim(), 10);
    if (Number.isFinite(createdWithinDays) && createdWithinDays > 0) {
      params.createdWithinDays = createdWithinDays;
    }

    if (source?.only8004Agents) {
      params.only8004Agents = true;
    }

    return params;
  }, []);

  const searchAgents = useCallback(
    async (sourceFilters: Filters, page: number = 1) => {
      try {
        setLoadingAgents(true);
        setError(null);
        
        // Ensure sourceFilters is never undefined
        const safeFilters = sourceFilters || filters || DEFAULT_FILTERS;
        const params = buildParams(safeFilters);
        
        const pathQuery =
          typeof safeFilters.path === 'string' && safeFilters.path.trim().length > 0
            ? safeFilters.path.trim()
            : undefined;
        
        const payload = {
          page,
          pageSize: PAGE_SIZE,
          // Order by createdAtTime descending so newest agents appear first.
          orderBy: 'createdAtTime',
          orderDirection: 'DESC' as const,
          query: pathQuery,
          params: Object.keys(params).length > 0 ? params : undefined,
        };

        const response = await fetch('/api/agents/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || errorData.error || 'Failed to fetch agents');
        }

        const data = await response.json();
        setAgents((data.agents as Agent[]) ?? []);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setCurrentPage(data.page ?? page);
        setHasLoaded(true);
      } catch (err) {
        console.error('Failed to fetch agents:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch agents');
      } finally {
        setLoadingAgents(false);
      }
    },
    [buildParams, filters],
  );

  // Initial load: only if we haven't loaded yet or if explicitly refreshing.
  // But careful: filters might have changed.
  // For now, we load if (!hasLoaded).
  useEffect(() => {
    if (!hasLoaded) {
      searchAgents(filters, currentPage);
    }
  }, [hasLoaded, searchAgents, filters, currentPage]);

  useEffect(() => {
    // Don't do on-chain ownership checks for cards.
    setOwnedMap({});
  }, [agents]);

  const handleAgentClick = useCallback(
    (agent: Agent) => {
      setSelectedAgent(agent);
    },
    [],
  );

  const handleNavigateToOrganization = useCallback(
    (agent: Agent) => {
      try {
        const agentIdBigInt =
          typeof agent.agentId === 'bigint'
            ? agent.agentId
            : BigInt(typeof agent.agentId === 'string' ? agent.agentId : String(agent.agentId));
        const did = buildDid8004(agent.chainId, agentIdBigInt);
        const encodedDid = encodeURIComponent(did);
        router.push(`/agents/${encodedDid}`);
      } catch (error) {
        console.error('[AgentsPage] Failed to navigate to organization details:', error);
      }
    },
    [router],
  );

  // Helper functions for chain and bundler URL
  const getChainForId = useCallback((chainId: number) => {
    if (chainId === 11155111) return sepolia;
    if (chainId === 84532) return baseSepolia;
    if (chainId === 11155420) return optimismSepolia;
    return sepolia; // Default
  }, []);

  const getBundlerUrlForId = useCallback((chainId: number) => {
    if (chainId === 11155111) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA;
    if (chainId === 84532) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA;
    if (chainId === 11155420) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA;
    return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA; // Default
  }, []);

  // When user manually changes filters or page in UI, we call searchAgents.
  // We need to update the state when that happens.
  const handleSearch = useCallback((filtersOverride?: Filters) => {
    const filtersToUse = filtersOverride ?? filters;
    if (filtersOverride) {
      setFilters(filtersToUse);
    }
    setCurrentPage(1); // Reset to page 1 on new filter
    searchAgents(filtersToUse, 1);
  }, [filters, setFilters, setCurrentPage, searchAgents]);

  const handlePageChange = useCallback((_event: React.ChangeEvent<unknown>, page: number) => {
    setCurrentPage(page);
    searchAgents(filters, page);
  }, [filters, setCurrentPage, searchAgents]);

  const handleFilterChange = useCallback(<K extends keyof Filters>(
    key: K,
    value: Filters[K],
  ) => {
    setFilters({ ...filters, [key]: value });
  }, [filters, setFilters]);

  const handleClear = useCallback(() => {
    const defaultFilters: Filters = {
      chainId: String(sepolia.id),
      address: '',
      name: '',
      agentId: '',
      mineOnly: false,
      only8004Agents: false,
      protocol: 'all',
      path: '',
      minReviews: '',
      minValidations: '',
      minAvgRating: '',
      createdWithinDays: '',
    };
    setFilters(defaultFilters);
    setCurrentPage(1);
    searchAgents(defaultFilters, 1);
  }, [setFilters, setCurrentPage, searchAgents]);

  return (
    <Container
      maxWidth="xl"
      sx={{
        py: { xs: 3, md: 4 },
      }}
    >
        <Box sx={{ mb: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            Organization's
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            Impact 
          </Typography>

          {/* Primary search parameters: chain, agent name, agent ID */}
          <Box sx={{ mb: 3 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={3}>
                <TextField
                  label="Chain"
                  select
                  fullWidth
                  size="small"
                  SelectProps={{ native: true }}
                  value={filters.chainId}
                  onChange={(e) => handleFilterChange('chainId', e.target.value)}
                >
                  {chainOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  label="Agent Name"
                  placeholder="agent-name"
                  fullWidth
                  size="small"
                  value={filters.name}
                  onChange={(e) => handleFilterChange('name', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  label="Agent ID"
                  placeholder="123"
                  fullWidth
                  size="small"
                  value={filters.agentId}
                  onChange={(e) => handleFilterChange('agentId', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: { xs: 'flex-start', md: 'flex-end' },
                    gap: 1,
                    mt: { xs: 1, md: 0 },
                  }}
                >
                  <Button
                    variant="outlined"
                    startIcon={<ClearIcon />}
                    onClick={handleClear}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => handleSearch()}
                    disabled={loadingAgents}
                  >
                    Search
                  </Button>
                </Box>
              </Grid>
            </Grid>
          </Box>

          {/* Row with total count + 8004 filter on left, advanced-filters toggle on right */}
          <Box
            sx={{
              mb: 2,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {typeof total === 'number' && (
                <Typography variant="body2" color="text.secondary">
                  {total} agents
                </Typography>
              )}
              <Chip
                label="8004-agent.eth filter"
                size="small"
                color={filters.only8004Agents ? 'primary' : 'default'}
                variant={filters.only8004Agents ? 'filled' : 'outlined'}
                icon={
                  filters.only8004Agents ? (
                    <CheckCircleOutlineIcon
                      fontSize="small"
                      sx={{ color: 'success.main', ml: '2px' }}
                    />
                  ) : undefined
                }
                onClick={() => {
                  const nextEnabled = !filters.only8004Agents;
                  const nextFilters: Filters = {
                    ...filters,
                    only8004Agents: nextEnabled,
                    name: nextEnabled ? '8004-agent' : '',
                  };
                  // Use the same helper so toggle immediately triggers a search
                  handleSearch(nextFilters);
                }}
              />
            </Box>

            <Button
              variant="text"
              size="small"
              startIcon={<FilterListIcon />}
              onClick={() => setShowFilters((prev) => !prev)}
            >
              {showFilters ? 'Hide advanced filters' : 'Show advanced filters'}
            </Button>
          </Box>

          {/* Advanced filters: path, address, protocol and stats */}
          {showFilters && (
            <Box
              sx={{
                mb: 3,
                p: 2,
                bgcolor: 'background.paper',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField
                    label="Path / ENS / keyword"
                    placeholder="e.g. gmail-itg.8004-agent.eth"
                    fullWidth
                    size="small"
                    value={filters.path}
                    onChange={(e) => handleFilterChange('path', e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField
                    label="Agent Address"
                    placeholder="0x..."
                    fullWidth
                    size="small"
                    value={filters.address}
                    onChange={(e) => handleFilterChange('address', e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                  <TextField
                    label="Protocol"
                    select
                    fullWidth
                    size="small"
                    SelectProps={{ native: true }}
                    value={filters.protocol}
                    onChange={(e) => handleFilterChange('protocol', e.target.value)}
                  >
                    <option value="all">All Protocols</option>
                    <option value="a2a">A2A</option>
                    <option value="mcp">MCP</option>
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    label="Min Reviews"
                    placeholder="0"
                    fullWidth
                    size="small"
                    value={filters.minReviews}
                    onChange={(e) => handleFilterChange('minReviews', e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    label="Min Validations"
                    placeholder="0"
                    fullWidth
                    size="small"
                    value={filters.minValidations}
                    onChange={(e) => handleFilterChange('minValidations', e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    label="Min Avg Rating"
                    placeholder="0.0"
                    fullWidth
                    size="small"
                    value={filters.minAvgRating}
                    onChange={(e) => handleFilterChange('minAvgRating', e.target.value)}
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <TextField
                    label="Created within (days)"
                    placeholder="e.g. 30"
                    fullWidth
                    size="small"
                    value={filters.createdWithinDays}
                    onChange={(e) => handleFilterChange('createdWithinDays', e.target.value)}
                  />
                </Grid>
              </Grid>
            </Box>
          )}
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loadingAgents ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : agents.length === 0 ? (
          <Alert severity="info">
            No agents found. Try adjusting your search criteria.
          </Alert>
        ) : (
          <>
            <Grid container spacing={3} sx={{ mb: 4 }}>
              {agents.map((agent) => {
                const ownershipKey = `${agent.chainId}:${agent.agentId}`;
                const isOwned = ownedMap[ownershipKey] || false;
                const agentName = agent.ensName || agent.agentName || agent.name || 'Unnamed Agent';
                const agentIdStr = typeof agent.agentId === 'bigint' ? agent.agentId.toString() : String(agent.agentId);

                return (
                  <Grid item xs={12} sm={6} md={4} key={`${agent.chainId}-${agentIdStr}`}>
                    <Card
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        transition: 'transform 0.2s, box-shadow 0.2s',
                        cursor: 'pointer',
                        '&:hover': {
                          transform: 'translateY(-4px)',
                          boxShadow: 4,
                        },
                      }}
                      onClick={() => handleNavigateToOrganization(agent)}
                    >
                      <CardContent sx={{ flex: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                          <Box
                            component="img"
                            src={agent.image || '/8004ShadowAgent.png'}
                            alt={agentName}
                            sx={{
                              width: 60,
                              height: 60,
                              maxHeight: '60px',
                              maxWidth: '60px',
                              objectFit: 'cover',
                              borderRadius: 1,
                              backgroundColor: 'grey.200',
                              flexShrink: 0,
                            }}
                          />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                              variant="h6"
                              component="h3"
                              noWrap
                              sx={{ cursor: 'pointer' }}
                              onClick={() => handleNavigateToOrganization(agent)}
                            >
                              {agentName}
                            </Typography>
                          </Box>
                          {isOwned && (
                            <Chip label="Owned" color="primary" size="small" sx={{ flexShrink: 0 }} />
                          )}
                        </Box>
                        {agent.description && (
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {agent.description}
                          </Typography>
                        )}
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                          <Chip label={`Chain ${agent.chainId}`} size="small" variant="outlined" />
                          <Chip label={`ID: ${agentIdStr}`} size="small" variant="outlined" />
                          {agent.feedbackCount !== undefined && (
                            <Chip label={`${agent.feedbackCount} reviews`} size="small" variant="outlined" />
                          )}
                          {agent.validationCompletedCount !== undefined && (
                            <Chip label={`${agent.validationCompletedCount} validations`} size="small" variant="outlined" />
                          )}
                          {agent.validationPendingCount !== undefined && agent.validationPendingCount > 0 && (
                            <Chip label={`${agent.validationPendingCount} pending`} size="small" variant="outlined" color="warning" />
                          )}
                          {agent.validationRequestedCount !== undefined && agent.validationRequestedCount > 0 && (
                            <Chip label={`${agent.validationRequestedCount} requests`} size="small" variant="outlined" />
                          )}
                          {agent.feedbackAverageScore != null && typeof agent.feedbackAverageScore === 'number' && (
                            <Chip label={`Rating: ${agent.feedbackAverageScore.toFixed(1)}`} size="small" variant="outlined" />
                          )}
                        </Box>
                        {agent.agentAccount && (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            {agent.agentAccount}
                          </Typography>
                        )}
                      </CardContent>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>

            {totalPages && totalPages > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                <Pagination
                  count={totalPages}
                  page={currentPage}
                  onChange={handlePageChange}
                  color="primary"
                  size="large"
                />
              </Box>
            )}

            {total !== undefined && (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 2 }}>
                Showing {agents.length} of {total} agents
              </Typography>
            )}
          </>
        )}

        {/* Agent Details Modal */}
        <Dialog
          open={selectedAgent !== null}
          onClose={() => !registrationSubmitting && setSelectedAgent(null)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            {selectedAgent ? (selectedAgent.ensName || selectedAgent.agentName || selectedAgent.name || 'Agent Details') : ''}
          </DialogTitle>
          <DialogContent>
            {selectedAgent && (
              <Box>
                <Box component="dl" sx={{ m: 0, mb: 3 }}>
                  {selectedAgent.description && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body1" sx={{ mb: 1 }}>
                        {selectedAgent.description}
                      </Typography>
                    </Box>
                  )}
                  
                  <Box sx={{ mb: 1 }}>
                    <Typography component="dt" variant="body2" fontWeight={600} color="text.secondary">
                      Agent ID:
                    </Typography>
                    <Typography component="dd" variant="body1" sx={{ ml: 2 }}>
                      {typeof selectedAgent.agentId === 'bigint' ? selectedAgent.agentId.toString() : String(selectedAgent.agentId)}
                    </Typography>
                  </Box>

                  <Box sx={{ mb: 1 }}>
                    <Typography component="dt" variant="body2" fontWeight={600} color="text.secondary">
                      Chain ID:
                    </Typography>
                    <Typography component="dd" variant="body1" sx={{ ml: 2 }}>
                      {selectedAgent.chainId}
                    </Typography>
                  </Box>

                  {selectedAgent.agentAccount && (
                    <Box sx={{ mb: 1 }}>
                      <Typography component="dt" variant="body2" fontWeight={600} color="text.secondary">
                        Agent Account:
                      </Typography>
                      <Typography component="dd" variant="body1" sx={{ ml: 2, fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                        {selectedAgent.agentAccount}
                      </Typography>
                    </Box>
                  )}

                  {selectedAgent.ensName && (
                    <Box sx={{ mb: 1 }}>
                      <Typography component="dt" variant="body2" fontWeight={600} color="text.secondary">
                        ENS Name:
                      </Typography>
                      <Typography component="dd" variant="body1" sx={{ ml: 2 }}>
                        {selectedAgent.ensName}
                      </Typography>
                    </Box>
                  )}

                  {selectedAgent.agentUrl && (
                    <Box sx={{ mb: 1 }}>
                      <Typography component="dt" variant="body2" fontWeight={600} color="text.secondary">
                        Agent URL:
                      </Typography>
                      <Typography component="dd" variant="body1" sx={{ ml: 2 }}>
                        <a href={selectedAgent.agentUrl} target="_blank" rel="noopener noreferrer">
                          {selectedAgent.agentUrl}
                        </a>
                      </Typography>
                    </Box>
                  )}

                  {selectedAgent.feedbackCount !== undefined && (
                    <Box sx={{ mb: 1 }}>
                      <Typography component="dt" variant="body2" fontWeight={600} color="text.secondary">
                        Reviews:
                      </Typography>
                      <Typography component="dd" variant="body1" sx={{ ml: 2 }}>
                        {selectedAgent.feedbackCount}
                      </Typography>
                    </Box>
                  )}

                  {selectedAgent.validationCompletedCount !== undefined && (
                    <Box sx={{ mb: 1 }}>
                      <Typography component="dt" variant="body2" fontWeight={600} color="text.secondary">
                        Validations:
                      </Typography>
                      <Typography component="dd" variant="body1" sx={{ ml: 2 }}>
                        {selectedAgent.validationCompletedCount}
                      </Typography>
                    </Box>
                  )}

                  {selectedAgent.feedbackAverageScore != null && typeof selectedAgent.feedbackAverageScore === 'number' && (
                    <Box sx={{ mb: 1 }}>
                      <Typography component="dt" variant="body2" fontWeight={600} color="text.secondary">
                        Average Rating:
                      </Typography>
                      <Typography component="dd" variant="body1" sx={{ ml: 2 }}>
                        {selectedAgent.feedbackAverageScore.toFixed(1)} / 5.0
                      </Typography>
                    </Box>
                  )}
                </Box>

                {registrationError && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {registrationError}
                  </Alert>
                )}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                if (!registrationSubmitting) {
                  setSelectedAgent(null);
                  setRegistrationError(null);
                }
              }}
              disabled={registrationSubmitting}
            >
              Close
            </Button>
            <Button
              onClick={async () => {
                if (registrationSubmitting || !selectedAgent) return;

                try {
                  setRegistrationError(null);
                  setRegistrationSubmitting(true);

                  if (!selectedAgent.chainId || !selectedAgent.agentId || !selectedAgent.agentAccount) {
                    throw new Error('Agent chainId, agentId, and agentAccount are required');
                  }

                  const chainId = typeof selectedAgent.chainId === 'number' 
                    ? selectedAgent.chainId 
                    : Number.parseInt(String(selectedAgent.chainId), 10);
                  
                  if (!Number.isFinite(chainId)) {
                    throw new Error('Invalid chainId');
                  }

                  const chain = getChainForId(chainId);
                  const bundlerUrl = getBundlerUrlForId(chainId);

                  if (!bundlerUrl) {
                    throw new Error(`Bundler URL not configured for chain ${chainId}`);
                  }

                  if (!web3auth?.provider) {
                    throw new Error('Connect your wallet to register with coalition');
                  }

                  // Check if user has a default org agent
                  if (!defaultOrgAgent) {
                    throw new Error('No default organization agent found. Please create an organization agent first.');
                  }

                  if (!defaultOrgAgent.agentAccount) {
                    throw new Error('Default organization agent account not found.');
                  }

                  // Get wallet address (EOA) for the account client
                  let eoaAddress = walletAddress;
                  if (!eoaAddress) {
                    try {
                      const { getWalletAddress } = await import('@agentic-trust/core/client');
                      eoaAddress = await getWalletAddress(web3auth.provider);
                    } catch (err) {
                      console.warn('[agents/page] Failed to get wallet address:', err);
                    }
                  }

                  if (!eoaAddress) {
                    throw new Error('Could not determine wallet address. Please connect your wallet.');
                  }

                  // Use the default org agent's name for the account client
                  const defaultAgentId = defaultOrgAgent.agentId;
                  if (!defaultAgentId) {
                    throw new Error('Default organization agent ID is required');
                  }
                  const defaultAgentName = defaultOrgAgent.agentName || defaultOrgAgent.ensName || '';
                  if (!defaultAgentName) {
                    throw new Error('Default organization agent name is required');
                  }

                  // Get account client using the default org agent's name
                  // This creates an account client for the user's default org agent
                  const agentAccountClient = await getDeployedAccountClientByAgentName(
                    bundlerUrl,
                    defaultAgentName,
                    eoaAddress as `0x${string}`,
                    {
                      chain: chain as any,
                      ethereumProvider: web3auth.provider as any,
                    }
                  );

                  console.log('[Coalition Registration] Agent Account Client keys:', Object.keys(agentAccountClient));
                  console.log('[Coalition Registration] Has sendTransaction:', typeof agentAccountClient.sendTransaction);
                  console.log('[Coalition Registration] Has sendUserOperation:', typeof agentAccountClient.sendUserOperation);

                  // Build did8004 for the validation request using the selected agent
                  const queryAgentId = typeof selectedAgent.agentId === 'bigint' 
                    ? Number(selectedAgent.agentId) 
                    : typeof selectedAgent.agentId === 'string'
                    ? Number.parseInt(selectedAgent.agentId, 10)
                    : Number(selectedAgent.agentId);
                  
                  // Convert defaultAgentId to BigInt for buildDid8004
                  const defaultAgentIdBigInt = typeof defaultAgentId === 'bigint'
                    ? defaultAgentId
                    : typeof defaultAgentId === 'string'
                    ? BigInt(defaultAgentId)
                    : BigInt(defaultAgentId);
                  
                  const defaultAgentDid8004 = buildDid8004(chainId, defaultAgentIdBigInt);

                  const requestJson = {
                    agentId: queryAgentId,
                    validatorAddress: selectedAgent.agentAccount as `0x${string}`,
                    checks: ["Coalition Membership"]
                  };
                  const requestHash = keccak256(toHex(JSON.stringify(requestJson)));
                  
                  // Upload requestJson to IPFS
                  console.log('[Coalition Registration] Uploading validation request to IPFS...');
                  const jsonBlob = new Blob([JSON.stringify(requestJson, null, 2)], { type: 'application/json' });
                  const formData = new FormData();
                  formData.append('file', jsonBlob, 'validation-request.json');
                  
                  const ipfsResponse = await fetch('/api/ipfs/upload', {
                    method: 'POST',
                    body: formData,
                  });
                  
                  if (!ipfsResponse.ok) {
                    throw new Error('Failed to upload validation request to IPFS');
                  }
                  
                  const ipfsResult = await ipfsResponse.json();
                  const requestUri = ipfsResult.url || ipfsResult.tokenUri || `ipfs://${ipfsResult.cid}`;
                  
                  console.log('[Coalition Registration] IPFS upload result:', { cid: ipfsResult.cid, url: requestUri });

                  // Submit validation request using the selected agent's account address
                  const result = await requestValidationWithWallet({
                    agentDid: defaultAgentDid8004,
                    requesterAccountClient: agentAccountClient,
                    validatorAddress: selectedAgent.agentAccount as `0x${string}`,
                    chain: chain as any,
                    requestUri,
                    requestHash,
                    onStatusUpdate: (msg: string) => console.log('[Coalition Registration]', msg),
                  });

                  console.info('[Coalition Registration] Success:', result);

                  // Send message to validator agent about the validation request
                  // This message will appear in the validator's inbox
                  try {
                    const selectedAgentDid = buildDid8004(chainId, BigInt(queryAgentId));
                    const selectedAgentName = selectedAgent.ensName || selectedAgent.agentName || selectedAgent.name || undefined;

                    console.info('[Coalition Registration] Sending validation request message to validator agent inbox...');
                    
                    await sendValidationRequestMessage({
                      fromAgentDid: defaultAgentDid8004,
                      fromAgentName: defaultAgentName,
                      toAgentDid: selectedAgentDid,
                      toAgentName: selectedAgentName,
                      requestHash: result.requestHash || requestHash,
                      subject: 'Validation Request',
                      body: `A validation request has been submitted for your review.\n\nRequest Hash: ${result.requestHash || requestHash}\nRequester Agent: ${defaultAgentName}\nRequester DID: ${defaultAgentDid8004}`,
                    });

                    console.info('[Coalition Registration] Validation request message sent to validator agent inbox');
                  } catch (messageError) {
                    console.error('[Coalition Registration] Failed to send validation request message:', messageError);
                    // Log error but don't fail the whole operation if message sending fails
                  }

                  alert(`Registration request submitted successfully! Transaction: ${result.txHash}, Validator: ${result.validatorAddress}`);
                  
                  setSelectedAgent(null);
                } catch (err) {
                  console.error('Failed to register with coalition organization:', err);
                  
                  // Check if the error is about an existing validation
                  const errorMessage = err instanceof Error ? err.message : String(err);
                  let userFriendlyMessage = 'Failed to register with coalition organization';
                  
                  if (errorMessage.includes('exists') || 
                      errorMessage.includes('0x08c379a0') ||
                      errorMessage.includes('657869737473')) {
                    userFriendlyMessage = 'A validation request for this agent already exists. You may have already registered with this coalition organization.';
                  } else if (errorMessage.includes('reverted')) {
                    userFriendlyMessage = 'The validation request was rejected. This may be because a validation already exists or the request is invalid.';
                  } else {
                    userFriendlyMessage = errorMessage;
                  }
                  
                  setRegistrationError(userFriendlyMessage);
                } finally {
                  setRegistrationSubmitting(false);
                }
              }}
              disabled={registrationSubmitting || !selectedAgent || !selectedAgent.agentAccount || !defaultOrgAgent}
              variant="contained"
            >
              {registrationSubmitting ? 'Registering...' : 'Register with Organization'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Feedback Request Modal */}
        <Dialog
          open={feedbackAgent !== null}
          onClose={() => !feedbackSubmitting && setFeedbackAgent(null)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            Request Feedback Authorization
          </DialogTitle>
          <DialogContent>
            {feedbackAgent && (
              <Box sx={{ mt: 2 }}>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Agent Name:
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {feedbackAgent.ensName || feedbackAgent.agentName || feedbackAgent.name || 'Unnamed Agent'}
                  </Typography>
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Agent ID:
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {typeof feedbackAgent.agentId === 'bigint' ? feedbackAgent.agentId.toString() : String(feedbackAgent.agentId)}
                  </Typography>
                </Box>
                <TextField
                  label="Comment"
                  placeholder="Why do you want to give feedback to this agent?"
                  multiline
                  rows={4}
                  fullWidth
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                  disabled={feedbackSubmitting}
                  sx={{ mt: 2 }}
                />
                {feedbackError && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    {feedbackError}
                  </Alert>
                )}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                if (!feedbackSubmitting) {
                  setFeedbackAgent(null);
                  setFeedbackComment('');
                  setFeedbackError(null);
                }
              }}
              disabled={feedbackSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (feedbackSubmitting || !feedbackAgent) return;

                try {
                  setFeedbackError(null);
                  setFeedbackSubmitting(true);

                  if (!feedbackComment.trim()) {
                    throw new Error('Please enter a comment explaining why you want to give feedback');
                  }

                  if (!walletAddress) {
                    throw new Error('Please connect your wallet to request feedback authorization');
                  }

                const targetAgentId = typeof feedbackAgent.agentId === 'bigint' 
                  ? feedbackAgent.agentId.toString() 
                  : String(feedbackAgent.agentId);
                const targetChainId = feedbackAgent.chainId;
                const targetAgentDid =
                  typeof targetChainId === 'number'
                    ? buildDid8004(targetChainId, BigInt(targetAgentId))
                    : undefined;

                  // Send A2A message to agents-admin.8004-agent.io
                  const a2aEndpoint = 'https://agents-admin.8004-agent.io/api/a2a';
                  
                  console.log('[Feedback Request] Sending A2A message to:', a2aEndpoint);
                  console.log('[Feedback Request] Payload:', {
                    clientAddress: walletAddress,
                    targetAgentId,
                    targetAgentDid,
                    targetChainId,
                    comment: feedbackComment.trim(),
                  });

                  const response = await fetch(a2aEndpoint, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      skillId: 'agent.feedback.request',
                      payload: {
                        clientAddress: walletAddress,
                        targetAgentId,
                        targetAgentDid,
                        targetAgentName: feedbackAgent.ensName || feedbackAgent.agentName || feedbackAgent.name,
                        comment: feedbackComment.trim(),
                      },
                    }),
                  });

                  if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || errorData.message || `Request failed with status ${response.status}`);
                  }

                  const result = await response.json();
                  console.log('[Feedback Request] Response:', result);

                  if (!result.success) {
                    throw new Error(result.error || result.response?.error || 'Failed to submit feedback request');
                  }

                  alert('Feedback request submitted successfully! Your request has been recorded.');
                  
                  setFeedbackAgent(null);
                  setFeedbackComment('');
                } catch (err) {
                  console.error('Failed to submit feedback request:', err);
                  setFeedbackError(err instanceof Error ? err.message : 'Failed to submit feedback request');
                } finally {
                  setFeedbackSubmitting(false);
                }
              }}
              disabled={feedbackSubmitting || !feedbackComment.trim() || !walletAddress}
              variant="contained"
            >
              {feedbackSubmitting ? 'Submitting...' : 'Request Feedback Authorization'}
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
  );
}

