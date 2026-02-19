"use client";

import * as React from "react";
import { useConnection } from "./connection-context";
import { useWeb3Auth } from "./Web3AuthProvider";

/**
 * Component that restores Web3Auth connection state on page load
 * Checks if Web3Auth is already connected and restores user info
 */
export function ConnectionRestorer() {
  const { user, setUser } = useConnection();
  const { web3auth, isInitializing, getUserInfo } = useWeb3Auth();
  const hasRestoredRef = React.useRef(false);

  React.useEffect(() => {
    // Wait for Web3Auth to initialize and only restore once
    if (isInitializing || !web3auth || hasRestoredRef.current) {
      return;
    }

    async function restoreConnection() {
      try {
        // Check if Web3Auth is connected (persisted session)
        const isConnected = (web3auth as any).connected;
        
        if (isConnected) {
          const userInfo = await getUserInfo();
          
          if (userInfo) {
            const resolvedName = userInfo?.name ?? "Unknown user";
            const resolvedEmail = userInfo?.email ?? "unknown@example.com";
            
            setUser({
              name: resolvedName,
              email: resolvedEmail
            });
          } else {
            // Web3Auth says connected but can't get user info - clear state
            setUser(null);
          }
        } else {
          // Web3Auth is not connected - clear any stored user
          setUser(null);
        }
        
        hasRestoredRef.current = true;
      } catch (error) {
        console.warn("Failed to restore Web3Auth connection:", error);
        // If restoration fails, clear stored user
        setUser(null);
        hasRestoredRef.current = true;
      }
    }

    void restoreConnection();
  }, [web3auth, isInitializing, getUserInfo, setUser]);

  return null; // This component doesn't render anything
}

