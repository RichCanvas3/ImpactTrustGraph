"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useConnection } from "../../components/connection-context";
import { useWeb3Auth } from "../../components/Web3AuthProvider";
import { useStandardConnect } from "../../components/useStandardConnect";
import { canonicalizeUaid } from "../../lib/uaid";

import {
  createAgentWithWallet,
  getCounterfactualSmartAccountAddressByAgentName
} from "@agentic-trust/core/client";
import { keccak256, stringToHex } from "viem";
import { sepolia } from "viem/chains";
import { IndivService } from "../service/indivService";
import {
  AttestationService,
  type TrustRelationshipAttestation
} from "../service/attestationService";
import {
  saveUserProfile,
  upsertUserOrganizationByIndividualUaid,
  getUserProfile,
  getUserOrganizations,
  type OrganizationAssociation,
  type UserProfile,
} from "../service/userProfileService";
import { useDefaultOrgAgent, type DefaultOrgAgent } from "../../components/useDefaultOrgAgent";
import { OrgAgentSelector } from "../../components/OrgAgentSelector";

type OrgRoleTag = "coalition" | "contributor" | "funding" | "member";

interface OrgDetails {
  name: string;
  address: string;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

type StakeholderRole = "coordinator" | "contributor" | "org-admin" | "funder" | "admin";

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, setUser } = useConnection();
  const {
    web3auth,
    isInitializing,
    error: authError,
    connect,
    logout,
  } = useWeb3Auth();

  const [step, setStep] = React.useState<Step>(1);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [isCheckingAvailability, setIsCheckingAvailability] = React.useState(false);
  const [org, setOrg] = React.useState<OrgDetails>({
    name: "",
    address: "",
  });
  const [orgRoles, setOrgRoles] = React.useState<OrgRoleTag[]>([]);
  const [itg, setItg] = React.useState<string | null>(null);
  const [walletAddress, setWalletAddress] = React.useState<string | null>(null);
  const [aaAddress, setAaAddress] = React.useState<string | null>(null);
  const [firstName, setFirstName] = React.useState<string>("");
  const [lastName, setLastName] = React.useState<string>("");
  const [isSavingStep2, setIsSavingStep2] = React.useState(false);
  const [existingIndividualProfile, setExistingIndividualProfile] = React.useState<UserProfile | null>(null);
  const [isCreatingItg, setIsCreatingItg] = React.useState(false);
  const [orgCreateStartedAtMs, setOrgCreateStartedAtMs] = React.useState<number | null>(null);
  const [orgCreateProgress, setOrgCreateProgress] = React.useState(0);
  const [orgCreateStatus, setOrgCreateStatus] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);

  const urlRole = React.useMemo<StakeholderRole | null>(() => {
    const raw = searchParams?.get("role")?.trim().toLowerCase() ?? "";
    if (!raw) return null;
    if (raw === "coordinator") return "coordinator";
    if (raw === "contributor") return "contributor";
    if (raw === "org-admin" || raw === "organization-admin" || raw === "organization") return "org-admin";
    if (raw === "funder" || raw === "grantmaker" || raw === "funder-grantmaker") return "funder";
    if (raw === "admin" || raw === "system-admin") return "admin";
    return null;
  }, [searchParams]);

  // Persist the requested onboarding role so it doesn't silently fall back
  // to stale DB role values when navigating to /onboarding without params.
  const [stickyRequestedRole, setStickyRequestedRole] = React.useState<StakeholderRole | null>(null);
  React.useEffect(() => {
    if (!urlRole) return;
    setStickyRequestedRole(urlRole);
    try {
      if (typeof window !== "undefined") {
        sessionStorage.setItem("itg_onboarding_requested_role", urlRole);
      }
    } catch {
      // ignore
    }
  }, [urlRole]);

  React.useEffect(() => {
    if (stickyRequestedRole) return;
    try {
      if (typeof window !== "undefined") {
        const raw = sessionStorage.getItem("itg_onboarding_requested_role");
        if (
          raw === "coordinator" ||
          raw === "contributor" ||
          raw === "org-admin" ||
          raw === "funder" ||
          raw === "admin"
        ) {
          setStickyRequestedRole(raw);
        }
      }
    } catch {
      // ignore
    }
  }, [stickyRequestedRole]);

  const effectiveRole: StakeholderRole = React.useMemo(() => {
    if (urlRole) return urlRole;
    if (stickyRequestedRole) return stickyRequestedRole;
    const profRoleRaw = typeof existingIndividualProfile?.role === "string" ? existingIndividualProfile.role : "";
    const profRole = profRoleRaw.trim().toLowerCase();
    if (profRole === "coordinator") return "coordinator";
    if (profRole === "contributor") return "contributor";
    if (profRole === "org-admin" || profRole === "organization-admin" || profRole === "organization") return "org-admin";
    if (profRole === "funder" || profRole === "grantmaker") return "funder";
    if (profRole === "admin" || profRole === "system-admin") return "admin";
    return "org-admin";
  }, [urlRole, stickyRequestedRole, existingIndividualProfile?.role]);

  const roleLabel = React.useMemo(() => {
    switch (effectiveRole) {
      case "coordinator":
        return "Coordinator";
      case "contributor":
        return "Contributor";
      case "funder":
        return "Funder / Grantmaker";
      case "admin":
        return "System Admin";
      case "org-admin":
      default:
        return "Organization Admin";
    }
  }, [effectiveRole]);

  // Role-specific participant fields (stored in individuals.participant_metadata as JSON).
  const [contributorSkills, setContributorSkills] = React.useState<string>("");
  const [contributorAvailabilityHours, setContributorAvailabilityHours] = React.useState<string>("");
  const [contributorEngagementPreferences, setContributorEngagementPreferences] = React.useState<string>("");

  const [coordinatorCoalitionName, setCoordinatorCoalitionName] = React.useState<string>("");
  const [coordinatorScope, setCoordinatorScope] = React.useState<string>("");

  const [funderEntityName, setFunderEntityName] = React.useState<string>("");

  // Helpful defaults by role.
  React.useEffect(() => {
    // org type was removed; no-op (roles are selected explicitly below).
    setOrg((prev) => prev);
  }, [effectiveRole]);

  const defaultOrgRoleForIndividual = React.useMemo<OrgRoleTag>(() => {
    switch (effectiveRole) {
      case "coordinator":
        return "coalition";
      case "contributor":
        return "contributor";
      case "funder":
        return "funding";
      case "admin":
      case "org-admin":
      default:
        return "member";
    }
  }, [effectiveRole]);

  // Participant agent (created for the individual onboarding)
  const [participantAgentName, setParticipantAgentName] = React.useState<string>("");
  const [isCreatingParticipant, setIsCreatingParticipant] = React.useState(false);
  const [participantEnsName, setParticipantEnsName] = React.useState<string | null>(null);
  const [participantUaid, setParticipantUaid] = React.useState<string | null>(null);
  const [participantCreateStartedAtMs, setParticipantCreateStartedAtMs] = React.useState<number | null>(null);
  const [participantCreateProgress, setParticipantCreateProgress] = React.useState(0);
  const [participantCreateStatus, setParticipantCreateStatus] = React.useState<string>("");
  const [participantEnsAvailability, setParticipantEnsAvailability] = React.useState<{
    checking: boolean;
    available: boolean | null;
    ensName: string | null;
  }>({ checking: false, available: null, ensName: null });

  React.useEffect(() => {
    if (!isCreatingParticipant || participantCreateStartedAtMs == null) {
      setParticipantCreateProgress(0);
      return;
    }
    const DURATION_MS = 3 * 60 * 1000; // 3 minutes
    const tick = () => {
      const elapsed = Date.now() - participantCreateStartedAtMs;
      setParticipantCreateProgress(Math.max(0, Math.min(1, elapsed / DURATION_MS)));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [isCreatingParticipant, participantCreateStartedAtMs]);

  // Organization agent (existing flow)
  const [orgEnsAvailability, setOrgEnsAvailability] = React.useState<{
    checking: boolean;
    available: boolean | null;
    ensName: string | null;
  }>({ checking: false, available: null, ensName: null });
  const [customAgentName, setCustomAgentName] = React.useState<string>("");
  const [orgUaid, setOrgUaid] = React.useState<string | null>(null);

  const [orgChoice, setOrgChoice] = React.useState<"connect" | "skip" | "create">("create");
  const [userOrganizations, setUserOrganizations] = React.useState<OrganizationAssociation[]>([]);
  const [isLoadingOrganizations, setIsLoadingOrganizations] = React.useState(false);
  const [showOrgConnectSelector, setShowOrgConnectSelector] = React.useState(false);

  // Step 5: auto-set organization role based on the individual's role.
  React.useEffect(() => {
    if (step !== 5) return;
    if (orgChoice !== "create") return;
    setOrgRoles([defaultOrgRoleForIndividual]);
  }, [step, orgChoice, defaultOrgRoleForIndividual]);

  React.useEffect(() => {
    if (!isCreatingItg || orgCreateStartedAtMs == null) {
      setOrgCreateProgress(0);
      return;
    }
    const DURATION_MS = 3 * 60 * 1000; // 3 minutes
    const tick = () => {
      const elapsed = Date.now() - orgCreateStartedAtMs;
      setOrgCreateProgress(Math.max(0, Math.min(1, elapsed / DURATION_MS)));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [isCreatingItg, orgCreateStartedAtMs]);

  const [orgSearchQuery, setOrgSearchQuery] = React.useState<string>("");
  const [orgSearchResults, setOrgSearchResults] = React.useState<any[]>([]);
  const [orgSearchLoading, setOrgSearchLoading] = React.useState(false);
  const [orgSearchError, setOrgSearchError] = React.useState<string | null>(null);

  const emailDomain = React.useMemo(() => {
    if (!user?.email) return null;
    const parts = user.email.split("@");
    if (parts.length !== 2) return null;
    return parts[1].toLowerCase();
  }, [user?.email]);

  const userEmail = React.useMemo(() => {
    const raw = typeof user?.email === "string" ? user.email.trim() : "";
    if (!raw) return null;
    if (raw.toLowerCase() === "unknown@example.com") return null;
    if (!raw.includes("@")) return null;
    return raw;
  }, [user?.email]);

  const userPhone = React.useMemo(() => {
    const raw = typeof user?.name === "string" ? user.name.trim() : "";
    if (!raw) return null;
    // Matches values like "+1-3039446151" or "(303) 944-6151"
    return /^\+?[0-9][0-9\-\s()]{6,}$/.test(raw) ? raw : null;
  }, [user?.name]);

  const normalizedOrgAgentName = React.useMemo(() => customAgentName.trim(), [customAgentName]);
  const normalizedParticipantAgentName = React.useMemo(
    () => participantAgentName.trim(),
    [participantAgentName],
  );

  const suggestedParticipantAgentName = React.useMemo(() => {
    const first = firstName.trim().toLowerCase();
    const last = lastName.trim().toLowerCase();
    const base = [first, last].filter(Boolean).join("-");
    // ENS-label-safe-ish: keep a-z0-9-, collapse separators, trim.
    return base
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }, [firstName, lastName]);

  const isValidAgentName = React.useCallback((name: string) => {
    // Keep onboarding simple: require an ENS-label-safe name.
    // No auto-suffixing (e.g. "-itg") and no derivation from email domain.
    return /^[a-z0-9-]{3,63}$/.test(name) && !name.includes('--') && !name.startsWith('-') && !name.endsWith('-');
  }, []);

  // Default participant agent name from first/last (one-time, don't overwrite edits).
  React.useEffect(() => {
    if (step !== 3) return;
    if (participantAgentName.trim()) return;
    if (!suggestedParticipantAgentName) return;
    setParticipantAgentName(suggestedParticipantAgentName);
  }, [step, participantAgentName, suggestedParticipantAgentName]);

  // Surface any underlying Web3Auth initialization errors into the local error UI.
  React.useEffect(() => {
    if (authError) {
      setError(authError);
    }
  }, [authError]);

  // Removed automatic redirect - users should complete onboarding flow manually

  // If user is already connected when page loads, skip to step 2
  React.useEffect(() => {
    if (user && web3auth && step === 1) {
      // User is already connected, move to step 2
      // Try to get wallet address if not already set
      if (!walletAddress) {
        const provider = (web3auth as any)?.provider as
          | { request: (args: { method: string; params?: any[] }) => Promise<any> }
          | undefined;
        if (provider) {
          provider
            .request({ method: "eth_accounts" })
            .then(async (accounts) => {
              const account = Array.isArray(accounts) && accounts[0];
              if (account && typeof account === "string") {
                setWalletAddress(account);
                // Update user profile with EOA address immediately
                if (user?.email) {
                  try {
                    await saveUserProfile({
                      email: user.email,
                      eoa_address: account,
                    });
                  } catch (error) {
                    console.warn("Failed to update user profile with EOA address:", error);
                  }
                }
              }
            })
            .catch((e) => {
              console.warn("Failed to get wallet address:", e);
            });
        }
      }
      setStep(2);
    }
  }, [user, web3auth, step, walletAddress]);

  // Save profile details to database when they change on step 2
  React.useEffect(() => {
    if (step === 2 && (walletAddress || userEmail)) {
      // Debounce: only save after user stops typing for 500ms
      const timeoutId = setTimeout(async () => {
        try {
          const effectiveParticipantUaid =
            (typeof participantUaid === "string" && participantUaid.trim()
              ? participantUaid.trim()
              : typeof (existingIndividualProfile as any)?.participant_uaid === "string" && String((existingIndividualProfile as any).participant_uaid).trim()
                ? String((existingIndividualProfile as any).participant_uaid).trim()
                : null);
          const payload: UserProfile = {
            ...(typeof (existingIndividualProfile as any)?.id === "number" &&
            Number.isFinite((existingIndividualProfile as any).id) &&
            (existingIndividualProfile as any).id > 0
              ? { id: (existingIndividualProfile as any).id }
              : {}),
            ...(userEmail ? { email: userEmail } : {}),
            role: effectiveRole,
            first_name: firstName || null,
            last_name: lastName || null,
            eoa_address: walletAddress || null,
            aa_address: aaAddress || null,
            ...(effectiveParticipantUaid ? { participant_uaid: effectiveParticipantUaid } : {}),
          };

          await saveUserProfile(payload);
        } catch (error) {
          console.warn("Failed to save user profile:", error);
        }
      }, 500);

      return () => clearTimeout(timeoutId);
    }
  }, [
    step,
    userEmail,
    walletAddress,
    aaAddress,
    firstName,
    lastName,
    effectiveRole,
    participantUaid,
    existingIndividualProfile,
  ]);

  // Fetch AA address if missing when on step 2 and save to database
  React.useEffect(() => {
    if (step === 2 && walletAddress && !aaAddress && web3auth?.provider) {
      async function fetchAaAddress() {
        try {
          const provider = (web3auth as any).provider as
            | { request: (args: { method: string; params?: any[] }) => Promise<any> }
            | undefined;
          if (provider) {
            const indivAccountClient = await IndivService.getCounterfactualAccountClientByIndividual(
              walletAddress as `0x${string}`,
              { ethereumProvider: provider }
            );
            if (indivAccountClient && typeof indivAccountClient.getAddress === "function") {
              const addr = await indivAccountClient.getAddress();
              if (addr && typeof addr === "string") {
                setAaAddress(addr);
                // Save AA address to database immediately
                try {
                  await saveUserProfile({
                    email: userEmail,
                    role: effectiveRole,
                    first_name: firstName || null,
                    last_name: lastName || null,
                    eoa_address: walletAddress,
                    aa_address: addr,
                  });
                } catch (error) {
                  console.warn("Failed to save user profile (AA address):", error);
                }
              }
            }
          }
        } catch (error) {
          console.warn("Failed to fetch AA address:", error);
        }
      }
      void fetchAaAddress();
    }
  }, [step, walletAddress, aaAddress, web3auth, userEmail, firstName, lastName, effectiveRole]);

  // Step 2: if an individuals record already exists for this EOA, hydrate fields.
  const hydratedStep2EoaRef = React.useRef<string | null>(null);
  const hydratingStep2Ref = React.useRef(false);
  React.useEffect(() => {
    if (step !== 2) return;
    if (!walletAddress) return;
    const eoa = walletAddress.toLowerCase();
    if (hydratedStep2EoaRef.current === eoa) return;
    if (hydratingStep2Ref.current) return;

    let cancelled = false;
    hydratingStep2Ref.current = true;

    (async () => {
      try {
        const profile = await getUserProfile(undefined, eoa);
        if (cancelled || !profile) return;
        hydratedStep2EoaRef.current = eoa;
        setExistingIndividualProfile(profile);

        // Only prefill if user hasn't typed yet.
        if (typeof profile.first_name === "string") {
          setFirstName((prev) => (prev.trim() ? prev : profile.first_name || ""));
        }
        if (typeof profile.last_name === "string") {
          setLastName((prev) => (prev.trim() ? prev : profile.last_name || ""));
        }
        if (typeof profile.aa_address === "string" && profile.aa_address) {
          setAaAddress((prev) => prev || profile.aa_address || null);
        }

        // If participant agent already exists, hydrate it early so Step 3 can continue immediately.
        if (typeof profile.participant_uaid === "string" && profile.participant_uaid) {
          const uaid = profile.participant_uaid;
          setParticipantUaid((prev) => prev ?? (typeof uaid === "string" && uaid ? uaid : null));
          if (typeof profile.participant_agent_name === "string") {
            const participantName = profile.participant_agent_name;
            setParticipantAgentName((prev) => (prev.trim() ? prev : participantName || ""));
          }
          setParticipantEnsName((prev) =>
            prev ?? (typeof profile.participant_ens_name === "string" ? profile.participant_ens_name : null),
          );
        }

        // Hydrate role-specific participant metadata (best-effort).
        if (typeof (profile as any).participant_metadata === "string" && (profile as any).participant_metadata) {
          try {
            const parsed = JSON.parse((profile as any).participant_metadata);
            if (parsed && typeof parsed === "object") {
              setContributorSkills((prev) => (prev.trim() ? prev : (typeof (parsed as any).skills === "string" ? (parsed as any).skills : "")));
              setContributorAvailabilityHours((prev) =>
                prev.trim()
                  ? prev
                  : typeof (parsed as any).availability_hours_per_week === "number"
                    ? String((parsed as any).availability_hours_per_week)
                    : typeof (parsed as any).availability_hours_per_week === "string"
                      ? (parsed as any).availability_hours_per_week
                      : "",
              );
              setContributorEngagementPreferences((prev) =>
                prev.trim() ? prev : (typeof (parsed as any).engagement_preferences === "string" ? (parsed as any).engagement_preferences : ""),
              );

              setCoordinatorCoalitionName((prev) =>
                prev.trim() ? prev : (typeof (parsed as any).coalition_name === "string" ? (parsed as any).coalition_name : ""),
              );
              setCoordinatorScope((prev) =>
                prev.trim() ? prev : (typeof (parsed as any).coordination_scope === "string" ? (parsed as any).coordination_scope : ""),
              );

              setFunderEntityName((prev) =>
                prev.trim() ? prev : (typeof (parsed as any).funder_entity_name === "string" ? (parsed as any).funder_entity_name : ""),
              );
            }
          } catch {
            // ignore
          }
        }
      } catch (e) {
        if (!cancelled) {
          console.warn("[onboarding] Failed to hydrate individual profile for EOA (step 2):", e);
        }
      } finally {
        hydratingStep2Ref.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, walletAddress]);

  // Auto-advance onboarding based on what already exists in the individuals record for this EOA.
  const autoAdvancedEoaRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (step !== 2) return;
    if (!walletAddress) return;
    const eoa = walletAddress.toLowerCase();
    if (autoAdvancedEoaRef.current === eoa) return;

    // IMPORTANT: only auto-advance for already-saved profiles (hydration),
    // not while the user is actively typing names in this step.
    if (hydratedStep2EoaRef.current !== eoa) return;
    if (!existingIndividualProfile) return;

    const dbFirst =
      typeof (existingIndividualProfile as any).first_name === "string"
        ? (existingIndividualProfile as any).first_name.trim()
        : "";
    const dbLast =
      typeof (existingIndividualProfile as any).last_name === "string"
        ? (existingIndividualProfile as any).last_name.trim()
        : "";
    const hasNames = !!dbFirst || !!dbLast;
    const hasParticipant =
      typeof (existingIndividualProfile as any).participant_uaid === "string" &&
      !!(existingIndividualProfile as any).participant_uaid;

    // Do not auto-advance. Users may need to correct role/name even if
    // the participant agent already exists.
  }, [step, walletAddress, existingIndividualProfile]);

  // Step 3: if an individuals record already exists for this EOA, hydrate fields and allow continuing.
  const hydratedIndividualEoaRef = React.useRef<string | null>(null);
  const hydratingIndividualRef = React.useRef(false);
  React.useEffect(() => {
    if (step !== 3) return;
    if (!walletAddress) return;
    const eoa = walletAddress.toLowerCase();
    if (hydratedIndividualEoaRef.current === eoa) return;
    if (hydratingIndividualRef.current) return;

    let cancelled = false;
    hydratingIndividualRef.current = true;

    (async () => {
      try {
        const profile = await getUserProfile(undefined, eoa);
        if (cancelled || !profile) return;
        hydratedIndividualEoaRef.current = eoa;
        setExistingIndividualProfile(profile);

        setFirstName(typeof profile.first_name === "string" ? profile.first_name : "");
        setLastName(typeof profile.last_name === "string" ? profile.last_name : "");

        if (typeof profile.participant_agent_name === "string") {
          setParticipantAgentName(profile.participant_agent_name);
        }
        setParticipantEnsName(typeof profile.participant_ens_name === "string" ? profile.participant_ens_name : null);
        setParticipantUaid(typeof profile.participant_uaid === "string" ? profile.participant_uaid : null);

        // If we already have an ENS name from the DB, stop any "checking" UI flicker.
        if (typeof profile.participant_ens_name === "string" && profile.participant_ens_name) {
          setParticipantEnsAvailability({ checking: false, available: null, ensName: profile.participant_ens_name });
        }
      } catch (e) {
        if (!cancelled) {
          console.warn("[onboarding] Failed to hydrate individual profile for EOA:", e);
        }
      } finally {
        hydratingIndividualRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, walletAddress]);

  // Check ENS availability for the participant agent when on step 3.
  React.useEffect(() => {
    if (step !== 3) {
      setParticipantEnsAvailability({ checking: false, available: null, ensName: null });
      return;
    }

    // If participant agent is already present (loaded from DB or created now), don't re-check.
    if (participantUaid) {
      const ens = participantEnsName ?? null;
      setParticipantEnsAvailability({ checking: false, available: null, ensName: ens });
      return;
    }

    const agentName = normalizedParticipantAgentName;
    if (!agentName || !isValidAgentName(agentName)) {
      setParticipantEnsAvailability({ checking: false, available: null, ensName: null });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const ensOrgName = "8004-agent";
        const ensName = `${agentName}.${ensOrgName}.eth`;
        const didEns = `did:ens:${sepolia.id}:${ensName}`;

        setParticipantEnsAvailability({ checking: true, available: null, ensName });

        const encodedDidEns = encodeURIComponent(didEns);
        const response = await fetch(`/api/names/${encodedDidEns}/is-available`);
        if (cancelled) return;

        if (response.ok) {
          const result = await response.json();
          setParticipantEnsAvailability({
            checking: false,
            available: result.available === true,
            ensName,
          });
          return;
        }

        setParticipantEnsAvailability({ checking: false, available: null, ensName });
      } catch (error) {
        if (cancelled) return;
        console.warn("Failed to check participant ENS availability:", error);
        setParticipantEnsAvailability({ checking: false, available: null, ensName: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, normalizedParticipantAgentName, isValidAgentName]);

  // Check ENS availability for the organization agent when on step 4 and creating new.
  React.useEffect(() => {
    if (step !== 4 || orgChoice !== "create") {
      setOrgEnsAvailability({ checking: false, available: null, ensName: null });
      return;
    }

    const agentName = normalizedOrgAgentName;
    if (!agentName || !isValidAgentName(agentName)) {
      setOrgEnsAvailability({ checking: false, available: null, ensName: null });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const ensOrgName = "8004-agent";
        const ensName = `${agentName}.${ensOrgName}.eth`;
        const didEns = `did:ens:${sepolia.id}:${ensName}`;

        setOrgEnsAvailability({ checking: true, available: null, ensName });

        const encodedDidEns = encodeURIComponent(didEns);
        const response = await fetch(`/api/names/${encodedDidEns}/is-available`);
        if (cancelled) return;

        if (response.ok) {
          const result = await response.json();
          setOrgEnsAvailability({
            checking: false,
            available: result.available === true,
            ensName,
          });
          return;
        }

        setOrgEnsAvailability({ checking: false, available: null, ensName });
      } catch (error) {
        if (cancelled) return;
        console.warn("Failed to check organization ENS availability:", error);
        setOrgEnsAvailability({ checking: false, available: null, ensName: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, orgChoice, normalizedOrgAgentName, isValidAgentName]);

  const { 
    handleStandardConnect, 
    showOrgSelector, 
    availableOrgs, 
    handleOrgSelect, 
    onCancelOrgSelect 
  } = useStandardConnect();
  const { setDefaultOrgAgent } = useDefaultOrgAgent();

  const handleConnectSocial = React.useCallback(async () => {
    if (!web3auth) return;
    setIsConnecting(true);
    setError(null);

    try {
      // Use standard connect flow - this will show org selector if agent exists
      const result = await handleStandardConnect();

      // If agent exists and needs selection, the selector will be shown
      // Don't redirect automatically - let user choose their org agent
      if (result?.hasAgent && result?.needsSelection) {
        // Selector is shown via showOrgSelector state
        setIsConnecting(false);
        return;
      }
      
      // If agent exists but no selection needed, continue with onboarding
      if (result?.hasAgent && !result?.needsSelection) {
        setIsConnecting(false);
        return;
      }

      // No agent found - continue with onboarding flow
      const account = result?.account;
      if (!account) {
        throw new Error("Could not determine wallet address");
      }

      setWalletAddress(account);

      // Before moving to the individual details step, build a counterfactual
      // AA account client for the person (using a fixed salt) and store its address.
      const provider = (web3auth as any)?.provider as
        | { request: (args: { method: string; params?: any[] }) => Promise<any> }
        | undefined;
      if (provider) {
        try {
          const personClient = await IndivService.getCounterfactualAccountClientByIndividual(
                account as `0x${string}`,
                { ethereumProvider: provider }
              );
              if (personClient && typeof personClient.getAddress === "function") {
                const addr = await personClient.getAddress();
                if (addr && typeof addr === "string") {
                  setAaAddress(addr);
                }
              }
            } catch (e) {
              console.error(
                "Failed to build counterfactual account client for person:",
                e
              );
        }
      }

      setStep(2);
    } catch (e) {
      console.error(e);
      setError("Unable to complete social login. Please try again.");
    } finally {
      setIsConnecting(false);
    }
  }, [web3auth, handleStandardConnect]);

  const handleOrgChange = (field: keyof OrgDetails, value: string) => {
    setOrg((prev) => ({ ...prev, [field]: value }));
  };

  React.useEffect(() => {
    if (step !== 4 || !userEmail) return;
    let cancelled = false;
    setIsLoadingOrganizations(true);
    (async () => {
      try {
        const orgs = await getUserOrganizations(userEmail);
        if (!cancelled) {
          setUserOrganizations(Array.isArray(orgs) ? orgs : []);
        }
      } catch (e) {
        if (!cancelled) {
          setUserOrganizations([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingOrganizations(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, userEmail]);

  const runOrgSearch = React.useCallback(async () => {
    const q = orgSearchQuery.trim();
    if (!q) {
      setOrgSearchError("Enter an ENS name, DID, or agent name to search.");
      return;
    }
    setOrgSearchLoading(true);
    setOrgSearchError(null);
    try {
      const res = await fetch("/api/agents/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: q,
          page: 1,
          pageSize: 10,
          params: { chains: [sepolia.id] },
        }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        throw new Error(json?.message || `Search failed (${res.status})`);
      }
      setOrgSearchResults(Array.isArray(json?.agents) ? json.agents : []);
    } catch (e: any) {
      setOrgSearchResults([]);
      setOrgSearchError(e?.message || String(e));
    } finally {
      setOrgSearchLoading(false);
    }
  }, [orgSearchQuery]);

  const connectToOrgAgent = React.useCallback(
    async (agent: any) => {
      if (!participantUaid) {
        setError("Missing participant UAID. Create your participant agent first.");
        return;
      }

      const agentName = String(agent?.agentName || agent?.agent_name || "").trim();
      const ensName =
        String(agent?.ensName || agent?.ens_name || "").trim() ||
        (agentName ? `${agentName}.8004-agent.eth` : "");
      const agentAccount = String(agent?.agentAccount || agent?.agent_account || "").trim();
      const chainId = typeof agent?.chainId === "number" ? agent.chainId : sepolia.id;

      if (!agentName || !ensName) {
        setError("Selected agent is missing required identifiers.");
        return;
      }

      const defaultAgent: DefaultOrgAgent = {
        ensName,
        agentName,
        agentAccount,
        chainId,
        name: agent?.name || agent?.org_name || undefined,
        description: undefined,
        image: undefined,
        agentUrl: agent?.agentUrl || undefined,
      };

      try {
        // UAID-only: compute the org UAID from chainId + org smart account.
        const effectiveUaid =
          agentAccount && /^0x[a-fA-F0-9]{40}$/.test(agentAccount)
            ? `uaid:did:ethr:${chainId}:${agentAccount.toLowerCase()}`
            : null;

        if (!effectiveUaid) {
          throw new Error("Selected organization is missing agent smart account address (agentAccount).");
        }
        if (effectiveUaid) {
          (defaultAgent as any).uaid = effectiveUaid;
        }

        await upsertUserOrganizationByIndividualUaid({
          individual_uaid: canonicalizeUaid(participantUaid) ?? participantUaid,
          ens_name: ensName,
          agent_name: agentName,
          org_name: agent?.name || undefined,
          org_address: undefined,
          org_roles: null,
          uaid: effectiveUaid,
          is_primary: false,
          role: undefined,
        });
      } catch (e) {
        console.warn("[onboarding] Failed to persist org association:", e);
      }

      setDefaultOrgAgent(defaultAgent);
      setItg(ensName);
      setStep(6);
    },
    [participantUaid, setDefaultOrgAgent, emailDomain],
  );

  const handleCreateParticipantAgent = React.useCallback(async () => {
    const agentName = normalizedParticipantAgentName;
    if (!agentName) {
      setError("Please enter an agent name for yourself.");
      return;
    }
    if (!isValidAgentName(agentName)) {
      setError("Participant agent name must be 3-63 chars: lowercase letters, numbers, and hyphens only.");
      return;
    }
    if (participantEnsAvailability.checking || participantEnsAvailability.available !== true) {
      setError("Please choose an available participant agent name first.");
      return;
    }
    if (!web3auth || !(web3auth as any).provider) {
      setError("Wallet provider is not available. Please complete the social login step first.");
      return;
    }

    setIsCreatingParticipant(true);
    setParticipantCreateStartedAtMs(Date.now());
    setParticipantCreateProgress(0);
    setParticipantCreateStatus("Preparing wallet + smart account…");
    setError(null);

    try {
      setParticipantCreateStatus("Connecting wallet…");
      const eip1193Provider =
        (web3auth as any).provider ??
        (typeof window !== "undefined" ? (window as any).ethereum : null);

      if (!eip1193Provider) {
        setError("No EIP-1193 provider available. Please ensure your wallet is connected.");
        return;
      }

      const provider = eip1193Provider as {
        request: (args: { method: string; params?: any[] }) => Promise<any>;
      };

      const accounts = await provider.request({ method: "eth_accounts" });
      const account = Array.isArray(accounts) && accounts[0];
      if (!account || typeof account !== "string") {
        setError("We could not determine your wallet address. Please disconnect and reconnect, then try again.");
        return;
      }

      // Preflight: prove we can sign with this provider (production failures often
      // come from a “connected” session that is read-only / cannot sign).
      setParticipantCreateStatus("Verifying wallet signing…");
      try {
        const chainIdHex = await provider.request({ method: "eth_chainId" });
        const parsedChainId =
          typeof chainIdHex === "string" && chainIdHex.startsWith("0x")
            ? parseInt(chainIdHex, 16)
            : Number(chainIdHex);
        if (Number.isFinite(parsedChainId) && parsedChainId !== sepolia.id) {
          setError(`Wrong network. Please switch to Sepolia (chainId ${sepolia.id}) and try again.`);
          return;
        }

        const msg = `ITG onboarding signature check: ${Date.now()}`;
        await provider.request({
          method: "personal_sign",
          params: [stringToHex(msg), account],
        });
      } catch (e: any) {
        const m = e?.message ? String(e.message) : String(e);
        setError(
          "Your wallet session appears unable to sign transactions/messages. " +
            "Please disconnect + reconnect using Web3Auth social login (Google/etc) or a wallet that supports signing, then try again." +
            (process.env.NODE_ENV === "development" ? ` (${m})` : "")
        );
        return;
      }

      setParticipantCreateStatus("Computing smart account address…");
      const agentAccountAddress = await getCounterfactualSmartAccountAddressByAgentName(
        agentName,
        account as `0x${string}`,
        { ethereumProvider: provider as any, chain: sepolia },
      );

      if (!agentAccountAddress || typeof agentAccountAddress !== "string" || !agentAccountAddress.startsWith("0x")) {
        setError("Failed to compute account abstraction address for this participant agent. Please retry.");
        return;
      }

      const ensOrgName = "8004-agent";
      const ensName = `${agentName}.${ensOrgName}.eth`;
      const didEns = `did:ens:${sepolia.id}:${ensName}`;

      try {
        setParticipantCreateStatus("Checking ENS availability…");
        const availabilityCheck = await fetch(`/api/names/${encodeURIComponent(didEns)}/is-available`, {
          method: "GET",
        });
        if (availabilityCheck.ok) {
          const availabilityData = await availabilityCheck.json();
          if (availabilityData.available === false) {
            setError(`An agent with the name "${agentName}" already exists. Please choose another name.`);
            return;
          }
        }
      } catch {
        // ok to continue
      }

      setParticipantCreateStatus("Registering ENS name + participant agent (on-chain)…");
      const agentUrl = `https://${agentName}.impact-agent.io`;
      const result = await createAgentWithWallet({
        agentData: {
          agentName,
          agentAccount: agentAccountAddress as `0x${string}`,
          description: "participant",
          agentUrl,
        },
        account: account as `0x${string}`,
        ethereumProvider: eip1193Provider as any,
        ensOptions: { enabled: true, orgName: ensOrgName },
        useAA: true,
        chainId: sepolia.id,
      });

      const createdAgentId = (result as any)?.agentId;
      if (createdAgentId === undefined || createdAgentId === null) {
        throw new Error("Participant agent creation did not return an agentId");
      }

      // Best-effort: trigger knowledge base sync after agent registration.
      try {
        const chainId = Number(sepolia.id);
        const kbChainId = chainId === 1 || chainId === 59144 ? String(chainId) : 'all';
        void fetch(`/api/sync/agent-pipeline?chainId=${encodeURIComponent(kbChainId)}`, { method: 'POST' });
      } catch {
        // ignore
      }

      setParticipantCreateStatus("Finalizing registration…");
      setParticipantEnsName(ensName);

      // Generate UAID for the participant smart account (admin-compatible endpoint).
      setParticipantCreateStatus("Generating canonical UAID…");
      let createdUaid: string | null = null;
      try {
        const uaidRes = await fetch("/api/agents/generate-uaid", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agentAccount: agentAccountAddress,
            chainId: sepolia.id,
            uid: `did:ethr:${sepolia.id}:${String(agentAccountAddress).toLowerCase()}`,
            registry: "smart-agent",
            proto: "a2a",
            nativeId: `eip155:${sepolia.id}:${String(agentAccountAddress).toLowerCase()}`,
          }),
        });
        const uaidJson = await uaidRes.json().catch(() => ({} as any));
        const uaidValue = typeof uaidJson?.uaid === "string" ? uaidJson.uaid.trim() : "";
        if (uaidValue) {
          const canonical = canonicalizeUaid(uaidValue) ?? canonicalizeUaid(`uaid:${uaidValue}`) ?? uaidValue.split(";")[0] ?? uaidValue;
          createdUaid = canonical;
          setParticipantUaid(canonical);
        }
      } catch {
        // ignore
      }

      if (!createdUaid) {
        // Best-effort fallback (canonical form only)
        const fallback = canonicalizeUaid(`uaid:did:ethr:${sepolia.id}:${String(agentAccountAddress).toLowerCase()}`) ??
          `uaid:did:ethr:${sepolia.id}:${String(agentAccountAddress).toLowerCase()}`;
        createdUaid = fallback;
        setParticipantUaid(fallback);
      }

      setParticipantCreateStatus("Saving to your profile…");
      await saveUserProfile({
        ...(userEmail ? { email: userEmail } : {}),
        role: effectiveRole,
        first_name: firstName || null,
        last_name: lastName || null,
        phone_number: userPhone || null,
        social_display_name: typeof user?.name === "string" ? user.name : null,
        eoa_address: account,
        aa_address: aaAddress || null,
        participant_ens_name: ensName,
        participant_agent_name: agentName,
        participant_uaid: createdUaid,
      });

      setParticipantCreateStatus("Done.");
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("user rejected") || msg.includes("User denied")) {
        setError("Transaction was cancelled. Please try again when ready.");
      } else {
        setError(`Failed to create participant agent: ${msg}`);
      }
    } finally {
      setIsCreatingParticipant(false);
      setParticipantCreateStartedAtMs(null);
    }
  }, [
    normalizedParticipantAgentName,
    isValidAgentName,
    participantEnsAvailability.checking,
    participantEnsAvailability.available,
    userEmail,
    web3auth,
    effectiveRole,
    firstName,
    lastName,
    aaAddress,
    userPhone,
    user?.name,
  ]);

  const handleOrgNext = React.useCallback(async () => {
    if (!org.name || !org.address) {
      setError("Please complete all organization fields before continuing.");
      return;
    }

    const candidateName = normalizedOrgAgentName;
    if (!candidateName) {
      setError("Please choose an agent name before continuing.");
      return;
    }
    if (!isValidAgentName(candidateName)) {
      setError('Agent name must be 3-63 chars: lowercase letters, numbers, and hyphens only.');
      return;
    }
    const ensOrgName = "8004-agent";
    const selectedChainId = sepolia.id;

    setIsCheckingAvailability(true);

    try {
      // Build DID ENS string: did:ens:chainId:agentName.orgName.eth
      const encodedEnsDid = encodeURIComponent(
        `did:ens:${selectedChainId}:${candidateName}.${ensOrgName}.eth`
      );

      const response = await fetch(`/api/names/${encodedEnsDid}/is-available`, {
        method: "GET",
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        console.warn("ENS availability check failed:", err);
        setError(
          err?.error ??
            "Unable to check Impact domain availability. Please try again."
        );
        return;
      }

      const data = await response.json();
      const available = data?.available === true;

      if (!available) {
        setError(
          `An agent already exists with the name "${candidateName}". Please disconnect and sign in with an account whose email domain matches the organization you are registering.`
        );
        return;
      }

      setError(null);
      setStep(6);
    } catch (e) {
      console.error(e);
      setError(
        "Unable to check Impact domain availability. Please try again in a moment."
      );
    } finally {
      setIsCheckingAvailability(false);
    }
  }, [org, normalizedOrgAgentName, isValidAgentName]);

  const handleDisconnectAndReset = React.useCallback(async () => {
    setError(null);
    try {
      await logout();
    } catch (e) {
      console.error(e);
    } finally {
      // Clear default org agent cache
      try {
        if (typeof window !== "undefined") {
          localStorage.removeItem("itg_default_org_agent");
          Object.keys(localStorage)
            .filter((key) => key.startsWith("itg_agent_details_"))
            .forEach((key) => localStorage.removeItem(key));
        }
      } catch (cacheError) {
        console.warn("[onboarding] Failed to clear cached agent data on disconnect:", cacheError);
      }
      
      // Clear default org agent state
      setDefaultOrgAgent(null);
      setUser(null);
      setOrg({
        name: "",
        address: ""
      });
      setItg(null);
      setWalletAddress(null);
      setAaAddress(null);
      setFirstName("");
      setLastName("");
      setStep(1);
      router.push("/");
    }
  }, [logout, setUser, router, setDefaultOrgAgent]);

  const handleCreateItg = React.useCallback(async () => {
    const agentName = normalizedOrgAgentName;
    if (!agentName) {
      setError("Please enter an agent name.");
      return;
    }
    if (!isValidAgentName(agentName)) {
      setError('Agent name must be 3-63 chars: lowercase letters, numbers, and hyphens only.');
      return;
    }

    if (!web3auth || !(web3auth as any).provider) {
      setError(
        "Wallet provider is not available. Please complete the social login step first."
      );
      return;
    }

    setIsCreatingItg(true);
    setOrgCreateStartedAtMs(Date.now());
    setOrgCreateProgress(0);
    setOrgCreateStatus("Preparing wallet + smart account…");
    setError(null);

    try {
      setOrgCreateStatus("Connecting wallet…");
      // Resolve an EIP-1193 provider (Web3Auth first, then window.ethereum as fallback).
      const eip1193Provider =
        (web3auth as any).provider ??
        (typeof window !== "undefined" ? (window as any).ethereum : null);

      if (!eip1193Provider) {
        setError(
          "No EIP-1193 provider available. Please ensure your wallet is connected."
        );
        return;
      }

      const provider = eip1193Provider as {
        request: (args: { method: string; params?: any[] }) => Promise<any>;
      };

      // Resolve connected account (EOA) from provider
      setOrgCreateStatus("Getting wallet address…");
      const accounts = await provider.request({
        method: "eth_accounts"
      });
      const account = Array.isArray(accounts) && accounts[0];

      if (!account || typeof account !== "string") {
        setError(
          "We could not determine your wallet address. Please disconnect and reconnect, then try again."
        );
        return;
      }

      // Preflight: prove we can sign with this provider (production failures often
      // come from a “connected” session that is read-only / cannot sign).
      setOrgCreateStatus("Verifying wallet signing…");
      try {
        const chainIdHex = await provider.request({ method: "eth_chainId" });
        const parsedChainId =
          typeof chainIdHex === "string" && chainIdHex.startsWith("0x")
            ? parseInt(chainIdHex, 16)
            : Number(chainIdHex);
        if (Number.isFinite(parsedChainId) && parsedChainId !== sepolia.id) {
          setError(`Wrong network. Please switch to Sepolia (chainId ${sepolia.id}) and try again.`);
          return;
        }

        const msg = `ITG org onboarding signature check: ${Date.now()}`;
        await provider.request({
          method: "personal_sign",
          params: [stringToHex(msg), account],
        });
      } catch (e: any) {
        const m = e?.message ? String(e.message) : String(e);
        setError(
          "Your wallet session appears unable to sign transactions/messages. " +
            "Please disconnect + reconnect using Web3Auth social login (Google/etc) or a wallet that supports signing, then try again." +
            (process.env.NODE_ENV === "development" ? ` (${m})` : "")
        );
        return;
      }

      // Compute the counterfactual AA address for the agent using the client helper.
      setOrgCreateStatus("Computing smart account address…");
      const agentAccountAddress = await getCounterfactualSmartAccountAddressByAgentName(
        agentName,
        account as `0x${string}`,
        {
          ethereumProvider: provider as any,
          chain: sepolia
        }
      );

      if (
        !agentAccountAddress ||
        typeof agentAccountAddress !== "string" ||
        !agentAccountAddress.startsWith("0x")
      ) {
        setError(
          "Failed to compute account abstraction address for this agent. Please retry."
        );
        return;
      }

      console.info("......... computedAa (agent AA) ......... ", agentAccountAddress);

      const ensOrgName = "8004-agent";

      console.info("......... eip1193Provider: ", eip1193Provider);

      // Double-check agent name availability before attempting creation
      try {
        setOrgCreateStatus("Checking ENS availability…");
        const ensName = `${agentName}.${ensOrgName}.eth`;
        const didEns = `did:ens:${sepolia.id}:${ensName}`;
        const encodedEnsDid = encodeURIComponent(didEns);
        const availabilityCheck = await fetch(`/api/names/${encodedEnsDid}/is-available`, {
          method: "GET",
        });

        if (availabilityCheck.ok) {
          const availabilityData = await availabilityCheck.json();
          if (availabilityData.available === false) {
            setError(
              `An agent with the name "${agentName}" already exists. Please disconnect and sign in with an account whose email domain matches the organization you are registering.`
            );
            return;
          }
        }
      } catch (availabilityError) {
        console.warn("Failed to verify agent name availability before creation:", availabilityError);
        // Continue with creation attempt even if availability check fails
      }

      let result;
      let agentCreationSuccessful = false;
      try {
        setOrgCreateStatus("Registering ENS name + organization agent (on-chain)…");
        const agentUrl = `https://${agentName}.impact-agent.io`;
        result = await createAgentWithWallet({
          agentData: {
            agentName,
            agentAccount: agentAccountAddress as `0x${string}`,
            description: 'itg account',
            //image: 'https://www.google.com',
            agentUrl: agentUrl,
          },
          account: account as `0x${string}`,
          ethereumProvider: eip1193Provider as any,
          ensOptions: {
            enabled: true,
            orgName: ensOrgName
          },
          useAA: true,
          chainId: sepolia.id
        });

        console.info("......... result ......... ", result);
        setOrgCreateStatus("Finalizing registration…");
        
        // Verify that the result indicates successful creation
        // Check for agentId or other success indicators
        if (result && (result as any)?.agentId !== undefined) {
          agentCreationSuccessful = true;
        } else {
          // If result doesn't have expected success indicators, treat as failure
          console.warn("[onboarding] Agent creation result missing success indicators:", result);
          throw new Error("Agent creation did not return expected success indicators");
        }

        // Best-effort: trigger knowledge base sync after agent registration.
        try {
          const chainId = Number(sepolia.id);
          const kbChainId = chainId === 1 || chainId === 59144 ? String(chainId) : 'all';
          void fetch(`/api/sync/agent-pipeline?chainId=${encodeURIComponent(kbChainId)}`, { method: 'POST' });
        } catch {
          // ignore
        }
      } catch (createError: any) {
        console.error("Failed to create agent:", createError);
        agentCreationSuccessful = false;
        
        // Provide more specific error messages
        const errorMessage = createError?.message || String(createError);
        
        if (errorMessage.includes('Internal JSON-RPC error') || errorMessage.includes('InternalRpcError')) {
          setError(
            "The blockchain network is experiencing issues. Please try again in a few moments. If the problem persists, check your network connection and try again."
          );
        } else if (errorMessage.includes('insufficient funds') || errorMessage.includes('gas')) {
          setError(
            "Insufficient funds or gas estimation failed. Please ensure your wallet has enough ETH to cover transaction fees."
          );
        } else if (errorMessage.includes('user rejected') || errorMessage.includes('User denied')) {
          setError(
            "Transaction was cancelled. Please try again when ready."
          );
        } else if (errorMessage.includes('already exists') || errorMessage.includes('already registered')) {
          setError(
            `An agent with the name "${agentName}" already exists. Please disconnect and sign in with an account whose email domain matches the organization you are registering.`
          );
        } else {
          setError(
            `Failed to create agent: ${errorMessage}. Please try again or contact support if the issue persists.`
          );
        }
        throw createError; // Re-throw to be caught by outer catch
      }

      setOrgCreateStatus("Verifying smart account…");
      const indivAccountClient: any =
        await IndivService.getCounterfactualAccountClientByIndividual(
          account as `0x${string}`,
          { ethereumProvider: eip1193Provider as any }
        );
      console.info("......... indivAccountClient ......... ", indivAccountClient?.address);

      /*
      // After successfully creating the agent AA, create a trust relationship
      // attestation between the individual's AA and the agent AA.
      try {

        const personAccountClient: any =
        await IndivService.getCounterfactualAccountClientByIndividual(
          "person",
          account as `0x${string}`,
          { ethereumProvider: provider }
        );

        // subject (from) ==> object (to)
        const subjectDid = `did:pkh:eip155:${sepolia.id}:${agentAccountAddress}`;
        const objectDid = `did:pkh:eip155:${sepolia.id}:${personAccountClient.address}`;

        const trustAttestation: TrustRelationshipAttestation = {
          entityId: "trust-relationship",
          displayName: "Trust relationship",
          description:
            "Trust relationship between individual AA and agent AA for Impact onboarding",
          subjectDid,
          objectDid,
          relationshipType: "ally"
        };



        await AttestationService.addTrustRelationshipAttestation({
          chain: sepolia,
          attestation: trustAttestation,
          agentAccountClient: personAccountClient
        });
      } catch (e) {
        console.error(
          "Failed to create trust relationship attestation for agent:",
          e
        );
      }
      */








      // Associate user with the newly created organization ONLY if agent creation was successful
      // (Profile is already saved incrementally throughout the onboarding process)
      if (agentCreationSuccessful) {
        try {
          setOrgCreateStatus("Linking organization to your individual…");
          const individualUaid = canonicalizeUaid(participantUaid) ?? participantUaid;
          if (!individualUaid) {
            throw new Error("Missing participant UAID (create your participant agent first).");
          }

          setOrgCreateStatus("Computing canonical UAID…");
          const ensName = `${agentName}.${ensOrgName}.eth`;
          const orgUaid = `uaid:did:ethr:${sepolia.id}:${String(agentAccountAddress).toLowerCase()}`;
          setOrgUaid(orgUaid);

          setOrgCreateStatus("Saving organization to the database…");
          await upsertUserOrganizationByIndividualUaid({
            individual_uaid: individualUaid,
            ens_name: ensName,
            agent_name: agentName,
            org_name: org.name || undefined,
            org_address: org.address || undefined,
            org_roles: Array.isArray(orgRoles) && orgRoles.length > 0 ? orgRoles : [defaultOrgRoleForIndividual],
            uaid: orgUaid,
            org_metadata: null,
            is_primary: true,
            role: undefined,
          });

          // Set as default org agent (we already have agentId from creation result)
          const defaultAgent: DefaultOrgAgent = {
            ensName,
            agentName,
            agentAccount: agentAccountAddress,
            agentId: (result as any)?.agentId,
            chainId: sepolia.id,
            name: (result as any)?.name || agentName,
            description: (result as any)?.description || "itg account",
            image: (result as any)?.image,
            agentUrl: `https://${agentName}.impact-agent.io`,
            tokenUri: (result as any)?.tokenUri,
            metadata: (result as any)?.metadata,
            did: (result as any)?.did,
            a2aEndpoint: (result as any)?.a2aEndpoint,
            uaid: orgUaid,
          };
          setDefaultOrgAgent(defaultAgent);

          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          console.warn("Failed to associate user with organization:", error);
        }
      }

      // For the Impact onboarding UI, treat a successful client-side flow as success
      // and use the human-readable agent name as the Impact identifier.
      setItg(agentName);
      setStep(6);
      setOrgCreateStatus("Done.");
    } catch (e) {
      // Error handling is done in the inner try-catch above
      // This outer catch is just for any unexpected errors that weren't caught by inner catch
      console.error("Unexpected error during agent creation:", e);
      // The inner catch should have already set the error message
      // Only set a generic error if somehow we got here without an error message
      const errorMessage = e instanceof Error ? e.message : String(e);
      if (!errorMessage.includes('Internal JSON-RPC') && 
          !errorMessage.includes('insufficient funds') &&
          !errorMessage.includes('already exists') &&
          !errorMessage.includes('user rejected')) {
        // This is an unexpected error type, set generic message
        setError(
          "An unexpected error occurred while creating your Impact Organization Identity. Please try again."
        );
      }
    } finally {
      setIsCreatingItg(false);
      setOrgCreateStartedAtMs(null);
    }
  }, [
    normalizedOrgAgentName,
    isValidAgentName,
    org.name,
    org.address,
    orgRoles,
    defaultOrgRoleForIndividual,
    emailDomain,
    participantUaid,
    web3auth,
    setDefaultOrgAgent,
  ]);

  const goToAppEnvironment = () => {
    router.push("/app");
  };

  return (
    <>
      {showOrgSelector && availableOrgs.length > 0 && (
        <OrgAgentSelector
          organizations={availableOrgs}
          onSelect={handleOrgSelect}
          onCancel={onCancelOrgSelect}
        />
      )}
      {showOrgConnectSelector && userOrganizations.length > 0 && (
        <OrgAgentSelector
          organizations={userOrganizations}
          onSelect={(agent) => {
            setShowOrgConnectSelector(false);
            setDefaultOrgAgent(agent);
            setItg(agent.ensName);
            setStep(6);
          }}
          onCancel={() => setShowOrgConnectSelector(false)}
        />
      )}
    <main
      style={{
        padding: "3rem 2rem",
        maxWidth: "48rem",
        margin: "0 auto"
      }}
    >
      <header style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
          Impact Onboarding — {roleLabel}
        </h1>
        <p style={{ maxWidth: "40rem", lineHeight: 1.6 }}>
          Follow a few simple steps to register yourself, your Organization, and then continue into the application environment.
        </p>
      </header>

      <section
        style={{
          marginBottom: "1.5rem",
          fontSize: "0.9rem",
          color: "#4b5563"
        }}
      >
        <strong>Step {step} of 6</strong>
      </section>

      {error && (
        <div
          style={{
            marginBottom: "1.5rem",
            padding: "0.75rem 1rem",
            borderRadius: "0.5rem",
            backgroundColor: "#fef2f2",
            color: "#991b1b",
            border: "1px solid #fecaca"
          }}
        >
          {error}
        </div>
      )}

      {step === 1 && (
        <section
          style={{
            padding: "1.75rem 1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid rgba(148, 163, 184, 0.6)",
            backgroundColor: "white"
          }}
        >
          <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            1. Connect using your social login
          </h2>
          <p style={{ marginBottom: "1.25rem", lineHeight: 1.5 }}>
            We use Web3Auth to let you sign in with familiar social providers,
            while also preparing a wallet that can be used for Impact operations.
          </p>

          {isInitializing && (
            <p>Initializing Web3Auth widget, please wait…</p>
          )}

          {!isInitializing && !error && (
            <button
              type="button"
              onClick={handleConnectSocial}
              disabled={!web3auth || isConnecting}
              style={{
                padding: "0.75rem 1.5rem",
                borderRadius: "9999px",
                border: "none",
                backgroundColor: "#2563eb",
                color: "white",
                fontWeight: 600,
                cursor: !web3auth || isConnecting ? "not-allowed" : "pointer",
                opacity: !web3auth || isConnecting ? 0.7 : 1
              }}
            >
              {isConnecting ? "Connecting…" : "Connect with phone number or social login"}
            </button>
          )}
        </section>
      )}

      {step === 2 && (
        <section
          style={{
            padding: "1.75rem 1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid rgba(148, 163, 184, 0.6)",
            backgroundColor: "white"
          }}
        >
          <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            2. Your details
          </h2>

          {user && (
            <div style={{ marginBottom: "1.25rem", lineHeight: 1.5 }}>
              {userEmail ? (
                <p>
                  Email: <strong>{userEmail}</strong>
                </p>
              ) : userPhone ? (
                <p>
                  Phone: <strong>{userPhone}</strong>
                </p>
              ) : null}
              {walletAddress && (
                <div
                  style={{
                    marginTop: "0.5rem",
                    fontSize: "0.85rem",
                    color: "#6b7280",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace"
                  }}
                >
                  <p style={{ marginBottom: "0.25rem" }}>
                  EOA: <span>{walletAddress}</span>
                </p>
                  <p style={{ marginTop: "0.15rem", fontSize: "0.8rem", color: "#9ca3af" }}>
                    EOA DID:ethr: <span>did:ethr:{sepolia.id}:{walletAddress}</span>
                  </p>
                </div>
              )}
              {/* AA account intentionally hidden in onboarding UI */}
            </div>
          )}

          {/* removed debug output */}

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>First name</span>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #cbd5f5"
                }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>Last name</span>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #cbd5f5"
                }}
              />
            </label>
          </div>

          <div
            style={{
              marginTop: "1.25rem",
              padding: "1rem",
              borderRadius: "0.5rem",
              border: "1px solid #e2e8f0",
              backgroundColor: "#f8fafc",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
              Registration role: <span style={{ color: "#1e40af" }}>{roleLabel}</span>
            </div>
            <div style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: "0.75rem" }}>
              Capabilities and organization details are set after onboarding (you can always edit later).
            </div>

            <div style={{ fontSize: "0.9rem", color: "#334155", lineHeight: 1.5 }}>
              <div style={{ marginBottom: "0.5rem", fontWeight: 600 }}>Next steps</div>
              <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                <li>
                  <strong>Capabilities</strong> (skills, availability, location, coordinator review/fulfillment): set these after onboarding in{" "}
                  <a href="/user-capabilities">Capabilities</a>.
                </li>
                <li>
                  <strong>Organization names</strong> (coalition name, funding entity name): set these when you create/select an organization in step 4/5
                  and later in <a href="/organization-settings">Organization Settings</a> or{" "}
                  <a href="/coalition-settings">Coalition Settings</a>.
                </li>
              </ul>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: "1.5rem"
            }}
          >
            <button
              type="button"
              onClick={() => setStep(1)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "9999px",
                border: "1px solid #cbd5f5",
                backgroundColor: "white",
                cursor: "pointer"
              }}
            >
              Back
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                if (isSavingStep2) return;
                setIsSavingStep2(true);
                setError(null);
                (async () => {
                  try {
                    const effectiveParticipantUaid =
                      (typeof participantUaid === "string" && participantUaid.trim()
                        ? participantUaid.trim()
                        : typeof (existingIndividualProfile as any)?.participant_uaid === "string" &&
                            String((existingIndividualProfile as any).participant_uaid).trim()
                          ? String((existingIndividualProfile as any).participant_uaid).trim()
                          : null);
                    const payload: UserProfile = {
                      ...(typeof (existingIndividualProfile as any)?.id === "number" &&
                      Number.isFinite((existingIndividualProfile as any).id) &&
                      (existingIndividualProfile as any).id > 0
                        ? { id: (existingIndividualProfile as any).id }
                        : {}),
                      ...(userEmail ? { email: userEmail } : {}),
                      role: effectiveRole,
                      first_name: firstName || null,
                      last_name: lastName || null,
                      eoa_address: walletAddress || null,
                      aa_address: aaAddress || null,
                      ...(effectiveParticipantUaid ? { participant_uaid: effectiveParticipantUaid } : {}),
                    };

                    // 1) Save once (may create the individual if missing)
                    const saved = await saveUserProfile(payload);
                    setExistingIndividualProfile(saved);

                    const desiredRole = String(effectiveRole || "").trim().toLowerCase();
                    const desiredFirst = String(firstName || "").trim();
                    const desiredLast = String(lastName || "").trim();
                    const gotRole = String((saved as any)?.role || "").trim().toLowerCase();
                    const gotFirst = String((saved as any)?.first_name || "").trim();
                    const gotLast = String((saved as any)?.last_name || "").trim();

                    // 2) If values didn't stick, force a second save targeting individual_id.
                    if (
                      (desiredRole && gotRole !== desiredRole) ||
                      (desiredFirst && gotFirst !== desiredFirst) ||
                      (desiredLast && gotLast !== desiredLast)
                    ) {
                      const savedId = (saved as any)?.id;
                      if (typeof savedId === "number" && Number.isFinite(savedId) && savedId > 0) {
                        const saved2 = await saveUserProfile({ ...payload, id: savedId });
                        setExistingIndividualProfile(saved2);
                        const gotRole2 = String((saved2 as any)?.role || "").trim().toLowerCase();
                        const gotFirst2 = String((saved2 as any)?.first_name || "").trim();
                        const gotLast2 = String((saved2 as any)?.last_name || "").trim();
                        if (
                          (desiredRole && gotRole2 !== desiredRole) ||
                          (desiredFirst && gotFirst2 !== desiredFirst) ||
                          (desiredLast && gotLast2 !== desiredLast)
                        ) {
                          throw new Error("Profile save did not persist your role/name. Please retry.");
                        }
                      }
                    }
                    setStep(3);
                  } catch (err: any) {
                    setError(err?.message || "Failed to save your profile. Please try again.");
                  } finally {
                    setIsSavingStep2(false);
                  }
                })();
              }}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "9999px",
                border: "none",
                backgroundColor: "#2563eb",
                color: "white",
                fontWeight: 600,
                cursor: isSavingStep2 ? "not-allowed" : "pointer",
                opacity: isSavingStep2 ? 0.7 : 1,
              }}
            >
              {isSavingStep2 ? "Saving…" : "Continue"}
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section
          style={{
            padding: "1.75rem 1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid rgba(148, 163, 184, 0.6)",
            backgroundColor: "white",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            3. Create your participant agent
          </h2>
          <p style={{ marginBottom: "1rem", lineHeight: 1.5 }}>
            This creates your personal (participant) agent identity and saves it to your profile.
          </p>

          {user && (
            <div style={{ marginBottom: "1rem", lineHeight: 1.5 }}>
              {userEmail ? (
                <p>
                  Email: <strong>{userEmail}</strong>
                </p>
              ) : userPhone ? (
                <p>
                  Phone: <strong>{userPhone}</strong>
                </p>
              ) : null}
              {participantEnsAvailability.ensName && (
                <div style={{ marginTop: "0.75rem" }}>
                  <strong style={{ color: "#1e40af" }}>ENS Domain:</strong>{" "}
                  <span
                    style={{
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
                      color: "#1e3a8a",
                      fontSize: "0.9rem",
                    }}
                  >
                    {participantEnsAvailability.ensName}
                  </span>
                  {participantEnsAvailability.checking ? (
                    <div style={{ fontSize: "0.85rem", color: "#64748b", marginTop: "0.25rem" }}>
                      Checking availability...
                    </div>
                  ) : participantEnsAvailability.available !== null ? (
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: participantEnsAvailability.available ? "#16a34a" : "#dc2626",
                        fontWeight: 500,
                        marginTop: "0.25rem",
                      }}
                    >
                      {participantEnsAvailability.available
                        ? "✓ Available - This ENS name is available for registration"
                        : "✗ Not Available - This ENS name is already taken"}
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.85rem", color: "#64748b", marginTop: "0.25rem" }}>
                      Unable to check availability
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* removed debug output */}

          <div
            style={{
              padding: "1rem",
              marginBottom: "1rem",
              borderRadius: "0.5rem",
              backgroundColor: "#f8fafc",
              border: "1px solid #e2e8f0",
            }}
          >
            <div style={{ marginBottom: "0.75rem", fontWeight: 600, fontSize: "0.9rem" }}>
              Participant agent name
            </div>
            <input
              type="text"
              value={participantAgentName}
              onChange={(e) => setParticipantAgentName(e.target.value)}
              placeholder="e.g. alice"
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                borderRadius: "0.5rem",
                border: "1px solid #cbd5f5",
                fontSize: "0.9rem",
              }}
            />
            <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#64748b" }}>
              Must be 3-63 chars: lowercase letters, numbers, hyphens.
            </div>
          </div>

          {participantUaid && (
            <div
              style={{
                padding: "1rem",
                marginBottom: "1rem",
                borderRadius: "0.5rem",
                backgroundColor: "#f0fdf4",
                border: "1px solid #86efac",
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Participant agent created</div>
              <div style={{ fontSize: "0.85rem", color: "#14532d" }}>
                <div>
                  <strong>UAID:</strong> {canonicalizeUaid(participantUaid) ?? String(participantUaid).split(";")[0]}
                </div>
                {participantEnsName && (
                  <div>
                    <strong>ENS:</strong> {participantEnsName}
                  </div>
                )}
              </div>
            </div>
          )}

          {isCreatingParticipant && (
            <div
              style={{
                padding: "1rem",
                marginBottom: "1rem",
                borderRadius: "0.5rem",
                backgroundColor: "#eff6ff",
                border: "1px solid #93c5fd",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: "0.5rem", color: "#1e3a8a" }}>
                Creating participant agent (up to ~3 minutes)
              </div>
              <div style={{ height: 10, borderRadius: 9999, backgroundColor: "rgba(37,99,235,0.15)", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round(participantCreateProgress * 100)}%`,
                    backgroundColor: "#2563eb",
                    transition: "width 250ms linear",
                  }}
                />
              </div>
              <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#1e40af" }}>
                {participantCreateStatus || "Working…"}
              </div>
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: "1.5rem",
              gap: "0.75rem",
            }}
          >
            <button
              type="button"
              onClick={() => setStep(2)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "9999px",
                border: "1px solid #cbd5f5",
                backgroundColor: "white",
                cursor: "pointer",
              }}
            >
              Back
            </button>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              {!participantUaid &&
                !participantEnsAvailability.checking &&
                participantEnsAvailability.available === true &&
                isValidAgentName(normalizedParticipantAgentName) && (
                  <button
                    type="button"
                    onClick={handleCreateParticipantAgent}
                    disabled={isCreatingParticipant}
                    style={{
                      padding: "0.5rem 1.25rem",
                      borderRadius: "9999px",
                      border: "1px solid #cbd5f5",
                      backgroundColor: "white",
                      fontWeight: 600,
                      cursor: isCreatingParticipant ? "not-allowed" : "pointer",
                      opacity: isCreatingParticipant ? 0.7 : 1,
                    }}
                  >
                    {isCreatingParticipant ? "Creating participant agent…" : "Create participant agent"}
                  </button>
                )}
              <button
                type="button"
                onClick={() => setStep(4)}
                disabled={!participantUaid}
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: "9999px",
                  border: "none",
                  backgroundColor: participantUaid ? "#2563eb" : "#9ca3af",
                  color: "white",
                  fontWeight: 600,
                  cursor: participantUaid ? "pointer" : "not-allowed",
                  opacity: participantUaid ? 1 : 0.7,
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </section>
      )}

      {step === 4 && (
        <section
          style={{
            padding: "1.75rem 1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid rgba(148, 163, 184, 0.6)",
            backgroundColor: "white",
            marginBottom: orgChoice === "create" ? "1rem" : 0,
          }}
        >
          <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>4. Organization</h2>
          <p style={{ marginBottom: "1rem", lineHeight: 1.5 }}>
            Choose whether to connect to an existing organization agent, skip organization connection, or create a new
            organization agent.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer" }}>
              <input
                type="radio"
                name="orgChoice"
                checked={orgChoice === "connect"}
                onChange={() => setOrgChoice("connect")}
              />
              <span>Connect to an existing organization agent</span>
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer" }}>
              <input
                type="radio"
                name="orgChoice"
                checked={orgChoice === "skip"}
                onChange={() => setOrgChoice("skip")}
              />
              <span>Don&apos;t connect to any organization</span>
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer" }}>
              <input
                type="radio"
                name="orgChoice"
                checked={orgChoice === "create"}
                onChange={() => setOrgChoice("create")}
              />
              <span>Create a new organization agent</span>
            </label>
          </div>

          {orgChoice === "connect" && (
            <div
              style={{
                padding: "1rem",
                borderRadius: "0.5rem",
                backgroundColor: "#f8fafc",
                border: "1px solid #e2e8f0",
                marginBottom: "1rem",
              }}
            >
              {userEmail && userOrganizations.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "0.75rem",
                    marginBottom: "1rem",
                  }}
                >
                  <div style={{ fontSize: "0.9rem", color: "#64748b" }}>
                    {isLoadingOrganizations ? "Loading your organizations…" : "Select from your organizations"}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowOrgConnectSelector(true)}
                    disabled={isLoadingOrganizations}
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "9999px",
                      border: "none",
                      backgroundColor: isLoadingOrganizations ? "#9ca3af" : "#2563eb",
                      color: "white",
                      fontWeight: 600,
                      cursor: isLoadingOrganizations ? "not-allowed" : "pointer",
                      opacity: isLoadingOrganizations ? 0.7 : 1,
                    }}
                  >
                    Select from my orgs
                  </button>
                </div>
              )}

              <div style={{ marginTop: "1rem" }}>
                <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Search organization agents</div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="text"
                    value={orgSearchQuery}
                    onChange={(e) => setOrgSearchQuery(e.target.value)}
                    placeholder="e.g. myorg.8004-agent.eth or jane-smith"
                    style={{
                      flex: 1,
                      padding: "0.5rem 0.75rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #cbd5f5",
                    }}
                  />
                  <button
                    type="button"
                    onClick={runOrgSearch}
                    disabled={orgSearchLoading}
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "0.5rem",
                      border: "none",
                      backgroundColor: "#2563eb",
                      color: "white",
                      fontWeight: 600,
                      cursor: orgSearchLoading ? "not-allowed" : "pointer",
                      opacity: orgSearchLoading ? 0.7 : 1,
                    }}
                  >
                    {orgSearchLoading ? "Searching…" : "Search"}
                  </button>
                </div>
                {orgSearchError && (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#b91c1c" }}>
                    {orgSearchError}
                  </div>
                )}
                {orgSearchResults.length > 0 && (
                  <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {orgSearchResults.map((a, idx) => {
                      const label =
                        a?.ensName || a?.agentName || a?.name || a?.did || `Result ${idx + 1}`;
                      return (
                        <div
                          key={idx}
                          style={{
                            padding: "0.75rem",
                            borderRadius: "0.5rem",
                            border: "1px solid #e2e8f0",
                            backgroundColor: "white",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "0.75rem",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{label}</div>
                            <div style={{ fontSize: "0.85rem", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {a?.did || a?.uaid || ""}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void connectToOrgAgent(a)}
                            style={{
                              padding: "0.5rem 0.75rem",
                              borderRadius: "0.5rem",
                              border: "none",
                              backgroundColor: "#16a34a",
                              color: "white",
                              fontWeight: 600,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Use this agent
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {orgChoice === "skip" && (
            <div
              style={{
                padding: "1rem",
                borderRadius: "0.5rem",
                backgroundColor: "#fff7ed",
                border: "1px solid #fdba74",
                marginBottom: "1rem",
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>No organization connection</div>
              <div style={{ fontSize: "0.9rem", color: "#7c2d12" }}>
                You can continue without linking to an organization agent.
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.25rem" }}>
            <button
              type="button"
              onClick={() => setStep(3)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "9999px",
                border: "1px solid #cbd5f5",
                backgroundColor: "white",
                cursor: "pointer",
              }}
            >
              Back
            </button>

            {orgChoice === "skip" ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    if (typeof window !== "undefined") {
                      localStorage.removeItem("itg_default_org_agent");
                      Object.keys(localStorage)
                        .filter((key) => key.startsWith("itg_agent_details_"))
                        .forEach((key) => localStorage.removeItem(key));
                    }
                  } catch (e) {
                    void e;
                  }
                  setDefaultOrgAgent(null);
                  setItg(null);
                  setStep(6);
                }}
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: "9999px",
                  border: "none",
                  backgroundColor: "#2563eb",
                  color: "white",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Continue
              </button>
            ) : orgChoice === "connect" ? (
              <button
                type="button"
                onClick={() => setShowOrgConnectSelector(true)}
                disabled={isLoadingOrganizations || userOrganizations.length === 0}
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: "9999px",
                  border: "none",
                  backgroundColor:
                    isLoadingOrganizations || userOrganizations.length === 0 ? "#9ca3af" : "#2563eb",
                  color: "white",
                  fontWeight: 600,
                  cursor:
                    isLoadingOrganizations || userOrganizations.length === 0 ? "not-allowed" : "pointer",
                  opacity: isLoadingOrganizations || userOrganizations.length === 0 ? 0.7 : 1,
                }}
              >
                Select agent
              </button>
            ) : orgChoice === "create" ? (
              <button
                type="button"
                onClick={() => setStep(5)}
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: "9999px",
                  border: "none",
                  backgroundColor: "#2563eb",
                  color: "white",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Continue
              </button>
            ) : null}
          </div>
        </section>
      )}

      {step === 5 && orgChoice === "create" && (
        <section
          style={{
            padding: "1.75rem 1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid rgba(148, 163, 184, 0.6)",
            backgroundColor: "white"
          }}
        >
          <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            5. Organization details
          </h2>

          {user && (
            <div style={{ marginBottom: "1rem", lineHeight: 1.5 }}>
              <p>
                Signed in as{" "}
                <strong>
                  {user.name}
                  {userEmail ? ` (${userEmail})` : userPhone ? ` (${userPhone})` : ""}
                </strong>
                .
              </p>
              {orgEnsAvailability.ensName && (
                <div style={{ marginTop: "0.75rem" }}>
                  <strong style={{ color: "#1e40af" }}>ENS Domain:</strong>{" "}
                  <span
                  style={{
                    fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
                      color: "#1e3a8a",
                      fontSize: "0.9rem"
                  }}
                >
                    {orgEnsAvailability.ensName}
                  </span>
                  {orgEnsAvailability.checking ? (
                    <div style={{ fontSize: "0.85rem", color: "#64748b", marginTop: "0.25rem" }}>
                      Checking availability...
                    </div>
                  ) : orgEnsAvailability.available !== null ? (
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: orgEnsAvailability.available ? "#16a34a" : "#dc2626",
                        fontWeight: 500,
                        marginTop: "0.25rem"
                      }}
                    >
                      {orgEnsAvailability.available
                        ? "✓ Available - This ENS name is available for registration"
                        : "✗ Not Available - This ENS name is already taken"}
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.85rem", color: "#64748b", marginTop: "0.25rem" }}>
                      Unable to check availability
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div
            style={{
              padding: "1rem",
              marginBottom: "1rem",
              borderRadius: "0.5rem",
              backgroundColor: "#f8fafc",
              border: "1px solid #e2e8f0",
            }}
          >
            <div style={{ marginBottom: "0.75rem", fontWeight: 600, fontSize: "0.9rem" }}>
              Agent Name
            </div>
            <div style={{ marginBottom: "0.5rem", fontSize: "0.85rem", color: "#64748b" }}>
              Enter the agent name you want to register (no automatic suffixes).
            </div>
            <input
              type="text"
              value={customAgentName}
              onChange={(e) => setCustomAgentName(e.target.value)}
              placeholder="e.g. richcanvas"
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                borderRadius: "0.5rem",
                border: "1px solid #cbd5f5",
                fontSize: "0.9rem",
              }}
            />
            <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#64748b" }}>
              Must be 3-63 chars: lowercase letters, numbers, hyphens.
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>Organization name</span>
              <input
                type="text"
                value={org.name}
                onChange={(e) => handleOrgChange("name", e.target.value)}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #cbd5f5"
                }}
              />
              {emailDomain && (
                <span
                  style={{
                    marginTop: "0.25rem",
                    fontSize: "0.8rem",
                    color: "#6b7280"
                  }}
                >
                  Email domain from your login:{" "}
                  <strong>{emailDomain}</strong>. This domain should be
                  associated with this organization.
                </span>
              )}
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>Organization address</span>
              <input
                type="text"
                value={org.address}
                onChange={(e) => handleOrgChange("address", e.target.value)}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #cbd5f5"
                }}
              />
            </label>

            <div
              style={{
                padding: "1rem",
                borderRadius: "0.5rem",
                backgroundColor: "#f8fafc",
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.9rem" }}>
                Organization role
              </div>
              <div style={{ fontSize: "0.85rem", color: "#64748b", lineHeight: 1.5 }}>
                We auto-set this based on your individual role during onboarding:
                <div style={{ marginTop: "0.35rem", color: "#111827", fontWeight: 600 }}>
                  {defaultOrgRoleForIndividual}
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: "1.5rem"
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setStep(4);
              }}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "9999px",
                border: "1px solid #cbd5f5",
                backgroundColor: "white",
                cursor: "pointer"
              }}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleOrgNext}
              disabled={isCheckingAvailability}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "9999px",
                border: "none",
                backgroundColor: "#2563eb",
                color: "white",
                fontWeight: 600,
                cursor: isCheckingAvailability ? "not-allowed" : "pointer",
                opacity: isCheckingAvailability ? 0.7 : 1
              }}
            >
              {isCheckingAvailability ? "Checking availability…" : "Continue"}
            </button>
          </div>
        </section>
      )}

      {step === 6 && orgChoice === "create" && !itg && (
        <section
          style={{
            padding: "1.75rem 1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid rgba(148, 163, 184, 0.6)",
            backgroundColor: "white"
          }}
        >
          <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            6. Organization summary
          </h2>
          
          {(() => {
            // Calculate the ENS name that will be used
            const agentName = normalizedOrgAgentName;
            const ensOrgName = "8004-agent";
            const ensName = `${agentName}.${ensOrgName}.eth`;
            
            return (
              <div
                style={{
                  padding: "1rem",
                  marginBottom: "1.5rem",
                  borderRadius: "0.5rem",
                  backgroundColor: "#f0f9ff",
                  border: "2px solid #3b82f6",
                  lineHeight: 1.6
                }}
              >
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong style={{ color: "#1e40af" }}>ENS Name:</strong>{" "}
                  <span
                    style={{
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
                      color: "#1e3a8a",
                      fontSize: "0.95rem"
                    }}
                  >
                    {ensName}
                  </span>
                </div>
                {org.name && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <strong style={{ color: "#1e40af" }}>Organization Name:</strong>{" "}
                    <span>{org.name}</span>
                  </div>
                )}
                {org.address && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <strong style={{ color: "#1e40af" }}>Organization Address:</strong>{" "}
                    <span>{org.address}</span>
                  </div>
            )}
                {emailDomain && (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "#64748b" }}>
                    <strong>Email Domain:</strong> {emailDomain}
                  </div>
                )}
              </div>
            );
          })()}

          <p style={{ marginBottom: "1.5rem" }}>
            Is it OK to create an Impact Organization Identity for this organization now?
          </p>

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setStep(5);
              }}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "9999px",
                border: "1px solid #cbd5f5",
                backgroundColor: "white",
                cursor: "pointer"
              }}
            >
              Go back
            </button>
            <button
              type="button"
              onClick={handleCreateItg}
              disabled={isCreatingItg}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "9999px",
                border: "none",
                backgroundColor: "#16a34a",
                color: "white",
                fontWeight: 600,
                cursor: isCreatingItg ? "not-allowed" : "pointer",
                opacity: isCreatingItg ? 0.7 : 1
              }}
            >
              {isCreatingItg ? "Creating Impact Organization Identity…" : "Yes, create Impact Organization Identity"}
            </button>
          </div>

          {isCreatingItg && (
            <div
              style={{
                padding: "1rem",
                marginTop: "1rem",
                borderRadius: "0.5rem",
                backgroundColor: "#ecfdf5",
                border: "1px solid rgba(22,163,74,0.35)",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: "0.5rem", color: "#14532d" }}>
                Creating organization identity (up to ~3 minutes)
              </div>
              <div style={{ height: 10, borderRadius: 9999, backgroundColor: "rgba(22,163,74,0.15)", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round(orgCreateProgress * 100)}%`,
                    backgroundColor: "#16a34a",
                    transition: "width 250ms linear",
                  }}
                />
              </div>
              <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#166534" }}>
                {orgCreateStatus || "Working…"}
              </div>
            </div>
          )}

          {emailDomain && (
            <p
              style={{
                marginTop: "1rem",
                fontSize: "0.85rem",
                color: "#4b5563"
              }}
            >
              If this email domain is not associated with the organization,
              you can{" "}
              <button
                type="button"
                onClick={handleDisconnectAndReset}
                style={{
                  padding: 0,
                  border: "none",
                  background: "none",
                  color: "#2563eb",
                  cursor: "pointer",
                  textDecoration: "underline",
                  fontSize: "0.85rem"
                }}
              >
                disconnect and sign in with a different account
              </button>{" "}
              before creating the Impact Organization Identity.
            </p>
          )}
        </section>
      )}

      {step === 6 && (orgChoice !== "create" || Boolean(itg)) && (
        <section
          style={{
            padding: "1.75rem 1.5rem",
            borderRadius: "0.75rem",
            border: "1px solid rgba(34, 197, 94, 0.7)",
            background:
              "linear-gradient(to bottom right, rgba(22,163,74,0.08), rgba(22,163,74,0.02))"
          }}
        >
          <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            6. Finish
          </h2>

          <p style={{ marginBottom: "1rem", lineHeight: 1.5 }}>
            Your participant agent has been created and saved to your profile.
          </p>

          {participantUaid && (
            <div
              style={{
                padding: "0.85rem 1rem",
                borderRadius: "0.5rem",
                backgroundColor: "white",
                border: "1px dashed rgba(34, 197, 94, 0.7)",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
                marginBottom: "1rem",
              }}
            >
              {canonicalizeUaid(participantUaid) ?? String(participantUaid).split(";")[0]}
            </div>
          )}

          {itg ? (
            <>
              <p style={{ marginBottom: "0.75rem", lineHeight: 1.5 }}>
                Organization agent connected/created:
              </p>
              <div
                style={{
                  padding: "0.85rem 1rem",
                  borderRadius: "0.5rem",
                  backgroundColor: "white",
                  border: "1px dashed rgba(34, 197, 94, 0.7)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
                }}
              >
                {itg}
              </div>
            </>
          ) : (
            <p style={{ marginBottom: "1rem", lineHeight: 1.5, color: "#14532d" }}>
              No organization agent connected.
            </p>
          )}

          <p style={{ marginTop: "1.25rem", marginBottom: "1.25rem" }}>
            Next, you&apos;ll move into the application environment where we
            manage operations, resources, and coalition using this Impact.
          </p>

          <button
            type="button"
            onClick={goToAppEnvironment}
            style={{
              padding: "0.6rem 1.35rem",
              borderRadius: "9999px",
              border: "none",
              backgroundColor: "#2563eb",
              color: "white",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Go to application environment
          </button>
        </section>
      )}
    </main>
    </>
  );
}


