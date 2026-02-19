"use client";

import * as React from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  CircularProgress,
} from '@mui/material';
import Rating from '@mui/material/Rating';
import { useWeb3Auth } from './Web3AuthProvider';
import { useWallet } from './WalletProvider';
import {
  normalizeA2aEndpoint,
  submitFeedbackAction,
  type SubmitFeedbackResult,
} from '../lib/feedbackActions';

export interface GiveFeedbackDialogConfig {
  agentName?: string | null;
  agentDisplayName?: string | null;
  agentId?: string | number | bigint | null;
  agentChainId?: number | null;
  agentA2aEndpoint?: string | null;
  preExistingFeedbackAuth?: any;
  preExistingFeedbackAgentId?: string | number | bigint | null;
  preExistingFeedbackChainId?: number | null;
  preExistingFeedbackRequestId?: number | string | null;
  markFeedbackGivenEndpoint?: string;
}

export interface GiveFeedbackDialogProps extends GiveFeedbackDialogConfig {
  open: boolean;
  onClose: () => void;
  onSubmitted?: (result: SubmitFeedbackResult) => void;
  onError?: (message: string) => void;
}

export function GiveFeedbackDialog({
  open,
  onClose,
  onSubmitted,
  onError,
  agentName,
  agentDisplayName,
  agentId,
  agentChainId,
  agentA2aEndpoint,
  preExistingFeedbackAuth,
  preExistingFeedbackAgentId,
  preExistingFeedbackChainId,
  preExistingFeedbackRequestId,
  markFeedbackGivenEndpoint,
}: GiveFeedbackDialogProps) {
  const { web3auth } = useWeb3Auth();
  const { address: walletAddress } = useWallet();

  const [feedbackRating, setFeedbackRating] = React.useState<number>(5);
  const [feedbackComment, setFeedbackComment] = React.useState('');
  const [feedbackTag1, setFeedbackTag1] = React.useState('');
  const [feedbackTag2, setFeedbackTag2] = React.useState('');
  const [feedbackSkillId, setFeedbackSkillId] = React.useState('');
  const [feedbackContext, setFeedbackContext] = React.useState('');
  const [feedbackCapability, setFeedbackCapability] = React.useState('');
  const [feedbackSuccess, setFeedbackSuccess] = React.useState(false);
  const [agentCard, setAgentCard] = React.useState<any | null>(null);
  const [resolvedA2aEndpoint, setResolvedA2aEndpoint] = React.useState<string | null>(null);
  const [submittingFeedback, setSubmittingFeedback] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loadingAgentCard, setLoadingAgentCard] = React.useState(false);

  const displayName = agentName || agentDisplayName || 'Unknown agent';

  const resetForm = React.useCallback(() => {
    setFeedbackRating(5);
    setFeedbackComment('');
    setFeedbackTag1('');
    setFeedbackTag2('');
    setFeedbackSkillId('');
    setFeedbackContext('');
    setFeedbackCapability('');
    setFeedbackSuccess(false);
    setError(null);
  }, []);

  React.useEffect(() => {
    if (open) {
      resetForm();
      const normalized = normalizeA2aEndpoint(agentA2aEndpoint);
      setResolvedA2aEndpoint(normalized);
    } else {
      setAgentCard(null);
      setResolvedA2aEndpoint(null);
      setLoadingAgentCard(false);
    }
  }, [open, agentA2aEndpoint, resetForm]);

  React.useEffect(() => {
    if (!open || !resolvedA2aEndpoint) {
      return;
    }

    const endpoint = resolvedA2aEndpoint;
    let cancelled = false;
    async function loadAgentCard() {
      setLoadingAgentCard(true);
      try {
        const cardUrl = endpoint.replace('/api/a2a', '/.well-known/agent-card.json');
        const res = await fetch(cardUrl, { method: 'GET' });
        if (!cancelled && res.ok) {
          const cardData = await res.json();
          setAgentCard(cardData);
          if (cardData?.skills?.length && !feedbackSkillId) {
            setFeedbackSkillId(cardData.skills[0].id);
          }
        }
      } catch (cardError) {
        if (!cancelled) {
          console.warn('[GiveFeedbackDialog] Failed to load agent card:', cardError);
        }
      } finally {
        if (!cancelled) {
          setLoadingAgentCard(false);
        }
      }
    }

    loadAgentCard();
    return () => {
      cancelled = true;
    };
  }, [open, resolvedA2aEndpoint, feedbackSkillId]);

  const handleSubmit = React.useCallback(async () => {
    setSubmittingFeedback(true);
    setFeedbackSuccess(false);
    setError(null);

    try {
      const result = await submitFeedbackAction({
        walletAddress,
        web3Provider: web3auth?.provider ?? null,
        rating: feedbackRating,
        comment: feedbackComment,
        agentName: agentName || agentDisplayName || undefined,
        fallbackAgentId: agentId ?? null,
        fallbackChainId: agentChainId ?? null,
        preExistingFeedbackAuth,
        preExistingFeedbackAgentId,
        preExistingFeedbackChainId,
        preExistingFeedbackRequestId,
        tag1: feedbackTag1,
        tag2: feedbackTag2,
        skillId: feedbackSkillId,
        context: feedbackContext,
        capability: feedbackCapability,
        markFeedbackGivenEndpoint,
      });

      setFeedbackSuccess(true);
      onSubmitted?.(result);

      setTimeout(() => {
        setFeedbackSuccess(false);
        onClose();
      }, 1500);
    } catch (err) {
      console.error('[GiveFeedbackDialog] Failed to submit feedback:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to submit feedback.';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setSubmittingFeedback(false);
    }
  }, [
    agentChainId,
    agentDisplayName,
    agentId,
    agentName,
    feedbackCapability,
    feedbackComment,
    feedbackContext,
    feedbackRating,
    feedbackSkillId,
    feedbackTag1,
    feedbackTag2,
    markFeedbackGivenEndpoint,
    onClose,
    onSubmitted,
    preExistingFeedbackAgentId,
    preExistingFeedbackAuth,
    preExistingFeedbackChainId,
    preExistingFeedbackRequestId,
    walletAddress,
    web3auth?.provider,
  ]);

  return (
    <Dialog open={open} onClose={() => !submittingFeedback && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>Give Feedback</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Agent: {displayName}
        </Typography>

        {resolvedA2aEndpoint && (
          <Box
            sx={{
              mb: 2,
              p: 1.5,
              bgcolor: 'background.paper',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              A2A Endpoint
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontFamily: 'monospace',
                wordBreak: 'break-all',
                fontSize: '0.75rem',
              }}
            >
              {resolvedA2aEndpoint}
            </Typography>
          </Box>
        )}

        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Rating
          </Typography>
          <Rating
            value={feedbackRating}
            onChange={(_, newValue) => {
              if (newValue !== null) {
                setFeedbackRating(newValue);
              }
            }}
            max={5}
            size="large"
          />
        </Box>

        {loadingAgentCard ? (
          <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              Loading agent skills…
            </Typography>
          </Box>
        ) : agentCard?.skills?.length ? (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Skill (optional)
            </Typography>
            <TextField
              select
              fullWidth
              value={feedbackSkillId}
              onChange={(e) => setFeedbackSkillId(e.target.value)}
              disabled={submittingFeedback}
              SelectProps={{ native: true }}
            >
              <option value="">Select a skill…</option>
              {agentCard.skills.map((skill: any) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name || skill.id}
                </option>
              ))}
            </TextField>
          </Box>
        ) : null}

        <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
          <TextField
            label="Tag 1 (optional)"
            fullWidth
            value={feedbackTag1}
            onChange={(e) => setFeedbackTag1(e.target.value)}
            disabled={submittingFeedback}
            size="small"
          />
          <TextField
            label="Tag 2 (optional)"
            fullWidth
            value={feedbackTag2}
            onChange={(e) => setFeedbackTag2(e.target.value)}
            disabled={submittingFeedback}
            size="small"
          />
        </Box>

        <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
          <TextField
            label="Context (optional)"
            fullWidth
            value={feedbackContext}
            onChange={(e) => setFeedbackContext(e.target.value)}
            disabled={submittingFeedback}
            size="small"
          />
          <TextField
            label="Capability (optional)"
            fullWidth
            value={feedbackCapability}
            onChange={(e) => setFeedbackCapability(e.target.value)}
            disabled={submittingFeedback}
            size="small"
          />
        </Box>

        <TextField
          label="Comment"
          fullWidth
          multiline
          rows={4}
          value={feedbackComment}
          onChange={(e) => setFeedbackComment(e.target.value)}
          disabled={submittingFeedback}
          sx={{ mb: 2 }}
        />

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {feedbackSuccess && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Feedback submitted successfully!
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()} disabled={submittingFeedback}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={submittingFeedback || !feedbackComment.trim()}
          variant="contained"
        >
          {submittingFeedback ? 'Submitting…' : 'Submit'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}


