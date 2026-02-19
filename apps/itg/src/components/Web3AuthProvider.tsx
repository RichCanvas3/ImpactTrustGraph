"use client";

import * as React from "react";

interface Web3AuthContextValue {
  web3auth: any | null;
  isInitializing: boolean;
  error: string | null;
  connect: () => Promise<void>;
  logout: () => Promise<void>;
  getUserInfo: () => Promise<Record<string, any> | null>;
}

const Web3AuthContext = React.createContext<Web3AuthContextValue | undefined>(
  undefined
);

export function Web3AuthProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const [web3auth, setWeb3auth] = React.useState<any | null>(null);
  const [isInitializing, setIsInitializing] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function initWeb3Auth() {
      if (typeof window === "undefined") return;

      try {
        const clientId = process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID;
        if (!clientId) {
          setError(
            "Web3Auth client ID is not configured. Set NEXT_PUBLIC_WEB3AUTH_CLIENT_ID to enable social login."
          );
          return;
        }

        const { Web3Auth } = await import("@web3auth/modal");
        const { OpenloginAdapter } = await import(
          "@web3auth/openlogin-adapter"
        );
        const { EthereumPrivateKeyProvider } = await import(
          "@web3auth/ethereum-provider"
        );
        const { CHAIN_NAMESPACES } = await import("@web3auth/base");

        const chainIdHex = process.env.NEXT_PUBLIC_CHAIN_ID || "0xaa36a7"; // default Sepolia
        const rpcUrl = process.env.NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA;

        if (!rpcUrl) {
          setError(
            "RPC URL is not configured. Set NEXT_PUBLIC_AGENTIC_TRUST_RPC_URL_SEPOLIA to enable Web3Auth."
          );
          return;
        }

        const chainConfig = {
          chainNamespace: CHAIN_NAMESPACES.EIP155,
          chainId: chainIdHex,
          rpcTarget: rpcUrl,
          displayName: "EVM Chain",
          ticker: "ETH",
          tickerName: "Ethereum",
          decimals: 18
        };

        const privateKeyProvider = new EthereumPrivateKeyProvider({
          config: { chainConfig }
        });

        const web3authInstance = new Web3Auth({
          clientId,
          web3AuthNetwork: "sapphire_devnet",
          privateKeyProvider
        });

        const openloginAdapter = new OpenloginAdapter({
          loginSettings: {
            mfaLevel: "optional"
          }
        });

        web3authInstance.configureAdapter(openloginAdapter);
        await web3authInstance.initModal();

        if (!cancelled) {
          setWeb3auth(web3authInstance);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError("Failed to initialize Web3Auth. Please try again later.");
        }
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    }

    void initWeb3Auth();

    return () => {
      cancelled = true;
    };
  }, []);

  const connect = React.useCallback(async () => {
    if (!web3auth) return;
    await web3auth.connect();
  }, [web3auth]);

  const logout = React.useCallback(async () => {
    if (!web3auth) return;
    await web3auth.logout();
  }, [web3auth]);

  const getUserInfo = React.useCallback(async () => {
    if (!web3auth) return null;
    try {
      const info = await web3auth.getUserInfo();
      return info ?? null;
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [web3auth]);

  const value = React.useMemo(
    () => ({
      web3auth,
      isInitializing,
      error,
      connect,
      logout,
      getUserInfo
    }),
    [web3auth, isInitializing, error, connect, logout, getUserInfo]
  );

  return (
    <Web3AuthContext.Provider value={value}>
      {children}
    </Web3AuthContext.Provider>
  );
}

export function useWeb3Auth() {
  const ctx = React.useContext(Web3AuthContext);
  if (!ctx) {
    throw new Error("useWeb3Auth must be used within a Web3AuthProvider");
  }
  return ctx;
}


