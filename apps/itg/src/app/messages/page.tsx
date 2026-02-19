/* Messaging inbox page - full-featured three-pane layout */

'use client';

import * as React from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import InboxIcon from '@mui/icons-material/Inbox';
import SendIcon from '@mui/icons-material/Send';
import MailIcon from '@mui/icons-material/Mail';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import { useRouter } from 'next/navigation';
import { useWallet } from '../../components/WalletProvider';
import { useDefaultOrgAgent } from '../../components/useDefaultOrgAgent';
import {
  GiveFeedbackDialog,
  type GiveFeedbackDialogConfig,
} from '../../components/GiveFeedbackDialog';
import {
  ValidationResponseDialog,
  type ValidationResponseDialogConfig,
} from '../../components/ValidationResponseDialog';
import { approveFeedbackRequestAction, type SubmitFeedbackResult } from '../../lib/feedbackActions';

type InboxMessage = {
  id: number | string;
  fromClientAddress?: string | null;
  fromAgentDid?: string | null;
  fromAgentName?: string | null;
  toClientAddress?: string | null;
  toAgentDid?: string | null;
  toAgentName?: string | null;
  subject?: string | null;
  body: string;
  contextType?: string | null;
  contextId?: string | null;
  createdAt?: number | null;
  readAt?: number | null;
};

type FolderKey = 'inbox' | 'sent' | 'agent';
type InboxFilter = 'all' | 'individual' | 'agent';

