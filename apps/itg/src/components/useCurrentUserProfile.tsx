"use client";

import * as React from "react";
import { useConnection } from "./connection-context";
import { useWeb3Auth } from "./Web3AuthProvider";
import { getUserProfile, saveUserProfile, type UserProfile } from "../app/service/userProfileService";
import { normalizeAppRole } from "./appNav";

// Note: we import normalizeAppRole only for runtime mapping;
// AppRole type is re-exported from AppShell to avoid duplication.
import type { AppRole } from "./AppShell";

interface CurrentUserProfileContextValue {
  walletAddress: string | null;
  profile: UserProfile | null;
  role: AppRole | null;
  loading: boolean;
  hasHydrated: boolean;
  refresh: () => Promise<void>;
  setRole: (role: AppRole) => Promise<void>;
}

const CurrentUserProfileContext = React.createContext<CurrentUserProfileContextValue | undefined>(undefined);

export function CurrentUserProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useConnection();
  const { web3auth } = useWeb3Auth();

  const [walletAddress, setWalletAddress] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [hasHydrated, setHasHydrated] = React.useState(false);

  const hydrateRef = React.useRef<string | null>(null);
  const fetchedWalletRef = React.useRef(false);
  React.useEffect(() => {
    if (!user || !web3auth?.provider) {
      fetchedWalletRef.current = false;
      setWalletAddress(null);
      setProfile(null);
      setHasHydrated(false);
      hydrateRef.current = null;
      return;
    }
    if (fetchedWalletRef.current) return;
    fetchedWalletRef.current = true;

    (async () => {
      try {
        const provider = (web3auth as any).provider as
          | { request: (args: { method: string; params?: any[] }) => Promise<any> }
          | undefined;
        if (!provider) return;
        const accounts = await provider.request({ method: "eth_accounts" });
        const account = Array.isArray(accounts) ? accounts[0] : null;
        if (typeof account === "string" && account) {
          setWalletAddress(account);
        }
      } catch (e) {
        console.warn("[CurrentUserProfile] Failed to get wallet address:", e);
      }
    })();
  }, [user, web3auth]);

  const refresh = React.useCallback(async () => {
    if (!walletAddress) return;
    const eoa = walletAddress.toLowerCase();
    setLoading(true);
    try {
      const prof = await getUserProfile(undefined, eoa);
      if (!prof) {
        setProfile(null);
        return;
      }
      const raw = (prof as any).id;
      const n =
        typeof raw === "number" && Number.isFinite(raw) && raw > 0
          ? raw
          : typeof raw === "string"
            ? Number.parseInt(raw, 10)
            : NaN;
      setProfile(Number.isFinite(n) && n > 0 ? ({ ...(prof as any), id: n } as any) : (prof as any));
    } finally {
      setHasHydrated(true);
      setLoading(false);
    }
  }, [walletAddress]);

  React.useEffect(() => {
    if (!walletAddress) return;
    const eoa = walletAddress.toLowerCase();
    // If we haven't hydrated yet, always attempt refresh (even if EOA matches a previous session),
    // otherwise a reconnect can get stuck in "Loading profile…" with a stale hydrateRef.
    if (hydrateRef.current === eoa && hasHydrated) return;
    hydrateRef.current = eoa;
    void refresh().catch((e) => {
      console.warn("[CurrentUserProfile] Failed to hydrate profile:", e);
    });
  }, [walletAddress, refresh, hasHydrated]);

  const role = React.useMemo<AppRole | null>(() => {
    if (profile) {
      return normalizeAppRole(profile.role) as AppRole;
    }
    // If connected but profile isn't created/hydrated yet, default to org_admin for navigation.
    return user ? ("org_admin" as AppRole) : null;
  }, [profile, user]);

  const setRole = React.useCallback(
    async (nextRole: AppRole) => {
      if (!walletAddress) return;
      const eoa = walletAddress.toLowerCase();
      setLoading(true);
      try {
        const updated = await saveUserProfile({
          ...(user?.email ? { email: user.email } : {}),
          eoa_address: eoa,
          role: nextRole,
        });
        setProfile(updated);
      } finally {
        setLoading(false);
      }
    },
    [walletAddress, user?.email],
  );

  const value = React.useMemo(
    () => ({ walletAddress, profile, role, loading, hasHydrated, refresh, setRole }),
    [walletAddress, profile, role, loading, hasHydrated, refresh, setRole],
  );

  return <CurrentUserProfileContext.Provider value={value}>{children}</CurrentUserProfileContext.Provider>;
}

export function useCurrentUserProfile() {
  const ctx = React.useContext(CurrentUserProfileContext);
  if (!ctx) throw new Error("useCurrentUserProfile must be used within CurrentUserProfileProvider");
  return ctx;
}

