"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useWeb3Auth } from "../../components/Web3AuthProvider";
import { useConnection } from "../../components/connection-context";
import {
  useDefaultOrgAgent,
  type DefaultOrgAgent,
} from "../../components/useDefaultOrgAgent";
import {
  Container,
  Box,
  Typography,
  Card,
  CardContent,
  CircularProgress,
  LinearProgress,
  Alert,
  Button,
  Chip,
  Divider,
  Grid,
  Paper,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  IconButton,
  Tooltip,
  Tabs,
  Tab
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DescriptionIcon from "@mui/icons-material/Description";
import FeedbackIcon from "@mui/icons-material/Feedback";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import { sepolia, baseSepolia, optimismSepolia } from "viem/chains";
import { updateAgentRegistrationWithWallet, getDeployedAccountClientByAgentName, generateSessionPackage } from "@agentic-trust/core";
import { buildDid8004 } from "@my-scope/core";
import { getChainById } from "@agentic-trust/core/server";
import { getUserProfile, getUserOrganizations, saveUserProfile, associateUserWithOrganization } from "../../app/service/userProfileService";
import type { UserProfile, OrganizationAssociation } from "../../app/service/userProfileService";
import { GiveFeedbackDialog, type GiveFeedbackDialogConfig } from "../../components/GiveFeedbackDialog";
import { approveFeedbackRequestAction } from "../../lib/feedbackActions";

interface AgentInfo {
  ensName?: string;
  name?: string;
  agentId?: string | bigint;
  chainId?: number;
  agentAccount?: string;
  description?: string;
  image?: string;
  agentUrl?: string;
  tokenUri?: string;
  metadata?: Array<{ key: string; value: string }>;
  did?: string;
  a2aEndpoint?: string;
  mcpEndpoint?: string;
  mcp?: {
    endpoint?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// Helper functions for chain and bundler URL
function getChainForId(chainId: number) {
  if (chainId === 11155111) return sepolia;
  if (chainId === 84532) return baseSepolia;
  if (chainId === 11155420) return optimismSepolia;
  return sepolia;
}

function getBundlerUrlForId(chainId: number) {
  if (chainId === 11155111) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA;
  if (chainId === 84532) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA;
  if (chainId === 11155420) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA;
  return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA;
}

export default function DashboardPage() {
  console.log('[DashboardPage] Component rendering');
  const router = useRouter();
  const { web3auth, isInitializing: isWeb3AuthInitializing } = useWeb3Auth();
  const { user } = useConnection();
  const {
    defaultOrgAgent,
    setDefaultOrgAgent,
    isLoading: isLoadingAgent,
  } = useDefaultOrgAgent();
  console.log('[DashboardPage] Hooks initialized:', {
    isWeb3AuthInitializing,
    isLoadingAgent,
    hasUser: !!user,
    userEmail: user?.email,
    hasDefaultOrgAgent: !!defaultOrgAgent,
    defaultOrgAgentDid: defaultOrgAgent?.did,
    defaultOrgAgentName: defaultOrgAgent?.agentName
  });
  const [agentInfo, setAgentInfo] = React.useState<AgentInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [walletAddress, setWalletAddress] = React.useState<string | null>(null);
  const [userProfile, setUserProfile] = React.useState<UserProfile | null>(null);
  const [organizationData, setOrganizationData] = React.useState<OrganizationAssociation | null>(null);
  const [isEditingOrg, setIsEditingOrg] = React.useState(false);
  const [orgEditData, setOrgEditData] = React.useState({ org_name: "", org_address: "", org_type: "" });
  const [saving, setSaving] = React.useState(false);
  const [snackbar, setSnackbar] = React.useState({ open: false, message: "", severity: "success" as "success" | "error" });
  const [tokenUriModalOpen, setTokenUriModalOpen] = React.useState(false);
  const [tokenUriData, setTokenUriData] = React.useState<any>(null);
  const [loadingTokenUri, setLoadingTokenUri] = React.useState(false);
  const [tokenUriError, setTokenUriError] = React.useState<string | null>(null);
  const [updateRegistrationModalOpen, setUpdateRegistrationModalOpen] = React.useState(false);
  const [registrationData, setRegistrationData] = React.useState<any>(null);
  const [loadingRegistration, setLoadingRegistration] = React.useState(false);
  const [updatingRegistration, setUpdatingRegistration] = React.useState(false);
  const [updateRegistrationError, setUpdateRegistrationError] = React.useState<string | null>(null);
  const [updateFormData, setUpdateFormData] = React.useState({
    name: "",
    description: "",
    image: "",
    agentUrl: "",
    endpoints: [] as Array<{ name: string; endpoint: string; version: string }>
  });
  const [sessionPackageModalOpen, setSessionPackageModalOpen] = React.useState(false);
  const [sessionPackageData, setSessionPackageData] = React.useState<any>(null);
  const [loadingSessionPackage, setLoadingSessionPackage] = React.useState(false);
  const [sessionPackageError, setSessionPackageError] = React.useState<string | null>(null);
  const [feedbackDialogConfig, setFeedbackDialogConfig] =
    React.useState<GiveFeedbackDialogConfig | null>(null);
  const [dashboardTab, setDashboardTab] = React.useState(0);
  const [feedbackModalOpen, setFeedbackModalOpen] = React.useState(false);
  const [validationsModalOpen, setValidationsModalOpen] = React.useState(false);
  const [feedbackData, setFeedbackData] = React.useState<{
    items: any[] | null;
    summary: { count: number; averageScore: number } | null;
    loading: boolean;
    error: string | null;
  }>({
    items: null,
    summary: null,
    loading: false,
    error: null,
  });
  const [validationsData, setValidationsData] = React.useState<{
    pending: any[] | null;
    completed: any[] | null;
    loading: boolean;
    error: string | null;
  }>({
    pending: null,
    completed: null,
    loading: false,
    error: null,
  });
  const [feedbackRequests, setFeedbackRequests] = React.useState<{
    items: any[] | null;
    loading: boolean;
    error: string | null;
  }>({
    items: null,
    loading: false,
    error: null,
  });
  const [defaultAgentFeedbackRequests, setDefaultAgentFeedbackRequests] = React.useState<{
    items: any[] | null;
    loading: boolean;
    error: string | null;
  }>({
    items: null,
    loading: false,
    error: null,
  });
  const [approvingRequestId, setApprovingRequestId] = React.useState<number | null>(null);
  const [approveError, setApproveError] = React.useState<string | null>(null);
  const [feedbackCount, setFeedbackCount] = React.useState<number | null>(null);
  const [validationsCount, setValidationsCount] = React.useState<number | null>(null);
  // Validation request functionality moved to agents page
  const [loadingProgress, setLoadingProgress] = React.useState(0);

  const resolvedAgentDisplayName = React.useMemo(() => {
    return (
      agentInfo?.name ||
      agentInfo?.ensName ||
      defaultOrgAgent?.agentName ||
      defaultOrgAgent?.name ||
      defaultOrgAgent?.ensName ||
      null
    );
  }, [agentInfo?.ensName, agentInfo?.name, defaultOrgAgent?.agentName, defaultOrgAgent?.ensName, defaultOrgAgent?.name]);

  const resolvedAgentA2aEndpoint = React.useMemo(() => {
    if (agentInfo?.a2aEndpoint) {
      return agentInfo.a2aEndpoint;
    }
    if (defaultOrgAgent?.a2aEndpoint) {
      return defaultOrgAgent.a2aEndpoint;
    }
    if (Array.isArray(updateFormData.endpoints)) {
      const a2aEndpointObj = updateFormData.endpoints.find(
        (ep: any) => ep.name === 'a2a' || ep.endpoint?.includes('/api/a2a'),
      );
      if (a2aEndpointObj?.endpoint) {
        return a2aEndpointObj.endpoint;
      }
    }
    return null;
  }, [agentInfo?.a2aEndpoint, defaultOrgAgent?.a2aEndpoint, updateFormData.endpoints]);

  const openFeedbackDialog = React.useCallback(
    (config?: Partial<GiveFeedbackDialogConfig>) => {
      const baseAgentName =
        config?.agentName ??
        resolvedAgentDisplayName ??
        agentInfo?.name ??
        agentInfo?.ensName ??
        defaultOrgAgent?.agentName ??
        defaultOrgAgent?.name ??
        defaultOrgAgent?.ensName ??
        null;

      const baseAgentId =
        config?.agentId ?? agentInfo?.agentId ?? defaultOrgAgent?.agentId ?? null;

      const baseChainId =
        config?.agentChainId ??
        (typeof agentInfo?.chainId === 'number' ? agentInfo.chainId : null) ??
        (typeof defaultOrgAgent?.chainId === 'number' ? defaultOrgAgent.chainId : null) ??
        null;

      setFeedbackDialogConfig({
        agentName: baseAgentName,
        agentDisplayName: config?.agentDisplayName ?? baseAgentName ?? undefined,
        agentId: baseAgentId,
        agentChainId: baseChainId,
        agentA2aEndpoint: config?.agentA2aEndpoint ?? resolvedAgentA2aEndpoint,
        preExistingFeedbackAuth: config?.preExistingFeedbackAuth ?? null,
        preExistingFeedbackAgentId:
          config?.preExistingFeedbackAgentId ??
          (config?.preExistingFeedbackAuth &&
            (config.preExistingFeedbackAuth as any)?.agentId) ??
          null,
        preExistingFeedbackChainId:
          config?.preExistingFeedbackChainId ??
          (config?.preExistingFeedbackAuth &&
            (config.preExistingFeedbackAuth as any)?.chainId) ??
          null,
        preExistingFeedbackRequestId: config?.preExistingFeedbackRequestId ?? null,
        markFeedbackGivenEndpoint: config?.markFeedbackGivenEndpoint,
      });
    },
    [agentInfo, defaultOrgAgent, resolvedAgentA2aEndpoint, resolvedAgentDisplayName],
  );

  const closeFeedbackDialog = React.useCallback(() => {
    setFeedbackDialogConfig(null);
  }, []);

  // Use default org agent that was already fetched during connection
  React.useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    let isMounted = true;

    async function loadAgentInfo() {

      console.info(" ********** loading agent info **********");
      // Wait for Web3Auth to initialize and default org agent to load from storage
      if (isWeb3AuthInitializing || isLoadingAgent) {
        if (isMounted) {
          setLoading(true);
          setError(null);
        }
        return;
      }

      // Reset agent info when defaultOrgAgent changes (e.g., after selecting a new agent)
      if (isMounted) {
        setAgentInfo(null);
        setLoading(true);
        setError(null);
      }

      console.info(" ********** default org agent: ", defaultOrgAgent);
      const agentToUse = defaultOrgAgent;
      console.log('[DashboardPage] Checking agentToUse:', {
        hasAgent: !!agentToUse,
        agentAccount: agentToUse?.agentAccount,
        ensName: agentToUse?.ensName,
        agentId: agentToUse?.agentId,
        chainId: agentToUse?.chainId,
        did: agentToUse?.did
      });
      if (agentToUse) {
        // Clear any pending timeout
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        
        if (!isMounted) {
          console.log('[DashboardPage] Component unmounted, aborting');
          return;
        }
        
        // Ensure agentToUse has required fields before setting
        if (!agentToUse.agentAccount && !agentToUse.ensName) {
          console.warn("[DashboardPage] agentToUse missing required fields:", agentToUse);
          // Don't set agentInfo if required fields are missing
          if (isMounted) {
            setLoading(false);
            setError("Agent information is incomplete. Please reconnect.");
          }
          return;
        }
        
        console.log("[DashboardPage] Setting agentInfo from agentToUse:", agentToUse);
        console.log("[DashboardPage] agentToUse.did:", agentToUse.did);
        
        // Compute DID if missing using buildDid8004 from @agentic-trust/core
        let computedDid = agentToUse.did;
        console.log("[DashboardPage] Computing DID:", {
          hasExistingDid: !!computedDid,
          hasAgentId: !!agentToUse.agentId,
          hasChainId: !!agentToUse.chainId
        });
        if (!computedDid && agentToUse.agentId && agentToUse.chainId) {
          try {
            const agentId = typeof agentToUse.agentId === "bigint"
              ? Number(agentToUse.agentId)
              : typeof agentToUse.agentId === "string"
              ? Number.parseInt(agentToUse.agentId, 10)
              : Number(agentToUse.agentId);
            
            console.log("[DashboardPage] Parsed agentId:", agentId, "chainId:", agentToUse.chainId);
            if (Number.isFinite(agentId) && Number.isFinite(agentToUse.chainId)) {
              computedDid = buildDid8004(agentToUse.chainId, BigInt(agentId));
              console.log("[DashboardPage] Computed DID from agentId and chainId:", computedDid);
            } else {
              console.warn("[DashboardPage] Invalid agentId or chainId for DID computation");
            }
          } catch (error) {
            console.warn("[DashboardPage] Failed to compute DID:", error);
          }
        } else if (computedDid) {
          console.log("[DashboardPage] Using existing DID:", computedDid);
        } else {
          console.warn("[DashboardPage] Cannot compute DID - missing agentId or chainId");
        }
        
        const finalAgentInfo = {
          ...agentToUse,
          did: computedDid || agentToUse.did
        } as AgentInfo;
        console.log("[DashboardPage] Setting agentInfo state:", finalAgentInfo);
        setAgentInfo(finalAgentInfo);
        setError(null);
        // Keep loading true while we fetch database info
        setLoading(true);
        console.log("[DashboardPage] Set loading=true, fetching additional data...");
        
        // Get wallet address for display (wait for Web3Auth to be ready)
        console.log("[DashboardPage] Checking Web3Auth for wallet address:", {
          hasWeb3Auth: !!web3auth,
          isInitializing: isWeb3AuthInitializing,
          hasProvider: !!web3auth?.provider
        });
        if (web3auth && !isWeb3AuthInitializing && web3auth.provider) {
          try {
            console.log("[DashboardPage] Fetching wallet address via eth_accounts");
            const provider = (web3auth as any).provider as {
              request: (args: { method: string; params?: any[] }) => Promise<any>;
            };
            const accounts = await provider.request({
              method: "eth_accounts"
            });
            const account = Array.isArray(accounts) && accounts[0];
            console.log("[DashboardPage] Wallet address result:", { accounts, account });
            if (account && typeof account === "string" && isMounted) {
              console.log("[DashboardPage] Setting walletAddress:", account);
              setWalletAddress(account);
            }
          } catch (err) {
            console.warn("[DashboardPage] Failed to get wallet address:", err);
          }
        } else if (web3auth && !isWeb3AuthInitializing && !web3auth.provider) {
          // Web3Auth is initialized but not connected - this is OK, user might not be connected
          console.log("[DashboardPage] Web3Auth initialized but not connected");
        } else {
          console.log("[DashboardPage] Web3Auth not ready for wallet address fetch");
        }

        // Fetch user profile and organization data from database
        // If user email is not available yet (e.g., on refresh), we'll fetch it when it becomes available
        console.log("[DashboardPage] Checking for user email to fetch database info:", {
          hasUser: !!user,
          userEmail: user?.email
        });
        if (user?.email) {
          try {
            console.log("[DashboardPage] Fetching user profile for:", user.email);
            const profile = await getUserProfile(user.email);
            console.log("[DashboardPage] User profile result:", profile);
            if (profile && isMounted) {
              console.log("[DashboardPage] Setting userProfile state");
              setUserProfile(profile);
            } else {
              console.log("[DashboardPage] No profile found or component unmounted");
            }

            console.log("[DashboardPage] Fetching user organizations for:", user.email);
            const orgs = await getUserOrganizations(user.email);
            console.log("[DashboardPage] User organizations result:", orgs);
            const primaryOrg = orgs.find(org => org.is_primary) || orgs[0];
            console.log("[DashboardPage] Primary organization:", primaryOrg);
            if (primaryOrg && isMounted) {
              console.log("[DashboardPage] Setting organizationData and orgEditData");
              setOrganizationData(primaryOrg);
              setOrgEditData({
                org_name: primaryOrg.org_name || "",
                org_address: primaryOrg.org_address || "",
                org_type: primaryOrg.org_type || ""
              });
            }
          } catch (err) {
            console.warn("[DashboardPage] Failed to fetch database info:", err);
          }
        } else {
          console.log("[DashboardPage] No user email available, skipping database fetch (will retry when email available)");
        }

        // Now we can set loading to false after all data is fetched
        // Even if user email is not available yet, we can still show the agent info
        if (isMounted) {
          console.log("[DashboardPage] All data fetched, setting loading=false");
          setLoading(false);
        } else {
          console.log("[DashboardPage] Component unmounted, not updating loading state");
        }
        return;
      }

      // If we reach here, there is no default org agent defined. Surface a hard error
      // instead of trying to infer or synthesize one.
      console.warn("[DashboardPage] No defaultOrgAgent found - showing error");
      if (isMounted) {
        setLoading(false);
        setError(
          "No default organization agent is set. Complete onboarding to register/select your organization agent."
        );
      }
    }

    void loadAgentInfo();

    // Cleanup: clear timeout if effect re-runs or component unmounts
    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [web3auth, isWeb3AuthInitializing, defaultOrgAgent, isLoadingAgent, user?.email]);

  // Fetch database info when user email becomes available (e.g., after refresh)
  React.useEffect(() => {
    console.log("[DashboardPage] Secondary useEffect (database fetch) triggered:", {
      hasUserEmail: !!user?.email,
      hasDefaultOrgAgent: !!defaultOrgAgent,
      loading,
      hasAgentInfo: !!agentInfo
    });
    if (!user?.email || !defaultOrgAgent || loading || !agentInfo) {
      console.log("[DashboardPage] Secondary useEffect: Conditions not met, skipping");
      return;
    }

    const userEmail = user.email; // Capture email to avoid null check issues
    if (!userEmail) {
      console.log("[DashboardPage] Secondary useEffect: No userEmail, skipping");
      return;
    }

    async function fetchDatabaseInfo() {
        console.log("[DashboardPage] Secondary useEffect: fetchDatabaseInfo() called for:", userEmail);
      try {
          console.log("[DashboardPage] Fetching user profile (secondary)");
        const profile = await getUserProfile(userEmail);
          console.log("[DashboardPage] User profile (secondary) result:", profile);
        if (profile) {
            console.log("[DashboardPage] Setting userProfile (secondary)");
          setUserProfile(profile);
        }

          console.log("[DashboardPage] Fetching user organizations (secondary)");
        const orgs = await getUserOrganizations(userEmail);
          console.log("[DashboardPage] User organizations (secondary) result:", orgs);
        const primaryOrg = orgs.find(org => org.is_primary) || orgs[0];
        console.log("[DashboardPage] Primary organization (secondary):", primaryOrg);
        if (primaryOrg) {
          console.log("[DashboardPage] Setting organizationData (secondary)");
          setOrganizationData(primaryOrg);
          setOrgEditData({
            org_name: primaryOrg.org_name || "",
            org_address: primaryOrg.org_address || "",
            org_type: primaryOrg.org_type || ""
          });
        }
      } catch (err) {
        console.warn("[DashboardPage] Failed to fetch database info (secondary):", err);
      }
    }

    void fetchDatabaseInfo();
  }, [user?.email, defaultOrgAgent, loading, agentInfo]);

  // Fetch feedback data when modal opens
  React.useEffect(() => {
    if (!feedbackModalOpen || !agentInfo?.did) {
      return;
    }

    let cancelled = false;

    setFeedbackData(prev => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const did8004 = agentInfo.did!;
        const response = await fetch(
          `/api/agents/${encodeURIComponent(did8004)}/feedback?includeRevoked=true`
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message || errorData.error || 'Failed to fetch feedback'
          );
        }

        const data = await response.json();

        if (cancelled) return;

        const items = Array.isArray(data.feedback) ? data.feedback : [];
        const summary = data.summary ?? null;
        const count = summary?.count ?? items.length;

        setFeedbackData({
          items,
          summary,
          loading: false,
          error: null,
        });
        setFeedbackCount(count);
      } catch (error: any) {
        if (cancelled) return;
        setFeedbackData({
          items: null,
          summary: null,
          loading: false,
          error: error?.message ?? 'Unable to load feedback.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [feedbackModalOpen, agentInfo?.did]);

  // Fetch validations data when modal opens
  React.useEffect(() => {
    if (!validationsModalOpen || !agentInfo?.did) {
      return;
    }

    let cancelled = false;

    setValidationsData(prev => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const did8004 = agentInfo.did!;
        const response = await fetch(
          `/api/agents/${encodeURIComponent(did8004)}/validations`
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message || errorData.error || 'Failed to fetch validations'
          );
        }

        const data = await response.json();

        if (cancelled) return;

        const pendingArray = Array.isArray(data.pending) ? data.pending : [];
        const completedArray = Array.isArray(data.completed) ? data.completed : [];
        const totalCount = pendingArray.length + completedArray.length;

        setValidationsData({
          pending: pendingArray,
          completed: completedArray,
          loading: false,
          error: null,
        });
        setValidationsCount(totalCount);
      } catch (error: any) {
        if (cancelled) return;
        setValidationsData({
          pending: null,
          completed: null,
          loading: false,
          error: error?.message ?? 'Unable to load validations.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [validationsModalOpen, agentInfo?.did]);

  // Fetch feedback and validations counts when agentInfo is available
  React.useEffect(() => {
    if (!agentInfo?.did) {
      setFeedbackCount(null);
      setValidationsCount(null);
      return;
    }

    let cancelled = false;

    // Fetch feedback count
    (async () => {
      try {
        const did8004 = agentInfo.did!;
        const response = await fetch(
          `/api/agents/${encodeURIComponent(did8004)}/feedback?includeRevoked=true`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch feedback count');
        }

        const data = await response.json();

        if (cancelled) return;

        const count = data.summary?.count ?? (Array.isArray(data.feedback) ? data.feedback.length : 0);
        setFeedbackCount(count);
      } catch (error) {
        if (cancelled) return;
        console.warn('[DashboardPage] Failed to fetch feedback count:', error);
        setFeedbackCount(null);
      }
    })();

    // Fetch validations count
    (async () => {
      try {
        const did8004 = agentInfo.did!;
        const response = await fetch(
          `/api/agents/${encodeURIComponent(did8004)}/validations`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch validations count');
        }

        const data = await response.json();

        if (cancelled) return;

        const pendingCount = Array.isArray(data.pending) ? data.pending.length : 0;
        const completedCount = Array.isArray(data.completed) ? data.completed.length : 0;
        const totalCount = pendingCount + completedCount;
        setValidationsCount(totalCount);
      } catch (error) {
        if (cancelled) return;
        console.warn('[DashboardPage] Failed to fetch validations count:', error);
        setValidationsCount(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentInfo?.did]);

  // Fetch feedback requests when wallet address is available
  React.useEffect(() => {
    if (!walletAddress) {
      setFeedbackRequests({ items: null, loading: false, error: null });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setFeedbackRequests(prev => ({ ...prev, loading: true, error: null }));

        // Send A2A message to agents-admin.8004-agent.io
        const a2aEndpoint = 'https://agents-admin.8004-agent.io/api/a2a';
        
        console.log('[DashboardPage] Fetching feedback requests for:', walletAddress);
        
        const response = await fetch(a2aEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            skillId: 'agent.feedback.getRequests',
            payload: {
              clientAddress: walletAddress,
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || errorData.message || `Request failed with status ${response.status}`);
        }

        const result = await response.json();
        console.log('[DashboardPage] Feedback requests response:', result);

        if (cancelled) return;

        if (!result.success) {
          throw new Error(result.error || result.response?.error || 'Failed to fetch feedback requests');
        }

        const requests = result.response?.feedbackRequests || [];
        setFeedbackRequests({
          items: requests,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        console.error('[DashboardPage] Failed to fetch feedback requests:', error);
        setFeedbackRequests({
          items: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch feedback requests',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  // Fetch feedback requests for the default agent when agentId is available
  React.useEffect(() => {
    if (!agentInfo?.agentId) {
      setDefaultAgentFeedbackRequests({ items: null, loading: false, error: null });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setDefaultAgentFeedbackRequests(prev => ({ ...prev, loading: true, error: null }));

        // Get agent ID as string
        const targetAgentId = typeof agentInfo.agentId === 'bigint' 
          ? agentInfo.agentId.toString() 
          : String(agentInfo.agentId);

        // Send A2A message to agents-admin.8004-agent.io
        const a2aEndpoint = 'https://agents-admin.8004-agent.io/api/a2a';
        
        console.log('[DashboardPage] Fetching feedback requests for default agent:', targetAgentId);
        
        const response = await fetch(a2aEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            skillId: 'agent.feedback.getRequestsByAgent',
            payload: {
              targetAgentId,
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || errorData.message || `Request failed with status ${response.status}`);
        }

        const result = await response.json();
        console.log('[DashboardPage] Default agent feedback requests response:', result);

        if (cancelled) return;

        if (!result.success) {
          throw new Error(result.error || result.response?.error || 'Failed to fetch feedback requests');
        }

        const requests = result.response?.feedbackRequests || [];
        setDefaultAgentFeedbackRequests({
          items: requests,
          loading: false,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        console.error('[DashboardPage] Failed to fetch default agent feedback requests:', error);
        setDefaultAgentFeedbackRequests({
          items: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch feedback requests',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentInfo?.agentId]);


  console.log("[DashboardPage] Render phase:", {
    loading,
    error,
    hasAgentInfo: !!agentInfo,
    hasUserProfile: !!userProfile,
    hasOrganizationData: !!organizationData,
    walletAddress
  });

  // Animate progress bar over 60 seconds when loading
  React.useEffect(() => {
    if (loading) {
      setLoadingProgress(0);
      const startTime = Date.now();
      const duration = 60000; // 60 seconds
      
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min((elapsed / duration) * 100, 100);
        setLoadingProgress(progress);
        
        if (progress >= 100) {
          clearInterval(interval);
        }
      }, 100); // Update every 100ms for smooth animation
      
      return () => clearInterval(interval);
    } else {
      setLoadingProgress(0);
    }
  }, [loading]);

  // Compute tab indices based on what's available - MUST be before early return
  const getTabIndex = React.useMemo(() => {
    let idx = 0;
    return {
      organization: organizationData ? idx++ : -1,
      agentInfo: idx++,
      account: idx++,
    };
  }, [organizationData]);

  // Loading state - only while actively loading
  if (loading) {
    console.log("[DashboardPage] Rendering loading state", { loading, error, hasAgentInfo: !!agentInfo });
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          minHeight="400px"
          gap={3}
        >
          <Box sx={{ width: '100%', maxWidth: 500 }}>
            <LinearProgress 
              variant="determinate"
              value={loadingProgress}
              sx={{ 
                height: 8, 
                borderRadius: 4,
                backgroundColor: 'rgba(0, 0, 0, 0.1)',
                '& .MuiLinearProgress-bar': {
                  borderRadius: 4,
                }
              }} 
            />
          </Box>
          <Typography variant="h6" color="text.primary" fontWeight={500}>
            Loading your dashboard...
          </Typography>
          <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ maxWidth: 400 }}>
            Please wait while we load your agent information
          </Typography>
        </Box>
      </Container>
    );
  }

  if (error || !agentInfo) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {error || "Missing agent context for dashboard."}
        </Alert>
        <Button variant="contained" onClick={() => router.push("/onboarding")}>
          Go to onboarding
        </Button>
      </Container>
    );
  }

  console.log("[DashboardPage] Rendering main content with agentInfo:", agentInfo);

  const agentIdStr =
    typeof agentInfo.agentId === "bigint"
      ? agentInfo.agentId.toString()
      : agentInfo.agentId?.toString() ?? "N/A";

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box mb={4}>
        <Typography variant="h4" component="h1" gutterBottom fontWeight={600}>
          Organization
        </Typography>

      </Box>

      {/* Unified Dashboard Tabs */}
      <Card elevation={2}>
        <Tabs
          value={dashboardTab}
          onChange={(e, newValue) => setDashboardTab(newValue)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          {organizationData && <Tab label="Organization" />}
          <Tab label="Agent" />
          <Tab label="Account" />
        </Tabs>

        {/* Agent Tab */}
        {dashboardTab === getTabIndex.agentInfo && (
          <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" fontWeight={600}>
                  Agent Information
                </Typography>
                {agentInfo.did && (
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={async () => {
                      if (!agentInfo.did) return;

                      setUpdateRegistrationModalOpen(true);
                      setLoadingRegistration(true);
                      setUpdateRegistrationError(null);
                      setRegistrationData(null);
                      try {
                        const cacheKey = `itg_agent_details_${agentInfo.did}`;
                        let data: any | null = null;

                        // Try cache first
                        try {
                          const cached = typeof window !== "undefined"
                            ? localStorage.getItem(cacheKey)
                            : null;
                          if (cached) {
                            data = JSON.parse(cached);
                          }
                        } catch (cacheError) {
                          console.warn("[dashboard/page] Failed to read cached agent details:", cacheError);
                        }

                        // If not cached, fetch from API and cache
                        if (!data) {
                          const response = await fetch(`/api/agents/token-uri?did=${encodeURIComponent(agentInfo.did!)}`);
                          if (!response.ok) {
                            const error = await response.json();
                            throw new Error(error.message || 'Failed to fetch registration data');
                          }
                          data = await response.json();

                          try {
                            if (typeof window !== "undefined") {
                              localStorage.setItem(cacheKey, JSON.stringify(data));
                            }
                          } catch (cacheWriteError) {
                            console.warn("[dashboard/page] Failed to cache agent details:", cacheWriteError);
                          }
                        }

                        console.log('[dashboard/page] registration data:', data);
                        setRegistrationData(data.registrationData);
                        // Pre-populate form with existing data
                        if (data.registrationData) {
                          setUpdateFormData({
                            name: data.registrationData.name || "",
                            description: data.registrationData.description || "",
                            image: data.registrationData.image || "",
                            agentUrl: data.registrationData.agentUrl || (data.registrationData as any).external_url || "",
                            endpoints: Array.isArray(data.registrationData.endpoints) 
                              ? data.registrationData.endpoints.map((ep: any) => ({
                                  name: ep.name || "",
                                  endpoint: ep.endpoint || "",
                                  version: ep.version || ""
                                }))
                              : []
                          });
                        }
                      } catch (err) {
                        console.error('Failed to fetch registration data:', err);
                        setUpdateRegistrationError(err instanceof Error ? err.message : 'Failed to fetch registration data');
                      } finally {
                        setLoadingRegistration(false);
                      }
                    }}
                  >
                    Edit
                  </Button>
                )}
              </Box>
              <Divider sx={{ my: 2 }} />

              <Box display="flex" alignItems="center" gap={2} mb={3}>
                {agentInfo.image && (
                  <Box
                    component="img"
                    src={agentInfo.image}
                    alt={agentInfo.name ?? "Agent"}
                    sx={{
                      width: 80,
                      height: 80,
                      borderRadius: 2,
                      objectFit: "cover"
                    }}
                  />
                )}
                <Box>
                  <Typography variant="h5" component="h2" fontWeight={600}>
                    {agentInfo.name ?? "Unnamed Agent"}
                  </Typography>
                  <Chip
                    label={`Agent ID: ${agentIdStr}`}
                    size="small"
                    sx={{ mt: 1 }}
                  />
                  {agentInfo.did && (
                    <Box sx={{ mt: 1 }}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          fontFamily: "monospace",
                          fontSize: "0.7rem",
                          wordBreak: "break-all",
                          display: "block"
                        }}
                      >
                        DID: {decodeURIComponent(agentInfo.did)}
                      </Typography>
                    </Box>
                  )}
                  {!agentInfo.did && (
                    <Box sx={{ mt: 1 }}>
                      <Typography
                        variant="caption"
                        color="error"
                        sx={{ fontSize: "0.7rem" }}
                      >
                        DID: Not available
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>

              {agentInfo.description && (
                <Box mb={2}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Description
                  </Typography>
                  <Typography variant="body1">{agentInfo.description}</Typography>
                </Box>
              )}

              {agentInfo.agentUrl && (
                <Box mb={2}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Website
                  </Typography>
                  <Typography
                    variant="body1"
                    component="a"
                    href={agentInfo.agentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ color: "primary.main", textDecoration: "none" }}
                  >
                    {agentInfo.agentUrl}
                  </Typography>
                </Box>
              )}

              {agentInfo.did && agentInfo.chainId && (
                <Box 
                  mb={2}
                  sx={{
                    paddingTop: '0.75rem',
                    borderTop: '1px solid',
                    borderColor: 'divider',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.75rem',
                    alignItems: 'center',
                    fontSize: '0.8rem',
                    color: 'text.secondary',
                  }}
                >
                  <Typography
                    variant="body2"
                    component="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setFeedbackModalOpen(true);
                    }}
                    sx={{
                      padding: 0,
                      border: 'none',
                      background: 'none',
                      color: 'primary.main',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      '&:hover': {
                        textDecoration: 'none',
                      },
                    }}
                  >
                    reviews{feedbackCount !== null ? ` (${feedbackCount})` : ''}
                  </Typography>
                  <Typography
                    variant="body2"
                    component="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setValidationsModalOpen(true);
                    }}
                    sx={{
                      padding: 0,
                      border: 'none',
                      background: 'none',
                      color: 'primary.main',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      '&:hover': {
                        textDecoration: 'none',
                      },
                    }}
                  >
                    validations{validationsCount !== null ? ` (${validationsCount})` : ''}
                  </Typography>
                </Box>
              )}

              {agentInfo.metadata && agentInfo.metadata.length > 0 && (
                <Box mt={3}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Additional Metadata
                  </Typography>
                  <Box component="dl" sx={{ m: 0 }}>
                    {agentInfo.metadata.map((item, idx) => (
                      <Box key={idx} sx={{ mb: 1 }}>
                        <Typography
                          component="dt"
                          variant="body2"
                          fontWeight={600}
                          color="text.secondary"
                        >
                          {item.key}
                        </Typography>
                        <Typography component="dd" variant="body1" sx={{ ml: 2 }}>
                          {item.value}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}

              {/* Action Icons - Bottom Right */}
              {agentInfo.did && (
                <Box 
                  display="flex" 
                  justifyContent="flex-end" 
                  gap={1} 
                  mt={3}
                  pt={2}
                  sx={{ borderTop: '1px solid', borderColor: 'divider' }}
                >
                  <Tooltip title="View NFT TokenURI">
                    <IconButton
                      onClick={async () => {
                        if (!agentInfo.did) return;

                        setTokenUriModalOpen(true);
                        setLoadingTokenUri(true);
                        setTokenUriError(null);
                        setTokenUriData(null);
                        try {
                          // First, try to load from long-term browser cache
                          const cacheKey = `itg_agent_details_${agentInfo.did}`;
                          try {
                            const cached = typeof window !== "undefined"
                              ? localStorage.getItem(cacheKey)
                              : null;
                            if (cached) {
                              const parsed = JSON.parse(cached);
                              setTokenUriData(parsed);
                              setLoadingTokenUri(false);
                              return;
                            }
                          } catch (cacheError) {
                            console.warn("[dashboard/page] Failed to read cached agent details:", cacheError);
                          }

                          // Fallback to API if not cached
                          const response = await fetch(`/api/agents/token-uri?did=${encodeURIComponent(agentInfo.did!)}`);
                          if (!response.ok) {
                            const error = await response.json();
                            throw new Error(error.message || 'Failed to fetch tokenUri');
                          }
                          const data = await response.json();
                          setTokenUriData(data);

                           // Store in long-term cache
                           try {
                             if (typeof window !== "undefined") {
                               const cacheKey = `itg_agent_details_${agentInfo.did}`;
                               localStorage.setItem(cacheKey, JSON.stringify(data));
                             }
                           } catch (cacheWriteError) {
                             console.warn("[dashboard/page] Failed to cache agent details:", cacheWriteError);
                           }
                        } catch (err) {
                          console.error('Failed to fetch tokenUri:', err);
                          setTokenUriError(err instanceof Error ? err.message : 'Failed to fetch tokenUri');
                        } finally {
                          setLoadingTokenUri(false);
                        }
                      }}
                    >
                      <VisibilityIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Session Package">
                    <IconButton
                      color="secondary"
                      onClick={async () => {
                        if (!agentInfo.did) return;

                        setSessionPackageModalOpen(true);
                        setLoadingSessionPackage(true);
                        setSessionPackageError(null);
                        setSessionPackageData(null);
                        
                        // Try to fetch existing session package from database first
                        if (agentInfo.ensName) {
                          try {
                            const res = await fetch(`/api/organizations/session-package?ensName=${encodeURIComponent(agentInfo.ensName)}`);
                            if (res.ok) {
                              const data = await res.json();
                              if (data.sessionPackage) {
                                console.log('[dashboard/page] Found existing session package in database');
                                setSessionPackageData(data.sessionPackage);
                                setLoadingSessionPackage(false);
                                return;
                              }
                            }
                          } catch (e) {
                            console.warn('[dashboard/page] Failed to fetch existing session package:', e);
                          }
                        }

                        try {
                          // Validate required dependencies
                          if (!web3auth?.provider) {
                            throw new Error('Connect your wallet to generate a session package.');
                          }

                          if (!agentInfo.agentAccount || !agentInfo.agentAccount.startsWith('0x')) {
                            throw new Error('Agent account is missing or invalid.');
                          }

                          // Get wallet address if not available
                          let currentWalletAddress = walletAddress;
                          if (!currentWalletAddress) {
                            try {
                              const { getWalletAddress } = await import('@agentic-trust/core/client');
                              currentWalletAddress = await getWalletAddress(web3auth.provider);
                            } catch (err) {
                              console.warn('[dashboard/page] Failed to get wallet address:', err);
                            }
                          }

                          if (!currentWalletAddress) {
                            throw new Error('Could not determine wallet address. Please connect your wallet.');
                          }

                          // Use agentId and chainId directly from agentInfo, or extract from DID if needed
                          let chainId: number;
                          let agentIdNumeric: number;

                          if (agentInfo.chainId && agentInfo.agentId) {
                            // Use direct values if available
                            chainId = typeof agentInfo.chainId === 'number' 
                              ? agentInfo.chainId 
                              : Number.parseInt(String(agentInfo.chainId), 10);
                            
                            agentIdNumeric = typeof agentInfo.agentId === 'number'
                              ? agentInfo.agentId
                              : typeof agentInfo.agentId === 'bigint'
                              ? Number(agentInfo.agentId)
                              : Number.parseInt(String(agentInfo.agentId), 10);
                          } else if (agentInfo.did) {
                            // Fallback: try to extract from DID if direct values not available
                            const didParts = agentInfo.did.split(':');
                            if (didParts.length >= 4 && didParts[0] === 'did' && didParts[1] === '8004') {
                              chainId = Number.parseInt(didParts[2], 10);
                              agentIdNumeric = Number.parseInt(didParts.slice(3).join(':'), 10);
                            } else {
                              throw new Error('Could not determine agent ID and chain ID. Please ensure agent information is complete.');
                            }
                          } else {
                            throw new Error('Agent ID and chain ID are required to generate session package.');
                          }

                          if (!Number.isFinite(chainId) || !Number.isFinite(agentIdNumeric)) {
                            throw new Error('Invalid agent ID or chain ID.');
                          }

                          // Try to generate session package using generateSessionPackage from core
                          // If it fails (e.g., missing env vars), fall back to API endpoint
                          let sessionPkg: any = null;
                          try {
                            console.info('[dashboard/page] Calling generateSessionPackage...');
                            sessionPkg = await generateSessionPackage({
                              agentId: agentIdNumeric,
                              chainId,
                              agentAccount: agentInfo.agentAccount as `0x${string}`,
                              provider: web3auth.provider as any,
                              ownerAddress: currentWalletAddress as `0x${string}`,
                            });
                            console.info('[dashboard/page] session package generated:', sessionPkg ? 'success' : 'null');
                            
                            if (!sessionPkg) {
                              throw new Error('Failed to generate session package (returned null)');
                            }
                            
                            // Save sessionPackage to database
                            if (sessionPkg && agentInfo.ensName) {
                              try {
                                const saveResponse = await fetch('/api/organizations/session-package', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    ensName: agentInfo.ensName,
                                    sessionPackage: sessionPkg,
                                  }),
                                });
                                
                                if (saveResponse.ok) {
                                  console.info('[dashboard/page] Session package saved to database');
                                } else {
                                  const errorData = await saveResponse.json().catch(() => ({}));
                                  console.warn('[dashboard/page] Failed to save session package to database:', errorData);
                                }
                              } catch (saveError) {
                                console.warn('[dashboard/page] Error saving session package to database:', saveError);
                              }
                            }
                          } catch (genError) {
                            console.error('Failed to generate session package:', genError);
                          }

                          setSessionPackageData(sessionPkg);
                        } catch (err) {
                          console.error('Failed to fetch session package:', err);
                          setSessionPackageError(err instanceof Error ? err.message : 'Failed to fetch session package');
                        } finally {
                          setLoadingSessionPackage(false);
                        }
                      }}
                    >
                      <DescriptionIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Give Feedback">
                    <IconButton color="primary" onClick={() => openFeedbackDialog()}>
                      <FeedbackIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
              </CardContent>
            )}

            {/* Organization Tab */}
            {dashboardTab === getTabIndex.organization && getTabIndex.organization >= 0 && organizationData && (
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  <Typography variant="h6" fontWeight={600}>
                    Organization Information
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setIsEditingOrg(true)}
                  >
                    Edit
                  </Button>
                </Box>
                <Divider sx={{ my: 2 }} />

                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Organization Name
                    </Typography>
                    <Typography variant="body1" sx={{ mt: 0.5 }}>
                      {organizationData.org_name || "Not set"}
                    </Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Organization Address
                    </Typography>
                    <Typography variant="body1" sx={{ mt: 0.5 }}>
                      {organizationData.org_address || "Not set"}
                    </Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Organization Type
                    </Typography>
                    <Typography variant="body1" sx={{ mt: 0.5 }}>
                      {organizationData.org_type || "Not set"}
                    </Typography>
                  </Grid>
                  
                </Grid>
              </CardContent>
            )}

            {/* Account Tab */}
            {dashboardTab === getTabIndex.account && (
              <CardContent>
                <Typography variant="h6" gutterBottom fontWeight={600}>
                  Account Information
                </Typography>
                <Divider sx={{ my: 2 }} />

              {agentInfo.agentAccount && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Your Org Agent Account Address
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: "monospace",
                      wordBreak: "break-all",
                      mt: 0.5
                    }}
                  >
                    {agentInfo.agentAccount}
                  </Typography>
                </Box>
              )}

              {walletAddress && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Your Individual Account Address
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: "monospace",
                      wordBreak: "break-all",
                      mt: 0.5
                    }}
                  >
                    {walletAddress}
                  </Typography>
                </Box>
              )}

              {agentInfo.chainId && (
                <Box mb={2}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Chain ID
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {agentInfo.chainId} ({sepolia.name})
                  </Typography>
                </Box>
              )}

              {agentInfo.did && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Org Agent DID
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: "monospace",
                      wordBreak: "break-all",
                      mt: 0.5
                    }}
                  >
                    {decodeURIComponent(agentInfo.did)}
                  </Typography>
                  {/* A2A Endpoint */}
                  {agentInfo.a2aEndpoint && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        A2A Endpoint
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: "monospace",
                          wordBreak: "break-all",
                          mt: 0.5,
                          fontSize: "0.75rem"
                        }}
                      >
                        {agentInfo.a2aEndpoint}
                      </Typography>
                    </Box>
                  )}
                  {/* MCP Endpoint */}
                  {(agentInfo.mcpEndpoint || (agentInfo.mcp && typeof agentInfo.mcp === 'object' && (agentInfo.mcp as any).endpoint)) && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        MCP Endpoint
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: "monospace",
                          wordBreak: "break-all",
                          mt: 0.5,
                          fontSize: "0.75rem"
                        }}
                      >
                        {agentInfo.mcpEndpoint || ((agentInfo.mcp as any)?.endpoint)}
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
              </CardContent>
            )}

          </Card>

      {/* Edit Organization Dialog */}
      <Dialog open={isEditingOrg} onClose={() => setIsEditingOrg(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Organization Information</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Organization Name"
              value={orgEditData.org_name}
              onChange={(e) => setOrgEditData({ ...orgEditData, org_name: e.target.value })}
              margin="normal"
            />
            <TextField
              fullWidth
              label="Organization Address"
              value={orgEditData.org_address}
              onChange={(e) => setOrgEditData({ ...orgEditData, org_address: e.target.value })}
              margin="normal"
              multiline
              rows={3}
            />
            <TextField
              fullWidth
              label="Organization Type"
              value={orgEditData.org_type}
              onChange={(e) => setOrgEditData({ ...orgEditData, org_type: e.target.value })}
              margin="normal"
              placeholder="e.g., Alliance Organization, Non-Profit, etc."
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsEditingOrg(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (!user?.email || !organizationData) return;
              setSaving(true);
              try {
                await associateUserWithOrganization(user.email, {
                  ...organizationData,
                  org_name: orgEditData.org_name,
                  org_address: orgEditData.org_address,
                  org_type: orgEditData.org_type,
                });
                setOrganizationData({
                  ...organizationData,
                  org_name: orgEditData.org_name,
                  org_address: orgEditData.org_address,
                  org_type: orgEditData.org_type,
                });
                setIsEditingOrg(false);
                setSnackbar({ open: true, message: "Organization information updated successfully", severity: "success" });
              } catch (err) {
                console.error("Failed to update organization:", err);
                setSnackbar({ open: true, message: "Failed to update organization information", severity: "error" });
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* TokenURI Modal */}
      <Dialog 
        open={tokenUriModalOpen} 
        onClose={() => setTokenUriModalOpen(false)} 
        maxWidth="md" 
        fullWidth
      >
        <DialogTitle>Agent NFT TokenURI Information</DialogTitle>
        <DialogContent>
          {loadingTokenUri ? (
            <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" py={4}>
              <CircularProgress />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Loading tokenUri data...
              </Typography>
            </Box>
          ) : tokenUriError ? (
            <Alert severity="error" sx={{ my: 2 }}>
              {tokenUriError}
            </Alert>
          ) : tokenUriData ? (
            <Box sx={{ pt: 2 }}>
              {tokenUriData.tokenUri && (
                <>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Token URI
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: "monospace",
                      wordBreak: "break-all",
                      mb: 3,
                      p: 1,
                      bgcolor: "grey.100",
                      borderRadius: 1
                    }}
                  >
                    {tokenUriData.tokenUri}
                  </Typography>
                </>
              )}

              {tokenUriData.registrationData ? (
                <>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ mt: 3 }}>
                    Registration Data (getRegistration Response)
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      p: 2,
                      bgcolor: "grey.50",
                      borderRadius: 1,
                      overflow: "auto",
                      maxHeight: "500px",
                      fontFamily: "monospace",
                      fontSize: "0.875rem"
                    }}
                  >
                    {JSON.stringify(tokenUriData.registrationData, null, 2)}
                  </Box>
                </>
              ) : (
                <Alert severity="info" sx={{ my: 2 }}>
                  Registration data could not be fetched. The tokenUri may be invalid or unreachable.
                </Alert>
              )}

              {tokenUriData.agentInfo && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Agent Information
                  </Typography>
                  <Grid container spacing={2} sx={{ mt: 1 }}>
                    {tokenUriData.agentInfo.name && (
                      <Grid item xs={12}>
                        <Typography variant="caption" color="text.secondary" display="block">
                          Name
                        </Typography>
                        <Typography variant="body2">{tokenUriData.agentInfo.name}</Typography>
                      </Grid>
                    )}
                    {tokenUriData.agentInfo.description && (
                      <Grid item xs={12}>
                        <Typography variant="caption" color="text.secondary" display="block">
                          Description
                        </Typography>
                        <Typography variant="body2">{tokenUriData.agentInfo.description}</Typography>
                      </Grid>
                    )}
                    {tokenUriData.agentInfo.image && (
                      <Grid item xs={12}>
                        <Typography variant="caption" color="text.secondary" display="block">
                          Image
                        </Typography>
                        <Box
                          component="img"
                          src={tokenUriData.agentInfo.image}
                          alt="Agent"
                          sx={{
                            maxWidth: "200px",
                            maxHeight: "200px",
                            borderRadius: 1,
                            mt: 1
                          }}
                        />
                      </Grid>
                    )}
                    {tokenUriData.agentInfo.agentUrl && (
                      <Grid item xs={12}>
                        <Typography variant="caption" color="text.secondary" display="block">
                          Website
                        </Typography>
                        <Typography
                          variant="body2"
                          component="a"
                          href={tokenUriData.agentInfo.agentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{ color: "primary.main", textDecoration: "none" }}
                        >
                          {tokenUriData.agentInfo.agentUrl}
                        </Typography>
                      </Grid>
                    )}
                    {tokenUriData.agentInfo.metadata && tokenUriData.agentInfo.metadata.length > 0 && (
                      <Grid item xs={12}>
                        <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                          Additional Metadata
                        </Typography>
                        <Box component="dl" sx={{ m: 0 }}>
                          {tokenUriData.agentInfo.metadata.map((item: any, idx: number) => (
                            <Box key={idx} sx={{ mb: 1 }}>
                              <Typography
                                component="dt"
                                variant="body2"
                                fontWeight={600}
                                color="text.secondary"
                              >
                                {item.key}
                              </Typography>
                              <Typography component="dd" variant="body2" sx={{ ml: 2 }}>
                                {item.value}
                              </Typography>
                            </Box>
                          ))}
                        </Box>
                      </Grid>
                    )}
                  </Grid>
                </Box>
              )}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTokenUriModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Update Registration Modal */}
      <Dialog
        open={updateRegistrationModalOpen}
        onClose={() => setUpdateRegistrationModalOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Update Agent Registration</DialogTitle>
        <DialogContent>
          {loadingRegistration ? (
            <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" py={4}>
              <CircularProgress />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Loading registration data...
              </Typography>
            </Box>
          ) : updateRegistrationError ? (
            <Alert severity="error" sx={{ my: 2 }}>
              {updateRegistrationError}
            </Alert>
          ) : (
            <Box sx={{ pt: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Update the agent registration information. Changes will be uploaded to IPFS and updated on-chain.
              </Typography>

              <TextField
                fullWidth
                label="Name"
                value={updateFormData.name}
                onChange={(e) => setUpdateFormData({ ...updateFormData, name: e.target.value })}
                margin="normal"
                placeholder="e.g., gmail-itg.8004-agent.eth"
                required
              />

              <TextField
                fullWidth
                label="Description"
                value={updateFormData.description}
                onChange={(e) => setUpdateFormData({ ...updateFormData, description: e.target.value })}
                margin="normal"
                multiline
                rows={4}
                placeholder="Enter agent description"
              />

              <TextField
                fullWidth
                label="Image URL"
                value={updateFormData.image}
                onChange={(e) => setUpdateFormData({ ...updateFormData, image: e.target.value })}
                margin="normal"
                placeholder="https://example.com/image.png"
              />

              <TextField
                fullWidth
                label="Agent Website URL"
                value={updateFormData.agentUrl}
                onChange={(e) => setUpdateFormData({ ...updateFormData, agentUrl: e.target.value })}
                margin="normal"
                placeholder="https://example.com"
              />

              <Box sx={{ mt: 3 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  <Typography variant="subtitle1" fontWeight={600}>
                    Endpoints
                  </Typography>
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => {
                      setUpdateFormData({
                        ...updateFormData,
                        endpoints: [
                          ...updateFormData.endpoints,
                          { name: "", endpoint: "", version: "" }
                        ]
                      });
                    }}
                  >
                    Add Endpoint
                  </Button>
                </Box>

                {updateFormData.endpoints.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                    No endpoints configured. Click "Add Endpoint" to add one.
                  </Typography>
                ) : (
                  updateFormData.endpoints.map((endpoint, index) => (
                    <Paper key={index} elevation={1} sx={{ p: 2, mb: 2 }}>
                      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="subtitle2">Endpoint {index + 1}</Typography>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => {
                            const newEndpoints = [...updateFormData.endpoints];
                            newEndpoints.splice(index, 1);
                            setUpdateFormData({ ...updateFormData, endpoints: newEndpoints });
                          }}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Box>
                      <TextField
                        fullWidth
                        label="Name"
                        value={endpoint.name}
                        onChange={(e) => {
                          const newEndpoints = [...updateFormData.endpoints];
                          newEndpoints[index] = { ...endpoint, name: e.target.value };
                          setUpdateFormData({ ...updateFormData, endpoints: newEndpoints });
                        }}
                        margin="dense"
                        placeholder="e.g., A2A, MCP"
                      />
                      <TextField
                        fullWidth
                        label="Endpoint URL"
                        value={endpoint.endpoint}
                        onChange={(e) => {
                          const newEndpoints = [...updateFormData.endpoints];
                          newEndpoints[index] = { ...endpoint, endpoint: e.target.value };
                          setUpdateFormData({ ...updateFormData, endpoints: newEndpoints });
                        }}
                        margin="dense"
                        placeholder="e.g., bb/.well-known/agent-card.json or https://example.com/"
                      />
                      <TextField
                        fullWidth
                        label="Version"
                        value={endpoint.version}
                        onChange={(e) => {
                          const newEndpoints = [...updateFormData.endpoints];
                          newEndpoints[index] = { ...endpoint, version: e.target.value };
                          setUpdateFormData({ ...updateFormData, endpoints: newEndpoints });
                        }}
                        margin="dense"
                        placeholder="e.g., 0.3.0, 2025-06-18"
                      />
                    </Paper>
                  ))
                )}
              </Box>

              {registrationData && (
                <Box sx={{ mt: 3, p: 2, bgcolor: "grey.50", borderRadius: 1 }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Read-Only Information
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                    Agent Account: {registrationData.agentAccount || "N/A"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Chain ID: {registrationData.chainId || "N/A"}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUpdateRegistrationModalOpen(false)} disabled={updatingRegistration}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (!agentInfo.did) return;

              setUpdatingRegistration(true);
              setUpdateRegistrationError(null);
              try {
                if (!web3auth || !web3auth.provider) {
                  throw new Error('Web3Auth provider not available');
                }

                if (!agentInfo.name) {
                  throw new Error('Agent name is required to execute transactions');
                }

                if (!registrationData) {
                  throw new Error('Registration data is not available');
                }

                const provider = web3auth.provider;
                const { getWalletAddress } = await import('@agentic-trust/core/client');
                const { sepolia } = await import('viem/chains');
                
                // Get the user's EOA address
                const walletAddress = await getWalletAddress(provider);
                if (!walletAddress) {
                  throw new Error('No account available from Web3Auth');
                }

                // Get chain and bundler URL (client-side)
                const chainId = agentInfo.chainId || sepolia.id;
                const chain = sepolia; // Default to sepolia for now
                
                // Get bundler URL from environment variable
                const bundlerUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA;
                
                if (!bundlerUrl) {
                  throw new Error(
                    'Missing bundler URL configuration for this chain. Set NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA env var.'
                  );
                }

                // Build updated registration JSON
                const updatedRegistration = {
                  ...registrationData,
                  name: updateFormData.name || registrationData.name,
                  description: updateFormData.description || registrationData.description,
                  image: updateFormData.image || registrationData.image,
                  agentUrl: updateFormData.agentUrl || registrationData.agentUrl,
                  endpoints: updateFormData.endpoints.length > 0 ? updateFormData.endpoints : registrationData.endpoints,
                  updatedAt: new Date().toISOString(),
                };

                const registrationJson = JSON.stringify(updatedRegistration, null, 2);

                // Get agent's deployed AA account client
                const accountClient = await getDeployedAccountClientByAgentName(
                  bundlerUrl,
                  agentInfo.name,
                  walletAddress as `0x${string}`,
                  {
                    chain,
                    ethereumProvider: provider,
                  }
                );

                console.info('accountClient:', accountClient.address);

                // Update registration using core method
                await updateAgentRegistrationWithWallet({
                  did8004: agentInfo.did,
                  chain,
                  accountClient,
                  registration: registrationJson,
                  onStatusUpdate: (msg: string) => {
                    console.log('[RegistrationUpdate]', msg);
                  },
                });

                setSnackbar({
                  open: true,
                  message: 'Registration updated successfully!',
                  severity: "success"
                });
                setUpdateRegistrationModalOpen(false);
                
                // Optionally refresh the page or refetch agent info
                window.location.reload();
              } catch (err) {
                console.error('Failed to update registration:', err);
                setUpdateRegistrationError(err instanceof Error ? err.message : 'Failed to update registration');
              } finally {
                setUpdatingRegistration(false);
              }
            }}
            disabled={updatingRegistration || loadingRegistration}
          >
            {updatingRegistration ? "Updating..." : "Update Registration"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Session Package Modal */}
      <Dialog
        open={sessionPackageModalOpen}
        onClose={() => setSessionPackageModalOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Session Package JSON</DialogTitle>
        <DialogContent>
          {loadingSessionPackage ? (
            <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" py={4}>
              <CircularProgress />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Generating session package...
              </Typography>
            </Box>
          ) : sessionPackageError ? (
            <Alert severity="error" sx={{ my: 2 }}>
              {sessionPackageError}
            </Alert>
          ) : sessionPackageData ? (
            <Box sx={{ pt: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                This session package JSON can be used for delegation and other agent operations.
              </Typography>
              <Box
                component="pre"
                sx={{
                  p: 2,
                  bgcolor: "grey.50",
                  borderRadius: 1,
                  overflow: "auto",
                  maxHeight: "500px",
                  fontFamily: "monospace",
                  fontSize: "0.875rem",
                  border: "1px solid",
                  borderColor: "divider"
                }}
              >
                {JSON.stringify(sessionPackageData, null, 2)}
              </Box>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          {sessionPackageData && (
            <>
              <Button
                startIcon={<ContentCopyIcon />}
                onClick={async () => {
                  try {
                    const jsonString = JSON.stringify(sessionPackageData, null, 2);
                    await navigator.clipboard.writeText(jsonString);
                    setSnackbar({
                      open: true,
                      message: "Session package copied to clipboard!",
                      severity: "success"
                    });
                  } catch (err) {
                    console.error("Failed to copy to clipboard:", err);
                    setSnackbar({
                      open: true,
                      message: "Failed to copy to clipboard",
                      severity: "error"
                    });
                  }
                }}
              >
                Copy
              </Button>
              <Button
                startIcon={<FileDownloadIcon />}
                onClick={() => {
                  try {
                    const jsonString = JSON.stringify(sessionPackageData, null, 2);
                    const blob = new Blob([jsonString], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    const agentId = sessionPackageData.agentId || "unknown";
                    const chainId = sessionPackageData.chainId || "unknown";
                    link.setAttribute("download", `session-package-${chainId}-${agentId}.json`);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                    setSnackbar({
                      open: true,
                      message: "Session package downloaded!",
                      severity: "success"
                    });
                  } catch (err) {
                    console.error("Failed to download file:", err);
                    setSnackbar({
                      open: true,
                      message: "Failed to download file",
                      severity: "error"
                    });
                  }
                }}
              >
                Download
              </Button>
            </>
          )}
          <Button onClick={() => setSessionPackageModalOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Feedback Modal */}
      <Dialog
        open={feedbackModalOpen}
        onClose={() => setFeedbackModalOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Feedback — {agentInfo?.name || `Agent #${agentIdStr}`}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Feedback entries and aggregated reputation summary for this agent.
          </Typography>

          {feedbackData.summary && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.75rem',
                mb: 2,
                fontSize: '0.85rem',
                color: 'text.secondary',
              }}
            >
              <Typography variant="body2">
                <strong>Feedback count:</strong> {feedbackData.summary.count}
              </Typography>
              <Typography variant="body2">
                <strong>Average score:</strong> {feedbackData.summary.averageScore.toFixed(2)}
              </Typography>
            </Box>
          )}

          <Box
            sx={{
              mt: 1,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '10px',
              p: 1.5,
              bgcolor: 'background.paper',
              maxHeight: '500px',
              overflow: 'auto',
              fontSize: '0.85rem',
            }}
          >
            {feedbackData.loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                <CircularProgress size={24} />
              </Box>
            ) : feedbackData.error ? (
              <Typography color="error">{feedbackData.error}</Typography>
            ) : !feedbackData.items || feedbackData.items.length === 0 ? (
              <Typography color="text.secondary">
                No feedback entries found for this agent.
              </Typography>
            ) : (
              <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {feedbackData.items.map((item: any, index: number) => {
                  const clientAddress = item.clientAddress as string | undefined;
                  const score = item.score as number | undefined;
                  const isRevoked = item.isRevoked as boolean | undefined;
                  const feedbackUri = item.feedbackUri as string | undefined;
                  const feedback = item.feedback as string | undefined;

                  return (
                    <Box
                      key={item.index ?? index}
                      component="li"
                      sx={{
                        p: 1.5,
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor: 'divider',
                        bgcolor: 'background.default',
                      }}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 1,
                          mb: 0.5,
                        }}
                      >
                        <Typography variant="body2">
                          <strong>Score:</strong> {typeof score === 'number' ? score : 'N/A'}
                        </Typography>
                        {typeof isRevoked === 'boolean' && isRevoked && (
                          <Typography variant="body2" color="error" fontWeight={600}>
                            Revoked
                          </Typography>
                        )}
                      </Box>
                      {feedback && (
                        <Typography variant="body2" sx={{ mb: 0.5, color: 'text.primary' }}>
                          {feedback}
                        </Typography>
                      )}
                      {clientAddress && (
                        <Typography
                          variant="caption"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.8rem',
                            color: 'text.secondary',
                            mb: feedbackUri ? 0.5 : 0,
                            wordBreak: 'break-all',
                            display: 'block',
                          }}
                        >
                          {clientAddress}
                        </Typography>
                      )}
                      {feedbackUri && (
                        <Typography
                          component="a"
                          href={feedbackUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{
                            fontSize: '0.8rem',
                            color: 'primary.main',
                            textDecoration: 'none',
                            wordBreak: 'break-all',
                            '&:hover': {
                              textDecoration: 'underline',
                            },
                          }}
                        >
                          View feedback details
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFeedbackModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Validations Modal */}
      <Dialog
        open={validationsModalOpen}
        onClose={() => setValidationsModalOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Validations — {agentInfo?.name || `Agent #${agentIdStr}`}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Pending and completed validations for this agent from the on-chain validation registry.
          </Typography>

          {validationsData.loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : validationsData.error ? (
            <Typography color="error">{validationsData.error}</Typography>
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                maxHeight: '420px',
                overflow: 'auto',
                fontSize: '0.85rem',
              }}
            >
              <Box>
                <Typography variant="h6" sx={{ fontSize: '0.9rem', mb: 1 }}>
                  Completed validations ({validationsData.completed?.length || 0})
                </Typography>
                {validationsData.completed && validationsData.completed.length > 0 ? (
                  <Box component="ul" sx={{ listStyle: 'disc', pl: 2.5, m: 0 }}>
                    {validationsData.completed.map((item: any, index: number) => (
                      <Box key={index} component="li" sx={{ mb: 0.5 }}>
                        <Typography
                          component="code"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.8rem',
                            bgcolor: 'background.default',
                            p: 0.5,
                            borderRadius: 1,
                          }}
                        >
                          {JSON.stringify(item)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No completed validations.
                  </Typography>
                )}
              </Box>

              <Box>
                <Typography variant="h6" sx={{ fontSize: '0.9rem', mb: 1 }}>
                  Pending validations ({validationsData.pending?.length || 0})
                </Typography>
                {validationsData.pending && validationsData.pending.length > 0 ? (
                  <Box component="ul" sx={{ listStyle: 'disc', pl: 2.5, m: 0 }}>
                    {validationsData.pending.map((item: any, index: number) => (
                      <Box key={index} component="li" sx={{ mb: 0.5 }}>
                        <Typography
                          component="code"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.8rem',
                            bgcolor: 'background.default',
                            p: 0.5,
                            borderRadius: 1,
                          }}
                        >
                          {JSON.stringify(item)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No pending validations.
                  </Typography>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setValidationsModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <GiveFeedbackDialog
        open={!!feedbackDialogConfig}
        onClose={closeFeedbackDialog}
        onSubmitted={() => {
          closeFeedbackDialog();
        }}
        onError={(message) =>
          setSnackbar({
            open: true,
            message,
            severity: 'error',
          })
        }
        {...(feedbackDialogConfig || {})}
      />

      {/* Request Validation Modal removed - functionality moved to Agents page */}

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </Container>
  );
}


