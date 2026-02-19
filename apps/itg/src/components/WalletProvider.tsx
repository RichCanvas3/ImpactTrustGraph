"use client";

import * as React from "react";
import { useWeb3Auth } from "./Web3AuthProvider";

interface WalletContextValue {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
}

const WalletContext = React.createContext<WalletContextValue | undefined>(
  undefined
);

export function WalletProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const { web3auth, connect, logout } = useWeb3Auth();
  const [address, setAddress] = React.useState<string | null>(null);
  const [isConnecting, setIsConnecting] = React.useState<boolean>(false);

  const refreshAddress = React.useCallback(async () => {
    if (!web3auth?.provider) {
      setAddress(null);
      if (typeof document !== "undefined") {
        document.cookie =
          "wallet_address=; path=/; Max-Age=0; SameSite=Lax; Secure=false";
      }
      return null;
    }

    try {
      const accounts = await (web3auth.provider as any).request({
        method: "eth_accounts"
      });
      const nextAddress =
        Array.isArray(accounts) && accounts.length > 0
          ? (accounts[0] as string)
          : null;
      setAddress(nextAddress);
      if (typeof document !== "undefined") {
        if (nextAddress) {
          document.cookie = `wallet_address=${nextAddress}; path=/; SameSite=Lax; Secure=false`;
        } else {
          document.cookie =
            "wallet_address=; path=/; Max-Age=0; SameSite=Lax; Secure=false";
        }
      }
      return nextAddress;
    } catch (e) {
      console.error(e);
      setAddress(null);
      if (typeof document !== "undefined") {
        document.cookie =
          "wallet_address=; path=/; Max-Age=0; SameSite=Lax; Secure=false";
      }
      return null;
    }
  }, [web3auth]);

  const connectWallet = React.useCallback(async () => {
    if (!web3auth) return;

    setIsConnecting(true);
    try {
      await connect();
      await refreshAddress();
    } finally {
      setIsConnecting(false);
    }
  }, [connect, refreshAddress, web3auth]);

  const disconnectWallet = React.useCallback(async () => {
    try {
      await logout();
    } catch (e) {
      console.error(e);
    } finally {
      setAddress(null);
      if (typeof document !== "undefined") {
        document.cookie =
          "wallet_address=; path=/; Max-Age=0; SameSite=Lax; Secure=false";
      }
    }
  }, [logout]);

  React.useEffect(() => {
    if (!web3auth) {
      setAddress(null);
      return;
    }

    void refreshAddress();
  }, [web3auth, refreshAddress]);

  const value = React.useMemo(
    () => ({
      address,
      isConnected: !!address,
      isConnecting,
      connectWallet,
      disconnectWallet
    }),
    [address, isConnecting, connectWallet, disconnectWallet]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = React.useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return ctx;
}


