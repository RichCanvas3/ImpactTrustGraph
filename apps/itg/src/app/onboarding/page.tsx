"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useConnection } from "../../components/connection-context";
import { useWeb3Auth } from "../../components/Web3AuthProvider";
import { useStandardConnect } from "../../components/useStandardConnect";

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
  associateUserWithOrganization,
  associateUserWithOrganizationByEoa,
  getUserProfile,
  getUserOrganizations,
  type OrganizationAssociation,
  type UserProfile,
} from "../service/userProfileService";
import { useDefaultOrgAgent, type DefaultOrgAgent } from "../../components/useDefaultOrgAgent";
import { OrgAgentSelector } from "../../components/OrgAgentSelector";

type OrgType =
  | "organization"
  | "coalition"
  | "contributor"
  | "funder";

interface OrgDetails {
  name: string;
  address: string;
  type: OrgType | "";
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
    type: ""
  });
  const [itg, setItg] = React.useState<string | null>(null);
  const [walletAddress, setWalletAddress] = React.useState<string | null>(null);
  const [aaAddress, setAaAddress] = React.useState<string | null>(null);
  const [firstName, setFirstName] = React.useState<string>("");
  const [lastName, setLastName] = React.useState<string>("");
  const [existingIndividualProfile, setExistingIndividualProfile] = React.useState<UserProfile | null>(null);
  const [isCreatingItg, setIsCreatingItg] = React.useState(false);
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

  const effectiveRole: StakeholderRole = React.useMemo(() => {
    if (urlRole) return urlRole;
    const profRoleRaw = typeof existingIndividualProfile?.role === "string" ? existingIndividualProfile.role : "";
    const profRole = profRoleRaw.trim().toLowerCase();
    if (profRole === "coordinator") return "coordinator";
    if (profRole === "contributor") return "contributor";
    if (profRole === "org-admin" || profRole === "organization-admin" || profRole === "organization") return "org-admin";
    if (profRole === "funder" || profRole === "grantmaker") return "funder";
    if (profRole === "admin" || profRole === "system-admin") return "admin";
    return "org-admin";
  }, [urlRole, existingIndividualProfile?.role]);

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

  // Role-specific organization fields (stored in organizations.org_metadata as JSON).
  const [orgSector, setOrgSector] = React.useState<string>("");
  const [orgPrograms, setOrgPrograms] = React.useState<string>("");
  const [orgServiceAreas, setOrgServiceAreas] = React.useState<string>("");
  const [orgAnnualBudget, setOrgAnnualBudget] = React.useState<string>("");

  const [funderEntityType, setFunderEntityType] = React.useState<string>("");
  const [funderFocusAreas, setFunderFocusAreas] = React.useState<string>("");
  const [funderGeographicScope, setFunderGeographicScope] = React.useState<string>("");
  const [funderComplianceRequirements, setFunderComplianceRequirements] = React.useState<string>("");

  // Helpful defaults by role.
  React.useEffect(() => {
    setOrg((prev) => {
      if (prev.type) return prev;
      if (effectiveRole === "coordinator") return { ...prev, type: "coalition" };
      if (effectiveRole === "contributor") return { ...prev, type: "contributor" };
      if (effectiveRole === "funder") return { ...prev, type: "funder" };
      return prev;
    });
  }, [effectiveRole]);

  // Participant agent (created for the individual onboarding)
  const [participantAgentName, setParticipantAgentName] = React.useState<string>("");
  const [isCreatingParticipant, setIsCreatingParticipant] = React.useState(false);
  const [participantEnsName, setParticipantEnsName] = React.useState<string | null>(null);
  const [participantUaid, setParticipantUaid] = React.useState<string | null>(null);
  const [participantEnsAvailability, setParticipantEnsAvailability] = React.useState<{
    checking: boolean;
    available: boolean | null;
    ensName: string | null;
  }>({ checking: false, available: null, ensName: null });

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
          const participantMeta: Record<string, any> = {};
          if (effectiveRole === "contributor") {
            if (contributorSkills.trim()) participantMeta.skills = contributorSkills.trim();
            if (contributorAvailabilityHours.trim()) {
              const n = Number(contributorAvailabilityHours.trim());
              participantMeta.availability_hours_per_week = Number.isFinite(n) ? n : contributorAvailabilityHours.trim();
            }
            if (contributorEngagementPreferences.trim()) {
              participantMeta.engagement_preferences = contributorEngagementPreferences.trim();
            }
          } else if (effectiveRole === "coordinator") {
            if (coordinatorCoalitionName.trim()) participantMeta.coalition_name = coordinatorCoalitionName.trim();
            if (coordinatorScope.trim()) participantMeta.coordination_scope = coordinatorScope.trim();
          } else if (effectiveRole === "funder") {
            if (funderEntityName.trim()) participantMeta.funder_entity_name = funderEntityName.trim();
          }

          const payload: UserProfile = {
            ...(userEmail ? { email: userEmail } : {}),
            role: effectiveRole,
            first_name: firstName || null,
            last_name: lastName || null,
            eoa_address: walletAddress || null,
            aa_address: aaAddress || null,
            ...(Object.keys(participantMeta).length > 0
              ? { participant_metadata: JSON.stringify(participantMeta) }
              : {}),
          };

          await saveUserProfile(payload);

          // Prefer first/last name for in-app display once set.
          const preferred = `${firstName} ${lastName}`.trim();
          if (preferred && user && user.name !== preferred) {
            setUser({ ...user, name: preferred });
          }
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
    contributorSkills,
    contributorAvailabilityHours,
    contributorEngagementPreferences,
    coordinatorCoalitionName,
    coordinatorScope,
    funderEntityName,
    user,
    setUser,
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
          setParticipantUaid((prev) => prev ?? profile.participant_uaid ?? null);
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

    // If we already have everything for steps 2-3, jump to org step.
    if (hasNames && hasParticipant) {
      autoAdvancedEoaRef.current = eoa;
      setStep(4);
      return;
    }

    // If we already have names, proceed to participant agent step.
    if (hasNames) {
      autoAdvancedEoaRef.current = eoa;
      setStep(3);
    }
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
      if (!walletAddress) {
        setError("Missing wallet address. Please reconnect and try again.");
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
        // UAID is canonical. Try to use it from the selected agent card; otherwise hydrate via by-account.
        let effectiveUaid: string | null =
          typeof agent?.uaid === "string" && agent.uaid.trim()
            ? agent.uaid.trim()
            : typeof agent?.agent?.uaid === "string" && agent.agent.uaid.trim()
              ? agent.agent.uaid.trim()
              : null;
        if (!effectiveUaid && agentAccount && chainId) {
          try {
            const didEthr = `did:ethr:${chainId}:${agentAccount}`;
            const agentResp = await fetch(`/api/agents/by-account/${encodeURIComponent(didEthr)}`);
            const agentData = agentResp.ok ? await agentResp.json().catch(() => null) : null;
            effectiveUaid =
              agentData && agentData.found === true && typeof agentData.uaid === "string" && agentData.uaid.trim()
                ? String(agentData.uaid).trim()
                : typeof agentData?.agent?.uaid === "string" && agentData.agent.uaid.trim()
                  ? String(agentData.agent.uaid).trim()
                  : null;
          } catch {
            // ignore; handled below
          }
        }
        if (effectiveUaid) {
          (defaultAgent as any).uaid = effectiveUaid;
        }

        if (userEmail) {
          await associateUserWithOrganization(userEmail, {
            ens_name: ensName,
            agent_name: agentName,
            org_name: agent?.name || undefined,
            org_address: undefined,
            org_type: undefined,
            email_domain: emailDomain ?? "unknown",
            agent_account: agentAccount || undefined,
            uaid: effectiveUaid,
            chain_id: chainId,
            is_primary: false,
            role: undefined,
          });
        } else {
          await associateUserWithOrganizationByEoa(
            walletAddress,
            {
              ens_name: ensName,
              agent_name: agentName,
              org_name: agent?.name || undefined,
              org_address: undefined,
              org_type: undefined,
              email_domain: emailDomain ?? "unknown",
              agent_account: agentAccount || undefined,
              uaid: effectiveUaid,
              chain_id: chainId,
              is_primary: false,
              role: undefined,
            },
            null,
          );
        }
      } catch (e) {
        console.warn("[onboarding] Failed to persist org association:", e);
      }

      setDefaultOrgAgent(defaultAgent);
      setItg(ensName);
      setStep(6);
    },
    [walletAddress, userEmail, setDefaultOrgAgent, emailDomain],
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
    setError(null);

    try {
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

      const agentUrl = `https://${agentName}.8004-agent.io`;
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

      setParticipantEnsName(ensName);

      // Generate UAID for the participant smart account (admin-compatible endpoint).
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
          createdUaid = uaidValue;
          setParticipantUaid(uaidValue);
        }
      } catch {
        // ignore
      }

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
        participant_metadata: (() => {
          const participantMeta: Record<string, any> = {};
          if (effectiveRole === "contributor") {
            if (contributorSkills.trim()) participantMeta.skills = contributorSkills.trim();
            if (contributorAvailabilityHours.trim()) {
              const n = Number(contributorAvailabilityHours.trim());
              participantMeta.availability_hours_per_week = Number.isFinite(n) ? n : contributorAvailabilityHours.trim();
            }
            if (contributorEngagementPreferences.trim()) participantMeta.engagement_preferences = contributorEngagementPreferences.trim();
          } else if (effectiveRole === "coordinator") {
            if (coordinatorCoalitionName.trim()) participantMeta.coalition_name = coordinatorCoalitionName.trim();
            if (coordinatorScope.trim()) participantMeta.coordination_scope = coordinatorScope.trim();
          } else if (effectiveRole === "funder") {
            if (funderEntityName.trim()) participantMeta.funder_entity_name = funderEntityName.trim();
          }
          return Object.keys(participantMeta).length ? JSON.stringify(participantMeta) : null;
        })(),
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("user rejected") || msg.includes("User denied")) {
        setError("Transaction was cancelled. Please try again when ready.");
      } else {
        setError(`Failed to create participant agent: ${msg}`);
      }
    } finally {
      setIsCreatingParticipant(false);
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
    contributorSkills,
    contributorAvailabilityHours,
    contributorEngagementPreferences,
    coordinatorCoalitionName,
    coordinatorScope,
    funderEntityName,
  ]);

  const handleOrgNext = React.useCallback(async () => {
    if (!org.name || !org.address || !org.type) {
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
        address: "",
        type: ""
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
    setError(null);

    try {
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

      // Compute the counterfactual AA address for the agent using the client helper.
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
        const agentUrl = `https://${agentName}.8004-agent.io`;
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
        
        // Verify that the result indicates successful creation
        // Check for agentId or other success indicators
        if (result && (result as any)?.agentId !== undefined) {
          agentCreationSuccessful = true;
        } else {
          // If result doesn't have expected success indicators, treat as failure
          console.warn("[onboarding] Agent creation result missing success indicators:", result);
          throw new Error("Agent creation did not return expected success indicators");
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
      if (agentCreationSuccessful && walletAddress) {
        try {
          const ensName = `${agentName}.${ensOrgName}.eth`;
          
          // First, get the actual agent account address from the result or fetch it
          let actualAgentAccount = agentAccountAddress;
          
          // Try to get agent ID from result if available
          let agentId: string | bigint | undefined = (result as any)?.agentId;
          
          // If we have an agent ID, fetch full agent details
          // Otherwise, try to fetch by account address
          let fullAgentDetails: any = null;
          
          try {
            // Wait a moment for the agent to be indexed
            await new Promise((resolve) => setTimeout(resolve, 1000));
            
            // Try to fetch by account address first
            const didEthr = `did:ethr:${sepolia.id}:${agentAccountAddress}`;
            const encodedDid = encodeURIComponent(didEthr);
            const agentResponse = await fetch(`/api/agents/by-account/${encodedDid}`);
            
            if (agentResponse.ok) {
              const agentResult = await agentResponse.json();
              if (agentResult?.found === true) {
                fullAgentDetails = agentResult;
                actualAgentAccount = agentResult.agentAccount || agentAccountAddress;
                agentId = agentResult.agentId;
                console.info("[onboarding] Fetched full agent details after creation:", agentResult.agentId);
              } else {
                // Agent was not found on-chain - this means creation failed
                console.error("[onboarding] Agent creation verification failed: agent not found on-chain");
                throw new Error("Agent was not found on-chain after creation. The transaction may have failed.");
              }
            } else {
              // Failed to verify agent existence
              console.error("[onboarding] Failed to verify agent creation on-chain");
              throw new Error("Failed to verify agent creation on-chain");
            }
          } catch (fetchError) {
            console.error("[onboarding] Failed to verify agent creation, aborting database association:", fetchError);
            // Re-throw to prevent database record creation
            throw fetchError;
          }
          
          // Generate UAID for the org smart account (best-effort).
          let createdOrgUaid: string | null = null;
          try {
            const uaidRes = await fetch("/api/agents/generate-uaid", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                agentAccount: actualAgentAccount,
                chainId: sepolia.id,
                uid: `did:ethr:${sepolia.id}:${String(actualAgentAccount).toLowerCase()}`,
                registry: "smart-agent",
                proto: "a2a",
                nativeId: `eip155:${sepolia.id}:${String(actualAgentAccount).toLowerCase()}`,
              }),
            });
            const uaidJson = await uaidRes.json().catch(() => ({} as any));
            const uaidValue = typeof uaidJson?.uaid === "string" ? uaidJson.uaid.trim() : "";
            if (uaidValue) {
              createdOrgUaid = uaidValue;
              setOrgUaid(uaidValue);
            }
          } catch {
            // ignore
          }

          const hydratedOrgUaid: string | null =
            typeof createdOrgUaid === "string" && createdOrgUaid.trim()
              ? createdOrgUaid.trim()
              : typeof (fullAgentDetails as any)?.uaid === "string" && String((fullAgentDetails as any).uaid).trim()
                ? String((fullAgentDetails as any).uaid).trim()
                : typeof (fullAgentDetails as any)?.agent?.uaid === "string" && String((fullAgentDetails as any).agent.uaid).trim()
                  ? String((fullAgentDetails as any).agent.uaid).trim()
                  : null;

          const orgAssociationPayload = {
            ens_name: ensName,
            agent_name: agentName,
            org_name: org.name || undefined,
            org_address: org.address || undefined,
            org_type: org.type || undefined,
            email_domain: emailDomain ?? "unknown",
            agent_account: actualAgentAccount,
            uaid: hydratedOrgUaid,
            org_metadata: (() => {
              const m: Record<string, any> = {};
              if (effectiveRole === "org-admin") {
                if (orgSector.trim()) m.sector = orgSector.trim();
                if (orgPrograms.trim()) m.programs = orgPrograms.trim();
                if (orgServiceAreas.trim()) m.service_areas = orgServiceAreas.trim();
                if (orgAnnualBudget.trim()) {
                  const n = Number(orgAnnualBudget.trim());
                  m.annual_budget = Number.isFinite(n) ? n : orgAnnualBudget.trim();
                }
              } else if (effectiveRole === "funder") {
                if (funderEntityType.trim()) m.entity_type = funderEntityType.trim();
                if (funderFocusAreas.trim()) m.focus_areas = funderFocusAreas.trim();
                if (funderGeographicScope.trim()) m.geographic_scope = funderGeographicScope.trim();
                if (funderComplianceRequirements.trim()) m.compliance_requirements = funderComplianceRequirements.trim();
              } else if (effectiveRole === "coordinator") {
                if (coordinatorCoalitionName.trim()) m.coalition_name = coordinatorCoalitionName.trim();
                if (coordinatorScope.trim()) m.coordination_scope = coordinatorScope.trim();
              }
              return Object.keys(m).length ? JSON.stringify(m) : null;
            })(),
            chain_id: sepolia.id,
            is_primary: true, // This is the primary org based on email domain
          };

          // Only create database record if agent was successfully verified on-chain
          if (userEmail) {
            await associateUserWithOrganization(userEmail, orgAssociationPayload);
          } else {
            await associateUserWithOrganizationByEoa(walletAddress, orgAssociationPayload, null);
          }

          // Set as default org agent with full details
          const defaultAgent: DefaultOrgAgent = {
            ensName,
            agentName,
            agentAccount: actualAgentAccount,
            agentId: agentId || fullAgentDetails?.agentId,
            chainId: sepolia.id,
            name: fullAgentDetails?.name || agentName,
            description: fullAgentDetails?.description || (result as any)?.description || 'itg account',
            image: fullAgentDetails?.image || (result as any)?.image || 'https://www.google.com',
            agentUrl: fullAgentDetails?.agentUrl || (result as any)?.agentUrl || 'https://www.google.com',
            tokenUri: fullAgentDetails?.tokenUri || (result as any)?.tokenUri,
            metadata: fullAgentDetails?.metadata || (result as any)?.metadata,
            did: fullAgentDetails?.did,
            a2aEndpoint: fullAgentDetails?.a2aEndpoint || (result as any)?.a2aEndpoint,
            ...(hydratedOrgUaid ? { uaid: hydratedOrgUaid } : {}),
            ...(fullAgentDetails || result as any),
          };
          
          console.info("[onboarding] Setting default agent with full details:", {
            agentName: defaultAgent.agentName,
            agentAccount: defaultAgent.agentAccount,
            agentId: defaultAgent.agentId,
            did: defaultAgent.did,
          });
          
          // Pass email directly to ensure localStorage is saved
          setDefaultOrgAgent(defaultAgent);
          
          // Wait a moment to ensure state is saved before any navigation
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          console.warn("Failed to associate user with organization:", error);
        }
      }

      // For the Impact onboarding UI, treat a successful client-side flow as success
      // and use the human-readable agent name as the Impact identifier.
      setItg(agentName);
      setStep(6);
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
    }
  }, [
    normalizedOrgAgentName,
    isValidAgentName,
    org.name,
    org.address,
    org.type,
    web3auth,
    user?.email,
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
            if (user?.email) {
              setDefaultOrgAgent(agent);
            } else {
              setDefaultOrgAgent(agent);
            }
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

            {effectiveRole === "contributor" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span>Skills (comma-separated)</span>
                  <input
                    type="text"
                    value={contributorSkills}
                    onChange={(e) => setContributorSkills(e.target.value)}
                    placeholder="e.g. Data Analysis, Grant Writing"
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #cbd5f5",
                    }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span>Availability (hours/week)</span>
                  <input
                    type="text"
                    value={contributorAvailabilityHours}
                    onChange={(e) => setContributorAvailabilityHours(e.target.value)}
                    placeholder="e.g. 5"
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #cbd5f5",
                    }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span>Engagement preferences</span>
                  <input
                    type="text"
                    value={contributorEngagementPreferences}
                    onChange={(e) => setContributorEngagementPreferences(e.target.value)}
                    placeholder="e.g. short engagements, remote-first"
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #cbd5f5",
                    }}
                  />
                </label>
              </div>
            )}

            {effectiveRole === "coordinator" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span>Coalition name</span>
                  <input
                    type="text"
                    value={coordinatorCoalitionName}
                    onChange={(e) => setCoordinatorCoalitionName(e.target.value)}
                    placeholder="e.g. Unite DFW"
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #cbd5f5",
                    }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span>Coordination scope</span>
                  <input
                    type="text"
                    value={coordinatorScope}
                    onChange={(e) => setCoordinatorScope(e.target.value)}
                    placeholder="e.g. workforce + housing initiatives"
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #cbd5f5",
                    }}
                  />
                </label>
              </div>
            )}

            {effectiveRole === "funder" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span>Funding entity name</span>
                  <input
                    type="text"
                    value={funderEntityName}
                    onChange={(e) => setFunderEntityName(e.target.value)}
                    placeholder="e.g. Example Foundation"
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #cbd5f5",
                    }}
                  />
                </label>
              </div>
            )}
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
                // Profile is already saved incrementally via useEffect
                setStep(3);
              }}
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "9999px",
                border: "none",
                backgroundColor: "#2563eb",
                color: "white",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Continue
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
                  <strong>UAID:</strong> {participantUaid}
                </div>
                {participantEnsName && (
                  <div>
                    <strong>ENS:</strong> {participantEnsName}
                  </div>
                )}
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

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span>Organization type</span>
              <select
                value={org.type}
                onChange={(e) =>
                  handleOrgChange("type", e.target.value as OrgType | "")
                }
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.5rem",
                  border: "1px solid #cbd5f5"
                }}
              >
                <option value="">Select a type…</option>
                <option value="organization">
                  Organization
                </option>
                <option value="coalition">Coalition</option>
                <option value="contributor">Contributor</option>
                <option value="funder">Funder / Grantmaker</option>
                
              </select>
            </label>

            {effectiveRole === "org-admin" && (
              <div
                style={{
                  padding: "1rem",
                  borderRadius: "0.5rem",
                  backgroundColor: "#f8fafc",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ marginBottom: "0.75rem", fontWeight: 600, fontSize: "0.9rem" }}>
                  Organization profile
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span>Sector</span>
                    <input
                      type="text"
                      value={orgSector}
                      onChange={(e) => setOrgSector(e.target.value)}
                      placeholder="e.g. Workforce, Housing, Health"
                      style={{
                        padding: "0.5rem 0.75rem",
                        borderRadius: "0.5rem",
                        border: "1px solid #cbd5f5",
                      }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span>Programs / service areas</span>
                    <input
                      type="text"
                      value={orgPrograms}
                      onChange={(e) => setOrgPrograms(e.target.value)}
                      placeholder="e.g. job placement, wraparound services"
                      style={{
                        padding: "0.5rem 0.75rem",
                        borderRadius: "0.5rem",
                        border: "1px solid #cbd5f5",
                      }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span>Geographic service areas</span>
                    <input
                      type="text"
                      value={orgServiceAreas}
                      onChange={(e) => setOrgServiceAreas(e.target.value)}
                      placeholder="e.g. Dallas County, Tarrant County"
                      style={{
                        padding: "0.5rem 0.75rem",
                        borderRadius: "0.5rem",
                        border: "1px solid #cbd5f5",
                      }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span>Approx annual budget (USD)</span>
                    <input
                      type="text"
                      value={orgAnnualBudget}
                      onChange={(e) => setOrgAnnualBudget(e.target.value)}
                      placeholder="e.g. 2500000"
                      style={{
                        padding: "0.5rem 0.75rem",
                        borderRadius: "0.5rem",
                        border: "1px solid #cbd5f5",
                      }}
                    />
                  </label>
                </div>
              </div>
            )}

            {effectiveRole === "funder" && (
              <div
                style={{
                  padding: "1rem",
                  borderRadius: "0.5rem",
                  backgroundColor: "#f8fafc",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ marginBottom: "0.75rem", fontWeight: 600, fontSize: "0.9rem" }}>
                  Funder profile
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span>Entity type</span>
                    <select
                      value={funderEntityType}
                      onChange={(e) => setFunderEntityType(e.target.value)}
                      style={{
                        padding: "0.5rem 0.75rem",
                        borderRadius: "0.5rem",
                        border: "1px solid #cbd5f5",
                      }}
                    >
                      <option value="">Select…</option>
                      <option value="foundation">Foundation</option>
                      <option value="corporate">Corporate</option>
                      <option value="individual">Individual</option>
                      <option value="government">Government</option>
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span>Funding focus areas</span>
                    <input
                      type="text"
                      value={funderFocusAreas}
                      onChange={(e) => setFunderFocusAreas(e.target.value)}
                      placeholder="e.g. workforce, housing, health equity"
                      style={{
                        padding: "0.5rem 0.75rem",
                        borderRadius: "0.5rem",
                        border: "1px solid #cbd5f5",
                      }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span>Geographic scope</span>
                    <input
                      type="text"
                      value={funderGeographicScope}
                      onChange={(e) => setFunderGeographicScope(e.target.value)}
                      placeholder="e.g. DFW Metroplex"
                      style={{
                        padding: "0.5rem 0.75rem",
                        borderRadius: "0.5rem",
                        border: "1px solid #cbd5f5",
                      }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span>Compliance / reporting requirements</span>
                    <input
                      type="text"
                      value={funderComplianceRequirements}
                      onChange={(e) => setFunderComplianceRequirements(e.target.value)}
                      placeholder="e.g. quarterly reports, outcomes attested"
                      style={{
                        padding: "0.5rem 0.75rem",
                        borderRadius: "0.5rem",
                        border: "1px solid #cbd5f5",
                      }}
                    />
                  </label>
                </div>
              </div>
            )}
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
                {org.type && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <strong style={{ color: "#1e40af" }}>Organization Type:</strong>{" "}
                    <span>
              {org.type === "organization"
                ? "Operational Relief Organization"
                : org.type === "contributor"
                  ? "Organization"
                  : "Coalition"}
                    </span>
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
              {participantUaid}
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