export default function MessagesPage() {
  const router = useRouter();
  const { address: walletAddress } = useWallet();
  const { defaultOrgAgent } = useDefaultOrgAgent();

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<InboxMessage[]>([]);
  const [selectedFolder, setSelectedFolder] = React.useState<FolderKey>('inbox');
  const [selectedMessageId, setSelectedMessageId] = React.useState<number | string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');

  const [composeOpen, setComposeOpen] = React.useState(false);
  const [composeToType, setComposeToType] = React.useState<'agent' | 'user'>('agent');
  const [composeTo, setComposeTo] = React.useState('');
  const [composeSubject, setComposeSubject] = React.useState('');
  const [composeBody, setComposeBody] = React.useState('');
  const [composeSubmitting, setComposeSubmitting] = React.useState(false);
  const [composeError, setComposeError] = React.useState<string | null>(null);
  const [approveSubmitting, setApproveSubmitting] = React.useState(false);
  const [approveError, setApproveError] = React.useState<string | null>(null);
  const [approvedRequestContextIds, setApprovedRequestContextIds] = React.useState<Array<number | string>>([]);
  const [completedRequestContextIds, setCompletedRequestContextIds] = React.useState<Array<number | string>>([]);
  const [inboxFilter, setInboxFilter] = React.useState<InboxFilter>('all');
  const [feedbackDialogConfig, setFeedbackDialogConfig] =
    React.useState<GiveFeedbackDialogConfig | null>(null);
  const [validationResponseDialogConfig, setValidationResponseDialogConfig] =
    React.useState<ValidationResponseDialogConfig | null>(null);

  const defaultAgentDid: string | undefined = React.useMemo(() => {
    if (!defaultOrgAgent?.chainId || !defaultOrgAgent?.agentId) {
      return undefined;
    }
    
    // Ensure agentId is converted to string properly (handles BigInt, number, or string)
    const agentIdStr = typeof defaultOrgAgent.agentId === 'bigint'
      ? defaultOrgAgent.agentId.toString()
      : String(defaultOrgAgent.agentId);
    
    const chainIdNum = typeof defaultOrgAgent.chainId === 'number'
      ? defaultOrgAgent.chainId
      : Number(defaultOrgAgent.chainId);
    
    if (!Number.isFinite(chainIdNum) || !agentIdStr) {
      return undefined;
    }
    
    const did = `did:8004:${chainIdNum}:${agentIdStr}`;
    console.log('[MessagesPage] Constructed defaultAgentDid:', {
      chainId: chainIdNum,
      agentId: agentIdStr,
      agentIdType: typeof defaultOrgAgent.agentId,
      constructedDid: did,
    });
    return did;
  }, [defaultOrgAgent?.chainId, defaultOrgAgent?.agentId]);

  const loadMessages = React.useCallback(
    async (
      folder: FolderKey,
      options?: { preserveSelection?: boolean; selectionId?: number | string | null },
    ) => {
      if (!walletAddress && folder !== 'agent') {
        setError('Connect your wallet to load messages.');
        return;
      }
      if (folder === 'agent' && !defaultAgentDid) {
        setError('No default agent DID found. Create or select a default organization agent first.');
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const a2aEndpoint = 'https://agents-inbox.8004-agent.io/api/a2a';
        let allMessages: InboxMessage[] = [];

        // For inbox folder, fetch both client messages and agent messages
        if (folder === 'inbox') {
          const promises: Promise<InboxMessage[]>[] = [];

          // Fetch client messages if wallet address is available
          if (walletAddress) {
            const clientPromise = fetch(a2aEndpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                skillId: 'agent.inbox.listClientMessages',
                payload: { clientAddress: walletAddress },
              }),
            })
              .then((response) => {
                if (!response.ok) {
                  const errorData = response.json().catch(() => ({}));
                  throw new Error(`Failed to fetch client messages: ${response.status}`);
                }
                return response.json();
              })
              .then((result) => {
                if (!result.success) {
                  throw new Error(result.error || result.response?.error || 'Failed to fetch client messages');
                }
                return (result.response?.messages || result.messages || []) as InboxMessage[];
              })
              .catch((err) => {
                console.warn('[MessagesPage] Failed to fetch client messages:', err);
                return [];
              });

            promises.push(clientPromise);
          }

          // Fetch agent messages if default agent DID is available
          if (defaultAgentDid) {
            const agentPromise = fetch(a2aEndpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                skillId: 'agent.inbox.listAgentMessages',
                payload: { agentDid: defaultAgentDid },
              }),
            })
              .then((response) => {
                if (!response.ok) {
                  const errorData = response.json().catch(() => ({}));
                  throw new Error(`Failed to fetch agent messages: ${response.status}`);
                }
                return response.json();
              })
              .then((result) => {
                if (!result.success) {
                  throw new Error(result.error || result.response?.error || 'Failed to fetch agent messages');
                }
                return (result.response?.messages || result.messages || []) as InboxMessage[];
              })
              .catch((err) => {
                console.warn('[MessagesPage] Failed to fetch agent messages:', err);
                return [];
              });

            promises.push(agentPromise);
          }

          // Wait for all requests and combine results
          const results = await Promise.all(promises);
          allMessages = results.flat();

          // Deduplicate messages by ID (in case a message appears in both lists)
          const messageMap = new Map<string | number, InboxMessage>();
          for (const msg of allMessages) {
            const id = msg.id;
            if (!messageMap.has(id)) {
              messageMap.set(id, msg);
            }
          }
          allMessages = Array.from(messageMap.values());

          // Sort by created_at descending (most recent first)
          allMessages.sort((a, b) => {
            const aTime = a.createdAt || 0;
            const bTime = b.createdAt || 0;
            return bTime - aTime;
          });
        } else {
          // For other folders (sent, agent), use the existing logic
          let skillId: string;
          let payload: Record<string, unknown>;

          if (folder === 'agent') {
            skillId = 'agent.inbox.listAgentMessages';
            payload = { agentDid: defaultAgentDid };
          } else {
            skillId = 'agent.inbox.listClientMessages';
            payload = { clientAddress: walletAddress };
          }

          const response = await fetch(a2aEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ skillId, payload }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || errorData.message || `Request failed with status ${response.status}`);
          }

          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error || result.response?.error || 'Failed to fetch messages');
          }

          allMessages = (result.response?.messages || result.messages || []) as InboxMessage[];
        }

        setMessages(allMessages);
        setSelectedMessageId((prev) => {
          if (options?.preserveSelection) {
            const desired =
              options.selectionId !== undefined ? options.selectionId : prev;
            if (desired !== null && desired !== undefined) {
              const desiredStr = String(desired);
              const exists = allMessages.some((m) => String(m.id) === desiredStr);
              if (exists) {
                return desired as typeof prev;
              }
            }
            return allMessages.length > 0 ? allMessages[0].id : null;
          }

          return allMessages.length > 0 ? allMessages[0].id : null;
        });
      } catch (err) {
        console.error('[MessagesPage] Failed to load messages:', err);
        setError(err instanceof Error ? err.message : 'Failed to load messages');
      } finally {
        setLoading(false);
      }
    },
    [walletAddress, defaultAgentDid],
  );

  const closeFeedbackDialog = React.useCallback(() => {
    setFeedbackDialogConfig(null);
  }, []);

  const openFeedbackDialogFromMessage = React.useCallback(
    (config?: Partial<GiveFeedbackDialogConfig>) => {
      if (!defaultOrgAgent) {
        console.warn('[MessagesPage] Cannot open feedback dialog without a default agent');
        return;
      }

      const baseAgentName =
        config?.agentName ||
        defaultOrgAgent.agentName ||
        defaultOrgAgent.name ||
        defaultOrgAgent.ensName ||
        null;

      setFeedbackDialogConfig({
        agentName: baseAgentName,
        agentDisplayName:
          config?.agentDisplayName ||
          defaultOrgAgent.name ||
          defaultOrgAgent.agentName ||
          defaultOrgAgent.ensName ||
          baseAgentName ||
          undefined,
        agentId: config?.agentId ?? defaultOrgAgent.agentId ?? null,
        agentChainId: config?.agentChainId ?? defaultOrgAgent.chainId ?? null,
        agentA2aEndpoint: config?.agentA2aEndpoint ?? defaultOrgAgent.a2aEndpoint ?? null,
        preExistingFeedbackAuth: config?.preExistingFeedbackAuth ?? null,
        preExistingFeedbackAgentId:
          config?.preExistingFeedbackAgentId ?? defaultOrgAgent.agentId ?? null,
        preExistingFeedbackChainId:
          config?.preExistingFeedbackChainId ?? defaultOrgAgent.chainId ?? null,
        preExistingFeedbackRequestId: config?.preExistingFeedbackRequestId ?? null,
        markFeedbackGivenEndpoint: config?.markFeedbackGivenEndpoint,
      });
    },
    [defaultOrgAgent],
  );

  const handleFeedbackSubmitted = React.useCallback(
    (result?: SubmitFeedbackResult) => {
      if (result?.feedbackRequestId !== null && result?.feedbackRequestId !== undefined) {
        setCompletedRequestContextIds((prev) => {
          const exists = prev.some((id) => String(id) === String(result.feedbackRequestId));
          if (exists) return prev;
          return [...prev, result.feedbackRequestId as string | number];
        });
      }
      closeFeedbackDialog();
      void loadMessages(selectedFolder, { preserveSelection: true });
    },
    [closeFeedbackDialog, loadMessages, selectedFolder],
  );

  React.useEffect(() => {
    // Load messages for the initial folder when prerequisites are ready
    if (!walletAddress && selectedFolder !== 'agent') return;
    if (selectedFolder === 'agent' && !defaultAgentDid) return;
    loadMessages(selectedFolder);
  }, [selectedFolder, walletAddress, defaultAgentDid, loadMessages]);

  const filteredMessages = React.useMemo(() => {
    let base = messages;

    if (selectedFolder === 'inbox') {
      // For inbox, we've already loaded both client and agent messages
      // Just filter to show messages TO the client or TO the default agent
      const filters: Array<(m: InboxMessage) => boolean> = [];
      
      if (walletAddress) {
        const addr = walletAddress.toLowerCase();
        filters.push((m) => m.toClientAddress?.toLowerCase() === addr);
      }
      
      if (defaultAgentDid) {
        filters.push((m) => m.toAgentDid === defaultAgentDid);
      }
      
      if (filters.length > 0) {
        base = base.filter((m) => filters.some((f) => f(m)));
      }
    } else if (selectedFolder === 'sent' && walletAddress) {
      const addr = walletAddress.toLowerCase();
      base = base.filter((m) => m.fromClientAddress?.toLowerCase() === addr);
    } else if (selectedFolder === 'agent' && defaultAgentDid) {
      base = base.filter((m) => m.toAgentDid === defaultAgentDid || m.fromAgentDid === defaultAgentDid);
    }

    // Apply inbox sub-filter (All / Individual / Agent) when viewing Inbox
    if (selectedFolder === 'inbox' && defaultAgentDid) {
      base = base.filter((m) => {
        const isAgentRelated =
          m.toAgentDid === defaultAgentDid || m.fromAgentDid === defaultAgentDid;
        if (inboxFilter === 'agent') return isAgentRelated;
        if (inboxFilter === 'individual') return !isAgentRelated;
        return true; // 'all'
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      base = base.filter(
        (m) =>
          (m.subject && m.subject.toLowerCase().includes(q)) ||
          (m.body && m.body.toLowerCase().includes(q)) ||
          (m.fromAgentName && m.fromAgentName.toLowerCase().includes(q)) ||
          (m.toAgentName && m.toAgentName.toLowerCase().includes(q)),
      );
    }

    return base;
  }, [messages, selectedFolder, walletAddress, defaultAgentDid, searchQuery, inboxFilter]);

  const selectedMessage = React.useMemo(
    () => filteredMessages.find((m) => m.id === selectedMessageId) || null,
    [filteredMessages, selectedMessageId],
  );

  const feedbackGrantContextIds = React.useMemo(() => {
    const ids = new Set<string>();
    messages.forEach((m) => {
      if (m.contextType === 'feedback_auth_granted' && m.contextId !== null && m.contextId !== undefined) {
        ids.add(String(m.contextId));
      }
    });
    return ids;
  }, [messages]);

  const selectedMessageContextId = selectedMessage?.contextId ?? null;

  const isSelectedFeedbackRequestForDefaultAgent =
    !!selectedMessage &&
    selectedMessage.contextType === 'feedback_request' &&
    !!defaultAgentDid &&
    selectedMessage.toAgentDid === defaultAgentDid &&
    !!selectedMessage.fromClientAddress;

  const isSelectedValidationRequestForDefaultAgent =
    !!selectedMessage &&
    selectedMessage.contextType === 'validation_request' &&
    !!defaultAgentDid &&
    selectedMessage.toAgentDid === defaultAgentDid;

  const isSelectedRequestApproved = React.useMemo(() => {
    if (!selectedMessageContextId) return false;
    if (feedbackGrantContextIds.has(String(selectedMessageContextId))) return true;
    return approvedRequestContextIds.some((id) => String(id) === String(selectedMessageContextId));
  }, [selectedMessageContextId, feedbackGrantContextIds, approvedRequestContextIds]);

  const isSelectedGrantMessageCompleted =
    selectedMessage?.contextType === 'feedback_auth_granted' &&
    selectedMessageContextId !== null &&
    completedRequestContextIds.some((id) => String(id) === String(selectedMessageContextId));

  const handleComposeSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!walletAddress) {
        setComposeError('Connect your wallet to send messages.');
        return;
      }
      if (!composeBody.trim()) {
        setComposeError('Message body is required.');
        return;
      }
      if (!composeTo.trim()) {
        setComposeError('Recipient is required.');
        return;
      }

      try {
        setComposeSubmitting(true);
        setComposeError(null);

        const a2aEndpoint = 'https://agents-inbox.8004-agent.io/api/a2a';
        const payload: any = {
          fromClientAddress: walletAddress,
          subject: composeSubject || null,
          body: composeBody.trim(),
        };

        if (composeToType === 'agent') {
          // Send to an agent by DID or by name (we treat value as DID or name string)
          if (composeTo.startsWith('did:8004:')) {
            payload.toAgentDid = composeTo.trim();
          } else {
            // Send with name only; DID can be filled in server-side or via other flows
            payload.toAgentName = composeTo.trim();
          }
        } else {
          // Send to another user by wallet address
          payload.toClientAddress = composeTo.trim();
        }

        const response = await fetch(a2aEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            skillId: 'agent.inbox.sendMessage',
            payload,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || errorData.message || `Request failed with status ${response.status}`);
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || result.response?.error || 'Failed to send message');
        }

        // Refresh Sent folder
        setComposeOpen(false);
        setComposeTo('');
        setComposeSubject('');
        setComposeBody('');
        setSelectedFolder('sent');
        await loadMessages('sent');
      } catch (err) {
        console.error('[MessagesPage] Failed to send message:', err);
        setComposeError(err instanceof Error ? err.message : 'Failed to send message');
      } finally {
        setComposeSubmitting(false);
      }
    },
    [walletAddress, composeBody, composeSubject, composeTo, composeToType, loadMessages],
  );

  return (
    <main>
      <Box sx={{ px: 3, py: 3 }}>
        <Typography variant="h4" component="h1" sx={{ mb: 0.5, fontWeight: 600 }}>
          Messages
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          View and send messages between your wallet and agents, and see messages directed to your default organization
          agent.
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '260px 360px minmax(0, 1fr)' },
            gap: 2,
            height: { md: 'calc(100vh - 160px)' },
          }}
        >
          {/* Left: Folders & Compose */}
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setComposeOpen(true);
                setComposeError(null);
              }}
            >
              New message
            </Button>

            <List dense>
              <ListItem disablePadding>
                <ListItemButton
                  selected={selectedFolder === 'inbox'}
                  onClick={() => setSelectedFolder('inbox')}
                >
                  <InboxIcon fontSize="small" sx={{ mr: 1 }} />
                  <ListItemText primary="Inbox" />
                </ListItemButton>
              </ListItem>
              <ListItem disablePadding>
                <ListItemButton
                  selected={selectedFolder === 'sent'}
                  onClick={() => setSelectedFolder('sent')}
                >
                  <SendIcon fontSize="small" sx={{ mr: 1 }} />
                  <ListItemText primary="Sent" />
                </ListItemButton>
              </ListItem>
              <ListItem disablePadding>
                <ListItemButton
                  selected={selectedFolder === 'agent'}
                  onClick={() => setSelectedFolder('agent')}
                  disabled={!defaultAgentDid}
                >
                  <MailIcon fontSize="small" sx={{ mr: 1 }} />
                  <ListItemText
                    primary={
                      defaultOrgAgent?.name
                        ? `Agent: ${defaultOrgAgent.name}`
                        : 'Agent Inbox'
                    }
                  />
                </ListItemButton>
              </ListItem>
            </List>
          </Box>

          {/* Middle: Message list */}
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Box
              sx={{
                px: 2,
                py: 1,
                borderBottom: '1px solid',
                borderColor: 'divider',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
              }}
            >
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="Search messages..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  fullWidth
                  InputProps={{
                    startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
                  }}
                />
                <Tooltip title="Refresh">
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => loadMessages(selectedFolder, { preserveSelection: true })}
                      disabled={loading}
                    >
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>

              {selectedFolder === 'inbox' && (
                <ButtonGroup
                  size="small"
                  variant="outlined"
                  sx={{
                    ml: 1,
                    '& .MuiButton-root': {
                      textTransform: 'none',
                      fontSize: '0.75rem',
                      px: 1.2,
                    },
                  }}
                >
                  <Button
                    color={inboxFilter === 'all' ? 'primary' : 'inherit'}
                    variant={inboxFilter === 'all' ? 'contained' : 'outlined'}
                    onClick={() => setInboxFilter('all')}
                  >
                    All
                  </Button>
                  <Button
                    color={inboxFilter === 'individual' ? 'primary' : 'inherit'}
                    variant={inboxFilter === 'individual' ? 'contained' : 'outlined'}
                    onClick={() => setInboxFilter('individual')}
                  >
                    Individual
                  </Button>
                  <Button
                    color={inboxFilter === 'agent' ? 'primary' : 'inherit'}
                    variant={inboxFilter === 'agent' ? 'contained' : 'outlined'}
                    onClick={() => setInboxFilter('agent')}
                    disabled={!defaultAgentDid}
                  >
                    Agent
                  </Button>
                </ButtonGroup>
              )}
            </Box>

            {loading ? (
              <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <CircularProgress size={24} />
              </Box>
            ) : error ? (
              <Box sx={{ p: 2 }}>
                <Alert severity="error">{error}</Alert>
              </Box>
            ) : filteredMessages.length === 0 ? (
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  No messages in this folder.
                </Typography>
              </Box>
            ) : (
              <List
                dense
                sx={{
                  overflowY: 'auto',
                  flex: 1,
                }}
              >
                {filteredMessages.map((msg) => {
                  const isUnread = !msg.readAt;
                  const isOutgoing = msg.fromClientAddress?.toLowerCase() === walletAddress?.toLowerCase();
                  const isAgentRelated =
                    !!defaultAgentDid &&
                    (msg.toAgentDid === defaultAgentDid || msg.fromAgentDid === defaultAgentDid);

                  const counterpart =
                    selectedFolder === 'agent'
                      ? isOutgoing
                        ? msg.toAgentName ||
                          (msg.toClientAddress
                            ? `${msg.toClientAddress.substring(0, 6)}...${msg.toClientAddress.substring(38)}`
                            : msg.toAgentDid || 'Unknown')
                        : msg.fromAgentName ||
                          (msg.fromClientAddress
                            ? `${msg.fromClientAddress.substring(0, 6)}...${msg.fromClientAddress.substring(38)}`
                            : msg.fromAgentDid || 'Unknown')
                      : isOutgoing
                        ? msg.toAgentName ||
                          (msg.toClientAddress
                            ? `${msg.toClientAddress.substring(0, 6)}...${msg.toClientAddress.substring(38)}`
                            : msg.toAgentDid || 'Unknown')
                        : msg.fromAgentName ||
                          (msg.fromClientAddress
                            ? `${msg.fromClientAddress.substring(0, 6)}...${msg.fromClientAddress.substring(38)}`
                            : msg.fromAgentDid || 'Unknown');

                  return (
                    <ListItemButton
                      key={msg.id}
                      selected={selectedMessageId === msg.id}
                      onClick={() => setSelectedMessageId(msg.id)}
                      sx={{
                        alignItems: 'flex-start',
                        py: 1,
                        px: 2,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        borderLeft: '3px solid',
                        borderLeftColor:
                          selectedFolder === 'inbox'
                            ? isAgentRelated
                              ? 'secondary.main'
                              : 'transparent'
                            : 'transparent',
                        bgcolor:
                          selectedFolder === 'inbox' && isAgentRelated
                            ? 'action.hover'
                            : 'transparent',
                      }}
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ width: '100%', alignItems: 'center' }}
                      >
                        {isUnread && (
                          <Box
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              bgcolor: 'primary.main',
                              mr: 0.5,
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ fontWeight: isUnread ? 600 : 400 }}
                          >
                            {counterpart}
                          </Typography>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            noWrap
                          >
                            {msg.subject || '(no subject)'} — {msg.body.slice(0, 80)}
                            {msg.body.length > 80 ? '…' : ''}
                          </Typography>
                        </Box>
                        <Box sx={{ ml: 1, textAlign: 'right' }}>
                          {selectedFolder === 'inbox' && isAgentRelated && (
                            <Chip
                              label="For my agent"
                              size="small"
                              color="secondary"
                              variant="outlined"
                              sx={{ mb: 0.5 }}
                            />
                          )}
                          <Typography variant="caption" color="text.secondary" display="block">
                            {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : ''}
                          </Typography>
                        </Box>
                      </Stack>
                    </ListItemButton>
                  );
                })}
              </List>
            )}
          </Box>

          {/* Right: Reading / details pane */}
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 320,
            }}
          >
            {!selectedMessage ? (
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  Select a message to read.
                </Typography>
              </Box>
            ) : (
              <>
                <Box sx={{ mb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    {selectedMessage.subject || '(no subject)'}
                  </Typography>
                  {selectedMessage.contextType === 'feedback_request' && (
                    <Chip
                      label="Feedback request"
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  )}
                  {selectedMessage.contextType === 'validation_request' && (
                    <Chip
                      label="Validation request"
                      size="small"
                      color="secondary"
                      variant="outlined"
                    />
                  )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {selectedMessage.createdAt
                      ? new Date(selectedMessage.createdAt).toLocaleString()
                      : ''}
                  </Typography>
                  {defaultAgentDid &&
                    (selectedMessage.toAgentDid === defaultAgentDid ||
                      selectedMessage.fromAgentDid === defaultAgentDid) && (
                      <Chip
                        label="Agent-related"
                        size="small"
                        color="secondary"
                        variant="outlined"
                      />
                    )}
                </Box>

                <Divider sx={{ my: 1.5 }} />

                <Box sx={{ mb: 1 }}>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    <strong>From:</strong>{' '}
                    {selectedMessage.fromAgentName ||
                      (selectedMessage.fromClientAddress
                        ? `${selectedMessage.fromClientAddress.substring(
                            0,
                            6,
                          )}...${selectedMessage.fromClientAddress.substring(38)}`
                        : selectedMessage.fromAgentDid || 'Unknown')}
                  </Typography>
                  <Typography variant="body2">
                    <strong>To:</strong>{' '}
                    {selectedMessage.toAgentName ||
                      (selectedMessage.toClientAddress
                        ? `${selectedMessage.toClientAddress.substring(
                            0,
                            6,
                          )}...${selectedMessage.toClientAddress.substring(38)}`
                        : selectedMessage.toAgentDid || 'Unknown')}
                  </Typography>
                </Box>

                {/* Feedback request actions - keep these near the top, above the scrollable body */}
                {isSelectedFeedbackRequestForDefaultAgent && selectedMessage.fromClientAddress && (
                  <Box sx={{ mb: 1.5 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      This is a feedback request from{' '}
                      {`${selectedMessage.fromClientAddress.substring(
                        0,
                        6,
                      )}...${selectedMessage.fromClientAddress.substring(38)}`}{' '}
                      for your default agent.
                    </Typography>
                    {approveError && (
                      <Alert severity="error" sx={{ mb: 1 }}>
                        {approveError}
                      </Alert>
                    )}
                    {isSelectedRequestApproved ? (
                      <Alert severity="success" sx={{ mb: 1 }}>
                        Feedback request approved. A notification has been sent to the requester.
                      </Alert>
                    ) : null}
                    {!isSelectedRequestApproved && (
                      <Button
                        variant="contained"
                        size="small"
                        disabled={approveSubmitting}
                        onClick={async () => {
                          if (!defaultOrgAgent?.a2aEndpoint || !defaultOrgAgent?.agentId) {
                            setApproveError('Default agent configuration is incomplete.');
                            return;
                          }
                          if (!selectedMessage.fromClientAddress || !selectedMessage.contextId) {
                            setApproveError('Message is missing requester details.');
                            return;
                          }

                          try {
                            setApproveSubmitting(true);
                            setApproveError(null);

                            const agentId =
                              typeof defaultOrgAgent.agentId === 'bigint'
                                ? defaultOrgAgent.agentId.toString()
                                : String(defaultOrgAgent.agentId);

                            await approveFeedbackRequestAction({
                              agentA2aEndpoint: defaultOrgAgent.a2aEndpoint,
                              clientAddress: selectedMessage.fromClientAddress,
                              agentId,
                              feedbackRequestId: selectedMessage.contextId,
                            });

                            if (selectedMessage.contextId !== null && selectedMessage.contextId !== undefined) {
                              setApprovedRequestContextIds((prev) => {
                                const exists = prev.some(
                                  (ctx) => String(ctx) === String(selectedMessage.contextId),
                                );
                                if (exists) return prev;
                                return [...prev, selectedMessage.contextId as string | number];
                              });
                            }

                            await loadMessages(selectedFolder, {
                              preserveSelection: true,
                              selectionId: selectedMessage.id,
                            });
                          } catch (err) {
                            console.error('[MessagesPage] Failed to approve feedback request:', err);
                            setApproveError(
                              err instanceof Error ? err.message : 'Failed to approve feedback request',
                            );
                          } finally {
                            setApproveSubmitting(false);
                          }
                        }}
                      >
                        {approveSubmitting ? 'Approving…' : 'Approve feedback request'}
                      </Button>
                    )}
                  </Box>
                )}

                {/* Feedback auth granted actions */}
                {selectedMessage.contextType === 'feedback_auth_granted' &&
                  selectedMessage.toClientAddress &&
                  walletAddress &&
                  selectedMessage.toClientAddress.toLowerCase() === walletAddress.toLowerCase() && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        Your request to give feedback has been approved. You can respond now or from your dashboard.
                      </Typography>
                      {isSelectedGrantMessageCompleted ? (
                        <Alert severity="success" sx={{ mb: 1 }}>
                          Feedback submitted. Thank you!
                        </Alert>
                      ) : null}
                      {!isSelectedGrantMessageCompleted && (
                        <Stack direction="row" spacing={1}>
                          <Button
                            variant="contained"
                            size="small"
                            onClick={() =>
                              openFeedbackDialogFromMessage({
                                preExistingFeedbackRequestId: selectedMessage.contextId,
                              })
                            }
                            disabled={!defaultOrgAgent}
                          >
                            Give feedback now
                          </Button>
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={() => router.push('/dashboard')}
                          >
                            Go to Dashboard
                          </Button>
                        </Stack>
                      )}
                    </Box>
                  )}

                {/* Validation request actions */}
                {isSelectedValidationRequestForDefaultAgent && (
                  <Box sx={{ mb: 1.5 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      This is a validation request from{' '}
                      {selectedMessage.fromAgentName ||
                        selectedMessage.fromAgentDid ||
                        selectedMessage.fromClientAddress ||
                        'Unknown requester'}{' '}
                      for your default agent.
                    </Typography>
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => {
                        if (!defaultOrgAgent?.a2aEndpoint || !defaultOrgAgent?.agentId || !defaultOrgAgent?.chainId) {
                          setApproveError('Default agent configuration is incomplete.');
                          return;
                        }

                        // Extract target agent ID from the validation request
                        // The fromAgentDid should contain the agent ID of the requester
                        let targetAgentId: string | number | bigint | undefined;
                        let targetAgentDid: string | undefined;

                        if (selectedMessage.fromAgentDid) {
                          targetAgentDid = selectedMessage.fromAgentDid;
                          // Parse DID to get agent ID: did:8004:chainId:agentId
                          const didParts = selectedMessage.fromAgentDid.split(':');
                          if (didParts.length >= 4 && didParts[0] === 'did' && didParts[1] === '8004') {
                            targetAgentId = didParts.slice(3).join(':');
                          }
                        }

                        setValidationResponseDialogConfig({
                          fromAgentName: selectedMessage.fromAgentName || null,
                          fromAgentDid: selectedMessage.fromAgentDid || null,
                          fromClientAddress: selectedMessage.fromClientAddress || null,
                          agentA2aEndpoint: defaultOrgAgent.a2aEndpoint,
                          agentId: defaultOrgAgent.agentId,
                          agentChainId:
                            typeof defaultOrgAgent.chainId === 'number'
                              ? defaultOrgAgent.chainId
                              : Number.parseInt(String(defaultOrgAgent.chainId), 10),
                          requestHash: selectedMessage.contextId?.toString() || null,
                          targetAgentId: targetAgentId,
                          targetAgentDid: targetAgentDid,
                          contextId: selectedMessage.contextId,
                        });
                      }}
                    >
                      Accept Request (Validation Response)
                    </Button>
                  </Box>
                )}
              </>
            )}
          </Box>
        </Box>

      <GiveFeedbackDialog
        open={!!feedbackDialogConfig}
        onClose={closeFeedbackDialog}
        onSubmitted={handleFeedbackSubmitted}
        {...(feedbackDialogConfig || {})}
      />

      <ValidationResponseDialog
        open={!!validationResponseDialogConfig}
        onClose={() => setValidationResponseDialogConfig(null)}
        onSubmitted={async () => {
          setValidationResponseDialogConfig(null);
          // Reload messages to reflect the change
          await loadMessages(selectedFolder, {
            preserveSelection: true,
            selectionId: selectedMessageId,
          });
        }}
        onError={(message) => {
          setApproveError(message);
        }}
        {...(validationResponseDialogConfig || {})}
      />

        {/* Compose overlay */}
        {composeOpen && (
          <Box
            sx={{
              position: 'fixed',
              inset: 0,
              bgcolor: 'rgba(0,0,0,0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: (theme) => theme.zIndex.modal,
            }}
          >
            <Box
              component="form"
              onSubmit={handleComposeSubmit}
              sx={{
                width: '100%',
                maxWidth: 640,
                bgcolor: 'background.paper',
                borderRadius: 2,
                boxShadow: 6,
                p: 3,
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" fontWeight={600}>
                  New message
                </Typography>
                <IconButton size="small" onClick={() => setComposeOpen(false)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>

              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <Chip
                  label="To agent"
                  size="small"
                  color={composeToType === 'agent' ? 'primary' : 'default'}
                  onClick={() => setComposeToType('agent')}
                  variant={composeToType === 'agent' ? 'filled' : 'outlined'}
                />
                <Chip
                  label="To user"
                  size="small"
                  color={composeToType === 'user' ? 'primary' : 'default'}
                  onClick={() => setComposeToType('user')}
                  variant={composeToType === 'user' ? 'filled' : 'outlined'}
                />
              </Stack>

              <TextField
                label={composeToType === 'agent' ? 'Agent DID or name' : 'Recipient wallet address'}
                fullWidth
                size="small"
                sx={{ mb: 2 }}
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
              />

              <TextField
                label="Subject"
                fullWidth
                size="small"
                sx={{ mb: 2 }}
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
              />

              <TextField
                label="Message"
                fullWidth
                multiline
                minRows={5}
                sx={{ mb: 2 }}
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
              />

              {composeError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {composeError}
                </Alert>
              )}

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Button
                  onClick={() => setComposeOpen(false)}
                  disabled={composeSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={composeSubmitting || !composeBody.trim() || !composeTo.trim()}
                >
                  {composeSubmitting ? 'Sending...' : 'Send'}
                </Button>
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </main>
  );
}


