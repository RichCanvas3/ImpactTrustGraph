"use client";

import * as React from 'react';
import { Box, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Alert, Typography } from '@mui/material';
import { buildDid8004 } from '@my-scope/core';
import { useWeb3Auth } from './Web3AuthProvider';
import { useWallet } from './WalletProvider';
import { GiveFeedbackDialog, type GiveFeedbackDialogConfig } from './GiveFeedbackDialog';
import { resolveClientAddress } from '../lib/feedbackActions';

interface OrganizationFeedbackControlsProps {
  agentId: string;
  chainId: number;
  agentName?: string | null;
  agentA2aEndpoint?: string | null;
}

export function OrganizationFeedbackControls({
  agentId,
  chainId,
  agentName,
  agentA2aEndpoint,
}: OrganizationFeedbackControlsProps) {
  const { web3auth } = useWeb3Auth();
  const { address: walletAddress } = useWallet();

  const [loadingAuth, setLoadingAuth] = React.useState<boolean>(false);
  const [feedbackAuth, setFeedbackAuth] = React.useState<any | null>(null);
  const [authError, setAuthError] = React.useState<string | null>(null);

  const [feedbackDialogConfig, setFeedbackDialogConfig] =
    React.useState<GiveFeedbackDialogConfig | null>(null);

  const [requestDialogOpen, setRequestDialogOpen] = React.useState(false);
  const [requestComment, setRequestComment] = React.useState('');
  const [requestSubmitting, setRequestSubmitting] = React.useState(false);
  const [requestError, setRequestError] = React.useState<string | null>(null);

  // On mount, attempt to resolve existing feedback authorization for this agent
  React.useEffect(() => {
    let cancelled = false;

    async function loadFeedbackAuth() {
      setLoadingAuth(true);
      setAuthError(null);
      try {
        const clientAddress = await resolveClientAddress({
          walletAddress,
          web3Provider: web3auth?.provider ?? null,
        });

        const params = new URLSearchParams();
        params.set('clientAddress', clientAddress);
        params.set('agentId', agentId);
        params.set('chainId', String(chainId));

        const resp = await fetch(`/api/feedback-auth?${params.toString()}`, {
          method: 'GET',
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          if (!cancelled) {
            setFeedbackAuth(null);
            setAuthError(data.error || data.message || 'No existing feedback authorization.');
          }
          return;
        }

        const data = await resp.json();
        const feedbackAuthId =
          data.feedbackAuthId || data.response?.feedbackAuth;

        if (!cancelled) {
          if (feedbackAuthId) {
            setFeedbackAuth(feedbackAuthId);
            setAuthError(null);
          } else {
            setFeedbackAuth(null);
            setAuthError('No feedback authorization returned by provider.');
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[OrganizationFeedbackControls] Failed to load feedback auth:', err);
          setFeedbackAuth(null);
          setAuthError(
            err instanceof Error ? err.message : 'Failed to load feedback authorization.',
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingAuth(false);
        }
      }
    }

    // Only attempt if we have some way to resolve client address
    loadFeedbackAuth();

    return () => {
      cancelled = true;
    };
  }, [agentId, chainId, walletAddress, web3auth?.provider]);

  const handleOpenGiveFeedback = React.useCallback(() => {
    setFeedbackDialogConfig({
      agentName: agentName || undefined,
      agentDisplayName: agentName || undefined,
      agentId,
      agentChainId: chainId,
      agentA2aEndpoint: agentA2aEndpoint || undefined,
      preExistingFeedbackAuth: feedbackAuth || undefined,
      preExistingFeedbackAgentId: agentId,
      preExistingFeedbackChainId: chainId,
      preExistingFeedbackRequestId: null,
    });
  }, [agentName, agentId, chainId, agentA2aEndpoint, feedbackAuth]);

  const handleCloseGiveFeedback = React.useCallback(() => {
    setFeedbackDialogConfig(null);
  }, []);

  const handleRequestFeedbackAuth = React.useCallback(() => {
    setRequestComment('');
    setRequestError(null);
    setRequestDialogOpen(true);
  }, []);

  const handleSubmitFeedbackRequest = React.useCallback(async () => {
    if (requestSubmitting) return;
    try {
      setRequestError(null);
      setRequestSubmitting(true);

      if (!requestComment.trim()) {
        throw new Error('Please enter a comment explaining why you want to give feedback');
      }

      const clientAddress = await resolveClientAddress({
        walletAddress,
        web3Provider: web3auth?.provider ?? null,
      });

      const targetAgentId = agentId;
      const targetChainId = chainId;
      const targetAgentDid = buildDid8004(targetChainId, BigInt(targetAgentId));

      const a2aEndpoint = 'https://agents-admin.8004-agent.io/api/a2a';

      console.log('[Organization Feedback Request] Sending A2A message to:', a2aEndpoint);
      console.log('[Organization Feedback Request] Payload:', {
        clientAddress,
        targetAgentId,
        targetAgentDid,
        targetChainId,
        comment: requestComment.trim(),
      });

      const response = await fetch(a2aEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          skillId: 'agent.feedback.request',
          payload: {
            clientAddress,
            targetAgentId,
            targetAgentDid,
            targetAgentName: agentName,
            comment: requestComment.trim(),
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error ||
            errorData.message ||
            `Request failed with status ${response.status}`,
        );
      }

      const result = await response.json();
      console.log('[Organization Feedback Request] Response:', result);

      if (!result.success) {
        throw new Error(
          result.error || result.response?.error || 'Failed to submit feedback request',
        );
      }

      alert('Feedback request submitted successfully! Your request has been recorded.');

      setRequestDialogOpen(false);
      setRequestComment('');
    } catch (err) {
      console.error('[Organization Feedback Request] Failed to submit feedback request:', err);
      setRequestError(
        err instanceof Error ? err.message : 'Failed to submit feedback request',
      );
    } finally {
      setRequestSubmitting(false);
    }
  }, [agentId, agentName, chainId, requestComment, requestSubmitting, walletAddress, web3auth?.provider]);

  const hasAuth = !!feedbackAuth;

  return (
    <>
      <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <Button
          variant="contained"
          disabled={!hasAuth || loadingAuth}
          onClick={handleOpenGiveFeedback}
        >
          Give Feedback
        </Button>
        {!hasAuth && (
          <Button
            variant="outlined"
            disabled={loadingAuth}
            onClick={handleRequestFeedbackAuth}
          >
            Request Agent Feedback Auth
          </Button>
        )}
        {loadingAuth && (
          <Typography variant="body2" color="text.secondary">
            Checking feedback authorization…
          </Typography>
        )}
        {!loadingAuth && authError && !hasAuth && (
          <Typography variant="body2" color="text.secondary">
            {authError}
          </Typography>
        )}
      </Box>

      {/* Request Feedback Authorization Modal */}
      <Dialog
        open={requestDialogOpen}
        onClose={() => !requestSubmitting && setRequestDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Request Feedback Authorization</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Agent Name:
            </Typography>
            <Typography variant="body1" fontWeight={600}>
              {agentName || 'Unnamed Agent'}
            </Typography>
            <TextField
              label="Comment"
              placeholder="Why do you want to give feedback to this agent?"
              multiline
              rows={4}
              fullWidth
              value={requestComment}
              onChange={(e) => setRequestComment(e.target.value)}
              disabled={requestSubmitting}
              sx={{ mt: 2 }}
            />
            {requestError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {requestError}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (!requestSubmitting) {
                setRequestDialogOpen(false);
                setRequestComment('');
                setRequestError(null);
              }
            }}
            disabled={requestSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmitFeedbackRequest}
            disabled={requestSubmitting || !requestComment.trim()}
            variant="contained"
          >
            {requestSubmitting ? 'Submitting...' : 'Request Feedback Authorization'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Give Feedback Dialog */}
      <GiveFeedbackDialog
        open={!!feedbackDialogConfig}
        onClose={handleCloseGiveFeedback}
        onSubmitted={() => {
          handleCloseGiveFeedback();
        }}
        onError={(message) => {
          console.error('[OrganizationFeedbackControls] Give feedback error:', message);
        }}
        {...(feedbackDialogConfig || {})}
      />
    </>
  );
}


