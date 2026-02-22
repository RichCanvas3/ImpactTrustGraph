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
import { useConnection } from "../../components/connection-context";
import { useDefaultOrgAgent } from "../../components/useDefaultOrgAgent";
import { useCurrentUserProfile } from "../../components/useCurrentUserProfile";
import { useWeb3Auth } from "../../components/Web3AuthProvider";
import {
  getUserOrganizationsByIndividualId,
  upsertUserOrganizationByIndividualId,
  type OrganizationAssociation,
} from "../service/userProfileService";
import { generateSessionPackage } from "@agentic-trust/core";
import { createPublicClient, http } from "viem";
import type { Address } from "viem";
import { parseUaidParts } from "../../lib/uaid";

type OrgSettingsTab = "settings" | "operations" | "agent";

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
      // handle "123" or bigint-like strings
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
  {
    name: "owners",
    type: "function",
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
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

export default function OrganizationSettingsPage() {
  const { user } = useConnection();
  const { web3auth } = useWeb3Auth();
  const { defaultOrgAgent } = useDefaultOrgAgent();
  const { walletAddress, profile } = useCurrentUserProfile();
  const individualId = React.useMemo(() => {
    const raw = (profile as any)?.id;
    if (raw == null) return null;
    const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [profile]);

  const [tab, setTab] = React.useState<OrgSettingsTab>("settings");
  const [organization, setOrganization] = React.useState<OrganizationAssociation | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Editable org fields (stored in organizations table via /api/users/organizations).
  const [orgName, setOrgName] = React.useState("");
  const [orgAddress, setOrgAddress] = React.useState("");
  const [orgType, setOrgType] = React.useState("");

  // Operations
  const [sessionPkg, setSessionPkg] = React.useState<any | null>(null);
  const [sessionError, setSessionError] = React.useState<string | null>(null);
  const [agentCardJson, setAgentCardJson] = React.useState<any | null>(null);
  const [agentCardUrl, setAgentCardUrl] = React.useState<string | null>(null);
  const [agentCardLoading, setAgentCardLoading] = React.useState(false);
  const [agentCardError, setAgentCardError] = React.useState<string | null>(null);
  const [a2aStatusLoading, setA2aStatusLoading] = React.useState(false);
  const [a2aStatusError, setA2aStatusError] = React.useState<string | null>(null);
  const [a2aStatusResult, setA2aStatusResult] = React.useState<any | null>(null);
  const [agentDetails, setAgentDetails] = React.useState<any | null>(null);
  const [agentDetailsLoading, setAgentDetailsLoading] = React.useState(false);
  const [agentDetailsError, setAgentDetailsError] = React.useState<string | null>(null);

  const agentHydrateKeyRef = React.useRef<string | null>(null);
  const agentDetailsKeyRef = React.useRef<string | null>(null);

  const hydrateKeyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!individualId) {
      setOrganization(null);
      setLoading(false);
      hydrateKeyRef.current = null;
      return;
    }
    const desiredEns = typeof defaultOrgAgent?.ensName === "string" ? defaultOrgAgent.ensName.toLowerCase() : "";
    const hydrateKey = `${individualId}:${desiredEns}`;
    if (hydrateKeyRef.current === hydrateKey) return;

    const ac = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const orgs = await getUserOrganizationsByIndividualId(individualId);
        if (ac.signal.aborted) return;
        const primary = orgs.find((o) => o.is_primary) ?? orgs[0] ?? null;
        const match =
          desiredEns && orgs.length > 0
            ? orgs.find((o) => String(o.ens_name || "").toLowerCase() === desiredEns) ?? null
            : null;
        const selected = match ?? primary;
        setOrganization(selected);
        setOrgName(selected?.org_name ?? "");
        setOrgAddress(selected?.org_address ?? "");
        setOrgType(selected?.org_type ?? "");
        hydrateKeyRef.current = hydrateKey; // cache only after success
      } catch (e: any) {
        if (e?.name !== "AbortError") setError(e?.message || String(e));
        hydrateKeyRef.current = null;
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      ac.abort();
      setLoading(false);
      hydrateKeyRef.current = null; // allow retry after abort/reconnect
    };
  }, [individualId, defaultOrgAgent?.ensName]);

  const uaid = organization?.uaid ?? null;
  const ensName = organization?.ens_name ?? defaultOrgAgent?.ensName ?? null;
  const agentName = organization?.agent_name ?? defaultOrgAgent?.agentName ?? null;
  const parsedUaid = parseUaidParts(uaid);
  const agentAccount = defaultOrgAgent?.agentAccount ?? parsedUaid?.agentAccount ?? null;
  const chainId = (defaultOrgAgent?.chainId ?? parsedUaid?.chainId ?? 11155111) as number;
  const agentId = React.useMemo(() => coerceAgentIdToNumber(defaultOrgAgent?.agentId) ?? null, [defaultOrgAgent?.agentId]);

  const hydrateSelectedOrg = React.useCallback(async () => {
    if (!individualId) throw new Error("Missing individualId (profile not hydrated).");
    if (!organization?.ens_name) throw new Error("Missing organization ENS name.");
    const effectiveUaid = typeof organization.uaid === "string" && organization.uaid.trim() ? organization.uaid.trim() : null;
    if (!effectiveUaid) {
      throw new Error("Missing UAID for selected organization agent (unable to hydrate).");
    }

    // UAID → agent details (contains agentId). This is the canonical hydration path.
    const agentResp = await fetch(`/api/agents/by-uaid/${encodeURIComponent(effectiveUaid)}`);
    const agentData = agentResp.ok ? await agentResp.json().catch(() => null) : null;
    const hydratedAgentId =
      agentData && agentData.found === true ? coerceAgentIdToNumber((agentData as any)?.agentId ?? (agentData as any)?.agent?.agentId ?? null) : null;

    // Persist to organizations + individual_organizations (no email/EOA)
    await upsertUserOrganizationByIndividualId({
      individual_id: individualId,
      ens_name: organization.ens_name,
      agent_name: organization.agent_name,
      org_name: organization.org_name ?? null,
      org_address: organization.org_address ?? null,
      org_type: organization.org_type ?? null,
      uaid: effectiveUaid,
      session_package: organization.session_package ?? null,
      org_metadata: organization.org_metadata ?? null,
      is_primary: organization.is_primary,
      role: organization.role ?? null,
    });

    // Refresh local state
    const orgs = await getUserOrganizationsByIndividualId(individualId);
    const desiredEns = typeof defaultOrgAgent?.ensName === "string" ? defaultOrgAgent.ensName.toLowerCase() : "";
    const primary = orgs.find((o) => o.is_primary) ?? orgs[0] ?? null;
    const match =
      desiredEns && orgs.length > 0
        ? orgs.find((o) => String(o.ens_name || "").toLowerCase() === desiredEns) ?? null
        : null;
    const refreshed = match ?? primary;
    setOrganization(refreshed);

    return {
      agentId: hydratedAgentId,
      agentAccount: parseUaidParts(effectiveUaid)?.agentAccount ?? null,
      chainId: parseUaidParts(effectiveUaid)?.chainId ?? chainId,
      uaid: effectiveUaid,
    };
  }, [individualId, organization, chainId, defaultOrgAgent?.ensName]);

  // Self-heal: if org row is missing agent identifiers, hydrate from ENS + by-account and upsert.
  React.useEffect(() => {
    if (!organization) return;
    if (!organization.ens_name) return;
    const needsHydration =
      organization.agent_row_id == null;
    if (!needsHydration) return;

    if (!individualId) return;
    const resolvedChainId = Number(parseUaidParts(organization.uaid)?.chainId ?? chainId ?? 11155111);
    if (!Number.isFinite(resolvedChainId)) return;
    const key = `${individualId}:${resolvedChainId}:${String(organization.ens_name).toLowerCase()}`;
    if (agentHydrateKeyRef.current === key) return;
    agentHydrateKeyRef.current = key;

    let cancelled = false;
    (async () => {
      try {
        await hydrateSelectedOrg();
      } catch (e) {
        // Don't block page usage; just log.
        console.warn("[organization-settings] agent hydration failed:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [individualId, organization, chainId, defaultOrgAgent?.ensName, hydrateSelectedOrg]);

  const saveOrganization = React.useCallback(async () => {
    if (!individualId) {
      setError("Missing individualId. Reconnect and try again.");
      return;
    }
    if (!organization) {
      setError("No organization found to update.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated: OrganizationAssociation = {
        ...organization,
        org_name: orgName || undefined,
        org_address: orgAddress || undefined,
        org_type: orgType || undefined,
      };
      const effectiveUaid =
        typeof updated.uaid === "string" && updated.uaid.trim()
          ? updated.uaid.trim()
          : (await hydrateSelectedOrg()).uaid;
      await upsertUserOrganizationByIndividualId({
        individual_id: individualId,
        ens_name: updated.ens_name,
        agent_name: updated.agent_name,
        org_name: updated.org_name ?? null,
        org_address: updated.org_address ?? null,
        org_type: updated.org_type ?? null,
        uaid: effectiveUaid,
        session_package: updated.session_package ?? null,
        org_metadata: updated.org_metadata ?? null,
        is_primary: updated.is_primary,
        role: updated.role ?? null,
      });
      const orgs = await getUserOrganizationsByIndividualId(individualId);
      const primary = orgs.find((o) => o.is_primary) ?? orgs[0] ?? null;
      setOrganization(primary);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }, [individualId, organization, orgName, orgAddress, orgType]);

  const handleGenerateSessionPackage = React.useCallback(async () => {
    setSessionPkg(null);
    setSessionError(null);
    if (!ensName) {
      setSessionError("Missing organization ENS name. Select/set a default org agent first.");
      return;
    }
    if (!walletAddress) {
      setSessionError("Wallet address is required to generate a session package.");
      return;
    }
    if (!individualId) {
      setSessionError("Missing individualId (profile not hydrated).");
      return;
    }
    // Web3Auth sometimes restores `connected` state before `provider` is set.
    // Try to rehydrate provider by calling connect() (should be silent if already connected).
    if (web3auth && !(web3auth as any).provider && typeof (web3auth as any).connect === "function") {
      try {
        await (web3auth as any).connect();
      } catch {
        // ignore; we'll still fall back to window.ethereum if present
      }
    }

    const eip1193Provider =
      (web3auth as any)?.provider ?? (typeof window !== "undefined" ? (window as any).ethereum : null);
    if (!eip1193Provider) {
      setSessionError("An EIP-1193 provider is required to generate a session package.");
      return;
    }
    try {
      // Ensure we have a usable agentId (hydrate from KB if needed).
      let effectiveAgentId = agentId;
      if (!effectiveAgentId) {
        try {
          const hydrated = await hydrateSelectedOrg();
          effectiveAgentId = hydrated.agentId ?? null;
        } catch {
          // ignore; will error below
        }
      }
      if (!effectiveAgentId) {
        setSessionError("Missing agentId for selected organization agent (unable to hydrate). Re-select the org agent.");
        return;
      }

      const owner = walletAddress.toLowerCase() as Address;
      let aa = (agentAccount as Address | null) ?? null;
      if (!aa) {
        const didEns = `did:ens:${chainId}:${ensName}`;
        const ensResp = await fetch(`/api/names/${encodeURIComponent(didEns)}`);
        if (!ensResp.ok) {
          throw new Error("Missing agent smart-account address for selected org (ENS lookup failed).");
        }
        const ensData = await ensResp.json().catch(() => null);
        const resolved = ensData?.nameInfo?.account;
        if (!resolved || typeof resolved !== "string" || !resolved.startsWith("0x")) {
          throw new Error("Missing agent smart-account address for selected org.");
        }
        aa = resolved.toLowerCase() as Address;
      }

      // Preflight: ensure the connected EOA is actually an owner of the org smart account.
      // If this is wrong, the delegation redemption will revert in simulation with an opaque selector.
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
              // ignore; not all accounts expose an owner() view
            }
          }
        }
        if (onchainOwner && typeof onchainOwner === "string" && onchainOwner.toLowerCase() !== owner.toLowerCase()) {
          throw new Error(
            `Connected wallet does not own the selected org smart account. Expected owner ${onchainOwner}, connected ${owner}.`,
          );
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

      // Persist immediately (org + canonical agents row).
      if (organization) {
        const effectiveUaid =
          typeof organization.uaid === "string" && organization.uaid.trim()
            ? organization.uaid.trim()
            : (await hydrateSelectedOrg()).uaid;
        await upsertUserOrganizationByIndividualId({
          individual_id: individualId,
          ens_name: organization.ens_name,
          agent_name: organization.agent_name,
          org_name: organization.org_name ?? null,
          org_address: organization.org_address ?? null,
          org_type: organization.org_type ?? null,
          uaid: effectiveUaid,
          session_package: JSON.stringify(pkg),
          org_metadata: organization.org_metadata ?? null,
          is_primary: organization.is_primary,
          role: organization.role ?? null,
        });
        const orgs = await getUserOrganizationsByIndividualId(individualId);
        const desiredEns = typeof defaultOrgAgent?.ensName === "string" ? defaultOrgAgent.ensName.toLowerCase() : "";
        const primary = orgs.find((o) => o.is_primary) ?? orgs[0] ?? null;
        const match =
          desiredEns && orgs.length > 0
            ? orgs.find((o) => String(o.ens_name || "").toLowerCase() === desiredEns) ?? null
            : null;
        setOrganization(match ?? primary);
      }
    } catch (e: any) {
      setSessionError(e?.message || String(e));
    }
  }, [
    agentAccount,
    agentId,
    chainId,
    web3auth,
    walletAddress,
    organization,
    defaultOrgAgent?.ensName,
    ensName,
    individualId,
    hydrateSelectedOrg,
  ]);

  const handleGetA2aAgentCardJson = React.useCallback(async () => {
    setAgentCardJson(null);
    setAgentCardUrl(null);
    setAgentCardError(null);
    setAgentCardLoading(true);
    try {
      if (!individualId) throw new Error("Missing individualId (profile not hydrated).");
      const effectiveUaid =
        typeof organization?.uaid === "string" && organization.uaid.trim()
          ? organization.uaid.trim()
          : (await hydrateSelectedOrg()).uaid;
      if (!effectiveUaid) throw new Error("Missing UAID for selected organization agent (unable to hydrate).");

      const res = await fetch(`/api/agents/a2a-card/${encodeURIComponent(effectiveUaid)}`, { method: "GET" });
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
  }, [individualId, organization?.uaid, hydrateSelectedOrg]);

  const handleCheckA2aStatus = React.useCallback(async () => {
    setA2aStatusError(null);
    setA2aStatusResult(null);
    setA2aStatusLoading(true);
    try {
      if (!individualId) throw new Error("Missing individualId (profile not hydrated).");
      const effectiveUaid =
        typeof organization?.uaid === "string" && organization.uaid.trim()
          ? organization.uaid.trim()
          : (await hydrateSelectedOrg()).uaid;
      if (!effectiveUaid) throw new Error("Missing UAID for selected organization agent (unable to hydrate).");

      const res = await fetch(`/api/agents/a2a-status/${encodeURIComponent(effectiveUaid)}`, { method: "GET" });
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
  }, [individualId, organization?.uaid, hydrateSelectedOrg]);

  const handleRefreshAgentDetails = React.useCallback(async () => {
    setAgentDetails(null);
    setAgentDetailsError(null);
    setAgentDetailsLoading(true);
    try {
      if (!individualId) throw new Error("Missing individualId (profile not hydrated).");
      const effectiveUaid =
        typeof organization?.uaid === "string" && organization.uaid.trim()
          ? organization.uaid.trim()
          : (await hydrateSelectedOrg()).uaid;
      if (!effectiveUaid) throw new Error("Missing UAID for selected organization agent (unable to hydrate).");

      const key = `${individualId}:${effectiveUaid}`;
      agentDetailsKeyRef.current = key;

      const res = await fetch(`/api/agents/by-uaid/${encodeURIComponent(effectiveUaid)}`, { method: "GET" });
      const json = await res.json().catch(() => null as any);
      if (!res.ok || !json || json.found !== true) {
        throw new Error(json?.message || json?.error || `Failed to hydrate agent details (${res.status})`);
      }
      setAgentDetails(json);
    } catch (e: any) {
      setAgentDetailsError(e?.message || String(e));
    } finally {
      setAgentDetailsLoading(false);
    }
  }, [individualId, organization?.uaid, hydrateSelectedOrg]);

  React.useEffect(() => {
    if (tab !== "agent") return;
    if (!individualId) return;
    const effectiveUaid = typeof organization?.uaid === "string" && organization.uaid.trim() ? organization.uaid.trim() : null;
    if (!effectiveUaid) return;
    const key = `${individualId}:${effectiveUaid}`;
    if (agentDetailsKeyRef.current === key && agentDetails) return;
    void handleRefreshAgentDetails();
  }, [tab, individualId, organization?.uaid, agentDetails, handleRefreshAgentDetails]);

  const handleSaveSessionPackage = React.useCallback(async () => {
    if (!walletAddress) {
      setSessionError("Missing wallet address.");
      return;
    }
    if (!individualId) {
      setSessionError("Missing individualId (profile not hydrated).");
      return;
    }
    if (!organization) {
      setSessionError("No organization found.");
      return;
    }
    if (!sessionPkg) {
      setSessionError("No session package generated yet.");
      return;
    }
    setSaving(true);
    setSessionError(null);
    try {
      // Persist into organizations + agents tables (route upserts agents row now).
      const effectiveUaid =
        typeof organization.uaid === "string" && organization.uaid.trim()
          ? organization.uaid.trim()
          : (await hydrateSelectedOrg()).uaid;
      await upsertUserOrganizationByIndividualId({
        individual_id: individualId,
        ens_name: organization.ens_name,
        agent_name: organization.agent_name,
        org_name: organization.org_name ?? null,
        org_address: organization.org_address ?? null,
        org_type: organization.org_type ?? null,
        uaid: effectiveUaid,
        session_package: JSON.stringify(sessionPkg),
        org_metadata: organization.org_metadata ?? null,
        is_primary: organization.is_primary,
        role: organization.role ?? null,
      });
      const orgs = await getUserOrganizationsByIndividualId(individualId);
      const desiredEns = typeof defaultOrgAgent?.ensName === "string" ? defaultOrgAgent.ensName.toLowerCase() : "";
      const primary = orgs.find((o) => o.is_primary) ?? orgs[0] ?? null;
      const match =
        desiredEns && orgs.length > 0
          ? orgs.find((o) => String(o.ens_name || "").toLowerCase() === desiredEns) ?? null
          : null;
      setOrganization(match ?? primary);
    } catch (e: any) {
      setSessionError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }, [walletAddress, individualId, organization, sessionPkg, agentAccount, chainId, defaultOrgAgent?.ensName]);

  const existingSession = React.useMemo(() => {
    const raw = organization?.session_package ?? null;
    return safeParseJson(raw);
  }, [organization?.session_package]);

  return (
    <main>
      <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 } }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: -0.3 }}>
              Organization Settings
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Manage your selected organization agent and operations.
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
                  <Typography sx={{ fontWeight: 800, mb: 0.5 }}>Selected organization agent</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip label={agentName ?? "—"} />
                    <Chip label={`chain ${chainId}`} variant="outlined" />
                    {uaid ? <Chip label={`UAID: ${uaid}`} variant="outlined" /> : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    ENS: <strong>{ensName ?? "—"}</strong>
                  </Typography>
                </Grid>
                <Grid item xs={12} md={5}>
                  <Stack direction="row" spacing={1} justifyContent={{ xs: "flex-start", md: "flex-end" }}>
                    <Button component={Link} href="/dashboard" variant="outlined">
                      Dashboard
                    </Button>
                    <Button component={Link} href="/agents" variant="outlined">
                      Agent Registry
                    </Button>
                  </Stack>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent sx={{ pb: 0 }}>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1 }}>
                <Tab value="settings" label="Organization" />
                <Tab value="operations" label="Operations" />
                <Tab value="agent" label="Agent" sx={{ ml: "auto" }} />
              </Tabs>
            </CardContent>
            <Divider />
            <CardContent>
              {loading ? (
                <Typography variant="body2" color="text.secondary">
                  Loading…
                </Typography>
              ) : tab === "settings" ? (
                <Stack spacing={2}>
                  <TextField
                    label="Organization name"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    fullWidth
                  />
                  <TextField
                    label="Organization address"
                    value={orgAddress}
                    onChange={(e) => setOrgAddress(e.target.value)}
                    fullWidth
                  />
                  <TextField
                    label="Organization type"
                    value={orgType}
                    onChange={(e) => setOrgType(e.target.value)}
                    placeholder="e.g. coalition, nonprofit, foundation"
                    fullWidth
                  />
                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" onClick={() => void saveOrganization()} disabled={saving || !organization}>
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  </Stack>
                </Stack>
              ) : tab === "agent" ? (
                <Stack spacing={2}>
                  <Typography sx={{ fontWeight: 800 }}>Agent information</Typography>
                  <Typography variant="body2" color="text.secondary">
                    UAID is canonical. This view hydrates agent details by UAID (like the admin app agent details page).
                  </Typography>

                  {agentDetailsError ? <Alert severity="error">{agentDetailsError}</Alert> : null}
                  {agentCardError ? <Alert severity="error">{agentCardError}</Alert> : null}
                  {a2aStatusError ? <Alert severity="error">{a2aStatusError}</Alert> : null}
                  {a2aStatusResult ? <Alert severity="success">A2A status: success</Alert> : null}

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button
                      variant="contained"
                      onClick={() => void handleRefreshAgentDetails()}
                      disabled={saving || agentDetailsLoading}
                    >
                      {agentDetailsLoading ? "Refreshing…" : "Refresh agent info"}
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={() => void handleGetA2aAgentCardJson()}
                      disabled={saving || agentCardLoading}
                    >
                      {agentCardLoading ? "Fetching agent card…" : "Get A2A agent card JSON"}
                    </Button>
                    <Button variant="outlined" onClick={() => void handleCheckA2aStatus()} disabled={saving || a2aStatusLoading}>
                      {a2aStatusLoading ? "Checking status…" : "Check A2A status"}
                    </Button>
                  </Stack>

                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Typography sx={{ fontWeight: 800, mb: 1 }}>Identifiers</Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip label={agentName ?? "—"} />
                        <Chip label={`chain ${chainId}`} variant="outlined" />
                        {uaid ? <Chip label={`UAID: ${uaid}`} variant="outlined" /> : null}
                        {agentId != null ? <Chip label={`agentId: ${agentId}`} variant="outlined" /> : null}
                        {agentAccount ? <Chip label={`account: ${agentAccount}`} variant="outlined" /> : null}
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        ENS: <strong>{ensName ?? "—"}</strong>
                      </Typography>
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
                </Stack>
              ) : (
                <Stack spacing={2}>
                  <Typography sx={{ fontWeight: 800 }}>Agent operator</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Generate a session package and persist it to the canonical `agents` record (and organization record).
                  </Typography>

                  {sessionError ? <Alert severity="error">{sessionError}</Alert> : null}
                  {agentCardError ? <Alert severity="error">{agentCardError}</Alert> : null}
                  {a2aStatusError ? <Alert severity="error">{a2aStatusError}</Alert> : null}
                  {a2aStatusResult ? <Alert severity="success">A2A status: success</Alert> : null}

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button variant="contained" onClick={() => void handleGenerateSessionPackage()} disabled={saving}>
                      Generate + save session package
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={() => void handleGetA2aAgentCardJson()}
                      disabled={saving || agentCardLoading}
                    >
                      {agentCardLoading ? "Fetching agent card…" : "Get A2A agent card JSON"}
                    </Button>
                    <Button variant="outlined" onClick={() => void handleCheckA2aStatus()} disabled={saving || a2aStatusLoading}>
                      {a2aStatusLoading ? "Checking status…" : "Check A2A status"}
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={() => void handleSaveSessionPackage()}
                      disabled={saving || !sessionPkg}
                    >
                      Save to agent record
                    </Button>
                  </Stack>

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
                        Stored on org: {existingSession ? "yes" : "no"}
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
        </Stack>
      </Box>
    </main>
  );
}

