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
  Typography,
  CircularProgress,
} from '@mui/material';
import { useWeb3Auth } from './Web3AuthProvider';
import { acceptValidationRequestAction } from '../lib/validationActions';

export interface ValidationResponseDialogConfig {
  fromAgentName?: string | null;
  fromAgentDid?: string | null;
  fromClientAddress?: string | null;
  agentA2aEndpoint?: string | null;
  agentId?: string | number | bigint | null;
  agentChainId?: number | null;
  requestHash?: string | null;
  targetAgentId?: string | number | bigint | null;
  targetAgentDid?: string | null;
  contextId?: string | number | null;
}

export interface ValidationResponseDialogProps extends ValidationResponseDialogConfig {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
  onError?: (message: string) => void;
}

export function ValidationResponseDialog({
  open,
  onClose,
  onSubmitted,
  onError,
  fromAgentName,
  fromAgentDid,
  fromClientAddress,
  agentA2aEndpoint,
  agentId,
  agentChainId,
  requestHash,
  targetAgentId,
  targetAgentDid,
  contextId,
}: ValidationResponseDialogProps) {
  const { web3auth } = useWeb3Auth();

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const resetState = React.useCallback(() => {
    setSubmitting(false);
    setError(null);
    setSuccess(false);
  }, []);

  React.useEffect(() => {
    if (open) {
      resetState();
    }
  }, [open, resetState]);

  const handleSubmit = React.useCallback(async () => {
    if (!agentA2aEndpoint || !agentId || !agentChainId) {
      const errorMsg = 'Missing required configuration for validation response';
      setError(errorMsg);
      onError?.(errorMsg);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const agentIdNum =
        typeof agentId === 'bigint' ? Number(agentId) : typeof agentId === 'string' ? Number.parseInt(agentId, 10) : Number(agentId);
      const chainIdNum = typeof agentChainId === 'number' ? agentChainId : Number.parseInt(String(agentChainId), 10);

      const targetAgentIdNum = targetAgentId
        ? (typeof targetAgentId === 'bigint'
            ? Number(targetAgentId)
            : typeof targetAgentId === 'string'
              ? Number.parseInt(targetAgentId, 10)
              : Number(targetAgentId))
        : undefined;

      await acceptValidationRequestAction({
        agentA2aEndpoint,
        agentId: targetAgentIdNum || agentIdNum,
        chainId: chainIdNum,
        requestHash: requestHash || undefined,
        targetAgentId: targetAgentIdNum,
        targetAgentDid: targetAgentDid || undefined,
      });

      setSuccess(true);
      onSubmitted?.();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to accept validation request';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setSubmitting(false);
    }
  }, [
    agentA2aEndpoint,
    agentId,
    agentChainId,
    requestHash,
    targetAgentId,
    targetAgentDid,
    onSubmitted,
    onError,
  ]);

  const displayName = fromAgentName || fromAgentDid || fromClientAddress || 'Unknown requester';

  return (
    <Dialog open={open} onClose={() => !submitting && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>Accept Validation Request</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          You are about to accept a validation request. This will process the validation on-chain.
        </Typography>

        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Requester:
          </Typography>
          <Typography variant="body1" fontWeight={600}>
            {displayName}
          </Typography>
          {fromClientAddress && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {fromClientAddress}
            </Typography>
          )}
        </Box>

        {requestHash && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Request Hash:
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontFamily: 'monospace',
                wordBreak: 'break-all',
                fontSize: '0.75rem',
              }}
            >
              {requestHash}
            </Typography>
          </Box>
        )}

        {agentA2aEndpoint && (
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
              {agentA2aEndpoint}
            </Typography>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Validation request accepted successfully! A notification has been sent to the requester.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting || success || !agentA2aEndpoint || !agentId || !agentChainId}
        >
          {submitting ? (
            <>
              <CircularProgress size={16} sx={{ mr: 1 }} />
              Accepting...
            </>
          ) : success ? (
            'Accepted'
          ) : (
            'Accept Request'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

