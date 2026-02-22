"use client";

import * as React from "react";
import Link from "next/link";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { generateSessionPackage } from "@agentic-trust/core";
import { createPublicClient, http } from "viem";
import type { Address } from "viem";
import { useConnection } from "../../components/connection-context";
import { useCurrentUserProfile } from "../../components/useCurrentUserProfile";
import { useWeb3Auth } from "../../components/Web3AuthProvider";
import { saveUserProfile } from "../service/userProfileService";
import { parseUaidParts } from "../../lib/uaid";
import { UserCapabilitiesEditor } from "../../components/UserCapabilitiesEditor";

type UserSettingsTab = "user" | "capabilities" | "agent";

function safeParseJson(input: string | null | undefined): any | null {
  if (!input) return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function coerceAgentIdToNumber(value: unknown): number | null {
  try {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    if (typeof value === "bigint") {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();
      const n = trimmed.startsWith("0x") ? Number(BigInt(trimmed)) : Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }
  } catch {
    // ignore
  }
  return null;
}

const OWNER_ABI = [
  { name: "owner", type: "function", stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" }] },
] as const;
const GET_OWNER_ABI = [
  { name: "getOwner", type: "function", stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" }] },
] as const;
const OWNERS_ABI = [
  { name: "owners", type: "function", stateMutability: "view" as const, inputs: [], outputs: [{ type: "address[]" }] },
] as const;

function getBundlerUrlForChain(chainId: number): string | undefined {
  if (chainId === 11155111) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA;
  if (chainId === 84532) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_BASE_SEPOLIA;
  if (chainId === 11155420) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_OPTIMISM_SEPOLIA;
  if (chainId === 59141) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_LINEA_SEPOLIA;
  if (chainId === 59144) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_LINEA;
  return process.env.NEXT_PUBLIC_AGENTIC_TRUST_BUNDLER_URL_SEPOLIA;
}

function getRpcUrlForChain(chainId: number): string | undefined {
  if (chainId === 11155111) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA;
  if (chainId === 84532) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_BASE_SEPOLIA;
  if (chainId === 11155420) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_OPTIMISM_SEPOLIA;
  if (chainId === 59141) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_LINEA_SEPOLIA;
  if (chainId === 59144) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_LINEA;
  return process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA;
}

function getIdentityRegistryForChain(chainId: number): string | undefined {
  if (chainId === 11155111) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_SEPOLIA;
  if (chainId === 59144) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_LINEA;
  if (chainId === 1) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY_MAINNET;
  return process.env.NEXT_PUBLIC_AGENTIC_TRUST_IDENTITY_REGISTRY;
}

function getReputationRegistryForChain(chainId: number): string | undefined {
  if (chainId === 11155111) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_SEPOLIA;
  if (chainId === 59144) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_LINEA;
  if (chainId === 1) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY_MAINNET;
  return process.env.NEXT_PUBLIC_AGENTIC_TRUST_REPUTATION_REGISTRY;
}

function getValidationRegistryForChain(chainId: number): string | undefined {
  if (chainId === 11155111) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY_SEPOLIA;
  if (chainId === 59144) return process.env.NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY_LINEA;
  return process.env.NEXT_PUBLIC_AGENTIC_TRUST_VALIDATION_REGISTRY;
}

export default function UserSettingsPage() {
  const { user } = useConnection();
  const { web3auth } = useWeb3Auth();
  const { walletAddress, profile, role, loading: profileLoading, refresh, setRole } = useCurrentUserProfile();

  const individualId = React.useMemo(() => {
    const raw = (profile as any)?.id;
    if (raw == null) return null;
    const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [profile]);

  const [tab, setTab] = React.useState<UserSettingsTab>("user");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");

  React.useEffect(() => {
    setFirstName(typeof profile?.first_name === "string" ? profile.first_name : "");
    setLastName(typeof profile?.last_name === "string" ? profile.last_name : "");
  }, [profile?.first_name, profile?.last_name]);

  const participantUaid = typeof profile?.participant_uaid === "string" && profile.participant_uaid.trim() ? profile.participant_uaid.trim() : null;
  const participantEns = typeof profile?.participant_ens_name === "string" && profile.participant_ens_name.trim() ? profile.participant_ens_name.trim() : null;
  const participantAgentName =
    typeof profile?.participant_agent_name === "string" && profile.participant_agent_name.trim() ? profile.participant_agent_name.trim() : null;

  const parsed = parseUaidParts(participantUaid);
  const chainId = (parsed?.chainId ?? 11155111) as number;
  const agentAccount =
    (parsed?.agentAccount as string | null) ??
    (typeof profile?.aa_address === "string" && /^0x[a-fA-F0-9]{40}$/.test(profile.aa_address) ? profile.aa_address.toLowerCase() : null);

  const [agentDetails, setAgentDetails] = React.useState<any | null>(null);
  const [agentDetailsLoading, setAgentDetailsLoading] = React.useState(false);
  const [agentDetailsError, setAgentDetailsError] = React.useState<string | null>(null);

  const [agentCardJson, setAgentCardJson] = React.useState<any | null>(null);
  const [agentCardUrl, setAgentCardUrl] = React.useState<string | null>(null);
  const [agentCardLoading, setAgentCardLoading] = React.useState(false);
  const [agentCardError, setAgentCardError] = React.useState<string | null>(null);

  const [a2aStatusLoading, setA2aStatusLoading] = React.useState(false);
  const [a2aStatusError, setA2aStatusError] = React.useState<string | null>(null);
  const [a2aStatusResult, setA2aStatusResult] = React.useState<any | null>(null);

  const agentId = React.useMemo(() => coerceAgentIdToNumber(agentDetails?.agentId ?? (agentDetails as any)?.agent?.agentId ?? null), [agentDetails]);

  const [sessionPkg, setSessionPkg] = React.useState<any | null>(null);
  const [existingSession, setExistingSession] = React.useState<any | null>(null);
  const [sessionError, setSessionError] = React.useState<string | null>(null);

  const refreshStoredSession = React.useCallback(async () => {
    if (!participantUaid) {
      setExistingSession(null);
      return;
    }
    try {
      const res = await fetch(`/api/agents/session-package?uaid=${encodeURIComponent(participantUaid)}`);
      const json = await res.json().catch(() => null as any);
      if (!res.ok) {
        setExistingSession(null);
        return;
      }
      setExistingSession(json?.sessionPackage ?? null);
    } catch {
      setExistingSession(null);
    }
  }, [participantUaid]);

  React.useEffect(() => {
    void refreshStoredSession();
  }, [refreshStoredSession]);

  const handleSaveUser = React.useCallback(async () => {
    if (!walletAddress) return;
    setSaving(true);
    setError(null);
    try {
      const eoa = walletAddress.toLowerCase();
      await saveUserProfile({
        ...(user?.email ? { email: user.email } : {}),
        eoa_address: eoa,
        first_name: firstName,
        last_name: lastName,
        role: role ?? undefined,
        participant_ens_name: profile?.participant_ens_name ?? undefined,
        participant_agent_name: profile?.participant_agent_name ?? undefined,
        participant_uaid: profile?.participant_uaid ?? undefined,
      });
      await refresh();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }, [walletAddress, user?.email, firstName, lastName, role, profile, refresh]);

  const handleRefreshAgentDetails = React.useCallback(async () => {
    setAgentDetails(null);
    setAgentDetailsError(null);
    setAgentDetailsLoading(true);
    try {
      if (!participantUaid) throw new Error("Missing participant UAID (complete onboarding / connect).");
      const res = await fetch(`/api/agents/by-uaid/${encodeURIComponent(participantUaid)}`);
      const json = await res.json().catch(() => null as any);
      if (!res.ok || !json) throw new Error(json?.message || json?.error || `Failed to hydrate agent (${res.status})`);
      setAgentDetails(json);
    } catch (e: any) {
      setAgentDetailsError(e?.message || String(e));
    } finally {
      setAgentDetailsLoading(false);
    }
  }, [participantUaid]);

  const handleGetA2aAgentCardJson = React.useCallback(async () => {
    setAgentCardJson(null);
    setAgentCardUrl(null);
    setAgentCardError(null);
    setAgentCardLoading(true);
    try {
      if (!participantUaid) throw new Error("Missing participant UAID (complete onboarding / connect).");
      const res = await fetch(`/api/agents/a2a-card/${encodeURIComponent(participantUaid)}`, { method: "GET" });
      const json = await res.json().catch(() => null as any);
      if (!res.ok || !json || json.success !== true) {
        throw new Error(json?.message || json?.error || `Failed to fetch agent card (${res.status})`);
      }
      setAgentCardJson(json.card ?? null);
      setAgentCardUrl(typeof json.cardUrl === "string" ? json.cardUrl : null);
    } catch (e: any) {
      setAgentCardError(e?.message || String(e));
    } finally {
      setAgentCardLoading(false);
    }
  }, [participantUaid]);

  const handleCheckA2aStatus = React.useCallback(async () => {
    setA2aStatusError(null);
    setA2aStatusResult(null);
    setA2aStatusLoading(true);
    try {
      if (!participantUaid) throw new Error("Missing participant UAID (complete onboarding / connect).");
      const res = await fetch(`/api/agents/a2a-status/${encodeURIComponent(participantUaid)}`, { method: "GET" });
      const json = await res.json().catch(() => null as any);
      if (!res.ok || !json || json.success !== true) {
        throw new Error(json?.message || json?.error || `Failed to call agent.status (${res.status})`);
      }
      setA2aStatusResult(json);
    } catch (e: any) {
      setA2aStatusError(e?.message || String(e));
    } finally {
      setA2aStatusLoading(false);
    }
  }, [participantUaid]);

  const handlePersistSessionPackage = React.useCallback(
    async (pkg: any) => {
      if (!participantUaid) throw new Error("Missing participant UAID.");
      const res = await fetch("/api/agents/session-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uaid: participantUaid, sessionPackage: pkg }),
      });
      const json = await res.json().catch(() => null as any);
      if (!res.ok || !json || json.success !== true) {
        throw new Error(json?.message || json?.error || `Failed to save session package (${res.status})`);
      }
      await refreshStoredSession();
    },
    [participantUaid, refreshStoredSession],
  );

  const handleGenerateSessionPackage = React.useCallback(async () => {
    setSessionPkg(null);
    setSessionError(null);
    if (!participantUaid) {
      setSessionError("Missing participant UAID (complete onboarding / connect).");
      return;
    }
    if (!walletAddress) {
      setSessionError("Wallet address is required to generate a session package.");
      return;
    }

    if (web3auth && !(web3auth as any).provider && typeof (web3auth as any).connect === "function") {
      try {
        await (web3auth as any).connect();
      } catch {
        // ignore
      }
    }
    const eip1193Provider = (web3auth as any)?.provider ?? (typeof window !== "undefined" ? (window as any).ethereum : null);
    if (!eip1193Provider) {
      setSessionError("An EIP-1193 provider is required to generate a session package.");
      return;
    }

    try {
      // Ensure agent details are hydrated so we have agentId.
      let effectiveAgentId = agentId;
      if (!effectiveAgentId) {
        await handleRefreshAgentDetails();
        effectiveAgentId = coerceAgentIdToNumber((agentDetails as any)?.agentId ?? null);
      }
      if (!effectiveAgentId) {
        const res = await fetch(`/api/agents/by-uaid/${encodeURIComponent(participantUaid)}`);
        const json = await res.json().catch(() => null as any);
        effectiveAgentId = coerceAgentIdToNumber(json?.agentId ?? json?.agent?.agentId ?? null);
      }
      if (!effectiveAgentId) throw new Error("Missing agentId for participant agent (unable to hydrate).");

      const owner = walletAddress.toLowerCase() as Address;
      const aa = (agentAccount as Address | null) ?? null;
      if (!aa) throw new Error("Missing participant smart-account address (UAID parse failed).");

      const rpcUrl = getRpcUrlForChain(chainId);
      if (rpcUrl) {
        const publicClient = createPublicClient({ transport: http(rpcUrl) });
        let onchainOwner: string | null = null;
        try {
          onchainOwner = (await publicClient.readContract({ address: aa, abi: OWNER_ABI, functionName: "owner" })) as any;
        } catch {
          try {
            onchainOwner = (await publicClient.readContract({ address: aa, abi: GET_OWNER_ABI, functionName: "getOwner" })) as any;
          } catch {
            try {
              const owners = (await publicClient.readContract({ address: aa, abi: OWNERS_ABI, functionName: "owners" })) as any;
              if (Array.isArray(owners) && owners[0]) onchainOwner = String(owners[0]);
            } catch {
              // ignore
            }
          }
        }
        if (onchainOwner && typeof onchainOwner === "string" && onchainOwner.toLowerCase() !== owner.toLowerCase()) {
          throw new Error(`Connected wallet does not own this user smart account. Expected owner ${onchainOwner}, connected ${owner}.`);
        }
      }

      const pkg = await generateSessionPackage({
        agentId: effectiveAgentId,
        chainId,
        agentAccount: aa,
        provider: eip1193Provider,
        ownerAddress: owner,
        bundlerUrl: getBundlerUrlForChain(chainId),
        rpcUrl: getRpcUrlForChain(chainId),
        identityRegistry: getIdentityRegistryForChain(chainId) as any,
        reputationRegistry: getReputationRegistryForChain(chainId) as any,
        validationRegistry: getValidationRegistryForChain(chainId) as any,
      } as any);

      setSessionPkg(pkg);
      await handlePersistSessionPackage(pkg);
    } catch (e: any) {
      setSessionError(e?.message || String(e));
    }
  }, [participantUaid, walletAddress, web3auth, agentAccount, chainId, agentId, handlePersistSessionPackage, handleRefreshAgentDetails, agentDetails]);

  const handleSaveSessionPackage = React.useCallback(async () => {
    setSessionError(null);
    if (!sessionPkg) {
      setSessionError("No session package generated yet.");
      return;
    }
    try {
      await handlePersistSessionPackage(sessionPkg);
    } catch (e: any) {
      setSessionError(e?.message || String(e));
    }
  }, [sessionPkg, handlePersistSessionPackage]);

  const canUseAgent = Boolean(participantUaid && agentAccount);

  return (
    <main>
      <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 } }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: -0.3 }}>
              User Settings
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Manage your user profile and user agent.
            </Typography>
          </Box>

          {!user ? (
            <Alert severity="warning">
              Not connected. Go to <Link href="/onboarding">onboarding</Link>.
            </Alert>
          ) : null}

          {error ? <Alert severity="error">{error}</Alert> : null}

          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12} md={7}>
                  <Typography sx={{ fontWeight: 800, mb: 0.5 }}>User agent summary</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip label={`Role: ${role ?? "unknown"}`} />
                    {walletAddress ? <Chip label={walletAddress} variant="outlined" /> : null}
                    {participantUaid ? <Chip label={`UAID: ${participantUaid}`} variant="outlined" /> : null}
                    <Chip label={`chain ${chainId}`} variant="outlined" />
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Agent: <strong>{participantAgentName ?? "—"}</strong>
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    ENS: <strong>{participantEns ?? "—"}</strong>
                  </Typography>
                </Grid>
                <Grid item xs={12} md={5}>
                  <Stack direction="row" spacing={1} justifyContent={{ xs: "flex-start", md: "flex-end" }}>
                    <Button component={Link} href="/user-tools" variant="outlined">
                      User Tools
                    </Button>
                    <Button component={Link} href="/app" variant="outlined">
                      Workspace
                    </Button>
                  </Stack>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent sx={{ pb: 0 }}>
              <Tabs value={tab} onChange={(_, v) => setTab(v as UserSettingsTab)} sx={{ mb: 1 }}>
                <Tab value="user" label="User" />
                <Tab value="capabilities" label="Capabilities" />
                <Tab value="agent" label="Agent" sx={{ ml: "auto" }} />
              </Tabs>
            </CardContent>
            <Divider />
            <CardContent>
              {profileLoading ? (
                <Typography variant="body2" color="text.secondary">
                  Loading…
                </Typography>
              ) : tab === "user" ? (
                <Stack spacing={2}>
                  <TextField label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} fullWidth />
                  <TextField label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} fullWidth />
                  <TextField
                    label="User role"
                    select
                    value={role ?? ""}
                    onChange={async (e) => {
                      const v = String(e.target.value || "");
                      if (!v) return;
                      await setRole(v as any);
                    }}
                    SelectProps={{ native: true }}
                    InputLabelProps={{ shrink: true }}
                    fullWidth
                  >
                    <option value="org_admin">Organization Admin</option>
                    <option value="coordinator">Coalition Coordinator</option>
                    <option value="contributor">Contributor</option>
                    <option value="funder">Grantmaker</option>
                    <option value="admin">System Administrator</option>
                  </TextField>

                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" onClick={() => void handleSaveUser()} disabled={saving || !walletAddress}>
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  </Stack>
                </Stack>
              ) : tab === "capabilities" ? (
                <UserCapabilitiesEditor individualId={individualId} role={role} />
              ) : (
                <Stack spacing={2}>
                  <Typography sx={{ fontWeight: 800 }}>Agent</Typography>
                  <Typography variant="body2" color="text.secondary">
                    UAID is canonical. This view hydrates agent details by UAID.
                  </Typography>

                  {!canUseAgent ? (
                    <Alert severity="warning">
                      Missing participant UAID / account. Complete onboarding, then reconnect so your participant agent can be hydrated.
                    </Alert>
                  ) : null}

                  {agentDetailsError ? <Alert severity="error">{agentDetailsError}</Alert> : null}
                  {agentCardError ? <Alert severity="error">{agentCardError}</Alert> : null}
                  {a2aStatusError ? <Alert severity="error">{a2aStatusError}</Alert> : null}
                  {a2aStatusResult ? <Alert severity="success">A2A status: success</Alert> : null}

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button variant="contained" onClick={() => void handleRefreshAgentDetails()} disabled={saving || agentDetailsLoading || !participantUaid}>
                      {agentDetailsLoading ? "Refreshing…" : "Refresh agent info"}
                    </Button>
                    <Button variant="outlined" onClick={() => void handleGetA2aAgentCardJson()} disabled={saving || agentCardLoading || !participantUaid}>
                      {agentCardLoading ? "Fetching agent card…" : "Get A2A agent card JSON"}
                    </Button>
                    <Button variant="outlined" onClick={() => void handleCheckA2aStatus()} disabled={saving || a2aStatusLoading || !participantUaid}>
                      {a2aStatusLoading ? "Checking status…" : "Check A2A status"}
                    </Button>
                  </Stack>

                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Typography sx={{ fontWeight: 800, mb: 1 }}>Identifiers</Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {participantAgentName ? <Chip label={participantAgentName} /> : null}
                        <Chip label={`chain ${chainId}`} variant="outlined" />
                        {participantUaid ? <Chip label={`UAID: ${participantUaid}`} variant="outlined" /> : null}
                        {agentId != null ? <Chip label={`agentId: ${agentId}`} variant="outlined" /> : null}
                        {agentAccount ? <Chip label={`account: ${agentAccount}`} variant="outlined" /> : null}
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        ENS: <strong>{participantEns ?? "—"}</strong>
                      </Typography>
                    </CardContent>
                  </Card>

                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Typography sx={{ fontWeight: 800 }}>Session package</Typography>
                      {sessionError ? (
                        <Alert severity="error" sx={{ mt: 1 }}>
                          {sessionError}
                        </Alert>
                      ) : null}
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                        <Button variant="contained" onClick={() => void handleGenerateSessionPackage()} disabled={saving || !canUseAgent}>
                          Generate + save session package
                        </Button>
                        <Button variant="outlined" onClick={() => void handleSaveSessionPackage()} disabled={saving || !sessionPkg || !canUseAgent}>
                          Save to agent record
                        </Button>
                      </Stack>
                    </CardContent>
                  </Card>

                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Typography sx={{ fontWeight: 800, mb: 1 }}>Hydrated agent details (by UAID)</Typography>
                      <pre style={{ margin: 0, overflowX: "auto", fontSize: 12 }}>
                        {JSON.stringify(agentDetails ?? { message: "none" }, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>

                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Typography sx={{ fontWeight: 800, mb: 1 }}>A2A agent card JSON</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {agentCardUrl ? `Source: ${agentCardUrl}` : "Source: (not fetched yet)"}
                      </Typography>
                      <pre style={{ margin: 0, overflowX: "auto", fontSize: 12 }}>
                        {JSON.stringify(agentCardJson ?? { message: "none" }, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>

                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Typography sx={{ fontWeight: 800, mb: 1 }}>Current session package</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        Stored on agent: {existingSession ? "yes" : "no"}
                      </Typography>
                      <pre style={{ margin: 0, overflowX: "auto", fontSize: 12 }}>
                        {JSON.stringify(sessionPkg ?? existingSession ?? { message: "none" }, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                </Stack>
              )}
            </CardContent>
          </Card>

          {individualId == null ? (
            <Alert severity="info">No individual profile found yet. Complete onboarding.</Alert>
          ) : null}
        </Stack>
      </Box>
    </main>
  );
}

