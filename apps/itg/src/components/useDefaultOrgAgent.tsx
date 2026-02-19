"use client";

import * as React from "react";
import { useConnection } from "./connection-context";

export interface DefaultOrgAgent {
  ensName: string;
  agentName: string;
  agentAccount: string;
  agentId?: string | bigint;
  chainId: number;
  name?: string;
  description?: string;
  image?: string;
  agentUrl?: string;
  tokenUri?: string;
  metadata?: Array<{ key: string; value: string }>;
  did?: string;
  a2aEndpoint?: string;
  [key: string]: unknown;
}

interface DefaultOrgAgentContextType {
  defaultOrgAgent: DefaultOrgAgent | null;
  setDefaultOrgAgent: (agent: DefaultOrgAgent | null, email?: string) => void;
  isLoading: boolean;
}

const DefaultOrgAgentContext = React.createContext<DefaultOrgAgentContextType | undefined>(undefined);

const STORAGE_KEY = "itg_default_org_agent";

/**
 * Provider for default organization agent context
 */
export function DefaultOrgAgentProvider({ children }: { children: React.ReactNode }) {
  const { user } = useConnection();
  const [defaultOrgAgent, setDefaultOrgAgentState] = React.useState<DefaultOrgAgent | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  // Load from localStorage on mount (before user is restored)
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.agent) {
          // Load agent immediately, we'll validate email domain when user is available
          console.info("[useDefaultOrgAgent] Loaded agent from localStorage on mount:", parsed.agent.did || parsed.agent.agentName);
          setDefaultOrgAgentState(parsed.agent);
        } else {
          console.info("[useDefaultOrgAgent] No agent found in localStorage");
        }
      } else {
        console.info("[useDefaultOrgAgent] No stored agent found in localStorage");
      }
    } catch (error) {
      console.warn("[useDefaultOrgAgent] Failed to load default org agent from storage:", error);
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setIsLoading(false);
      console.info("[useDefaultOrgAgent] Finished loading, isLoading set to false");
    }
  }, []); // Run once on mount, don't wait for user

  // Clear agent when user disconnects (user becomes null)
  React.useEffect(() => {
    if (!user) {
      // User disconnected - clear agent state and localStorage
      console.info("[useDefaultOrgAgent] User disconnected, clearing default agent");
      setDefaultOrgAgentState(null);
      try {
        localStorage.removeItem(STORAGE_KEY);
        // Also clear all cached agent details
        Object.keys(localStorage)
          .filter((key) => key.startsWith("itg_agent_details_"))
          .forEach((key) => localStorage.removeItem(key));
        console.info("[useDefaultOrgAgent] Cleared default agent and all cached agent details");
      } catch (error) {
        console.warn("[useDefaultOrgAgent] Failed to clear agent cache on disconnect:", error);
      }
      return;
    }

    // Validate email domain when user becomes available
    if (!user.email) return;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.emailDomain) {
          const emailDomain = user.email.split("@")[1]?.toLowerCase();
          // If email domain doesn't match, clear stored agent
          if (emailDomain && parsed.emailDomain !== emailDomain) {
            console.info("[useDefaultOrgAgent] Email domain changed, clearing stored agent");
            localStorage.removeItem(STORAGE_KEY);
            setDefaultOrgAgentState(null);
          }
        }
      }
    } catch (error) {
      console.warn("[useDefaultOrgAgent] Failed to validate stored agent:", error);
    }
  }, [user]);

  // Save to localStorage when agent changes.
  // This acts as a long‑term browser cache: once set, the org agent is kept
  // until overwritten or the email domain changes (see validation effect above).
  const setDefaultOrgAgent = React.useCallback(
    (agent: DefaultOrgAgent | null, email?: string) => {
      console.info("[useDefaultOrgAgent] setDefaultOrgAgent called, agent:", agent ? "present" : "null", "email:", email || user?.email || "none");
      setDefaultOrgAgentState(agent);
      try {
        if (agent) {
          // Use provided email parameter, fallback to user context email
          const emailToUse = email || user?.email;
          if (emailToUse) {
            const emailDomain = emailToUse.split("@")[1]?.toLowerCase();
            const storageData = {
              agent,
              emailDomain,
              timestamp: Date.now(),
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(storageData));
            console.info("[useDefaultOrgAgent] Saved agent to localStorage with emailDomain:", emailDomain);
          } else {
            // If no email available, still save the agent (email validation will happen later)
            // This ensures the agent is cached even if user context isn't ready yet
            const storageData = {
              agent,
              timestamp: Date.now(),
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(storageData));
            console.info("[useDefaultOrgAgent] Saved agent to localStorage without emailDomain (will validate later)");
          }
        } else {
          // If caller explicitly clears the agent, also clear from storage.
          localStorage.removeItem(STORAGE_KEY);
          console.info("[useDefaultOrgAgent] Cleared agent from localStorage");
        }
      } catch (error) {
        console.warn("[useDefaultOrgAgent] Failed to save default org agent to storage:", error);
      }
    },
    [user?.email]
  );

  return (
    <DefaultOrgAgentContext.Provider value={{ defaultOrgAgent, setDefaultOrgAgent, isLoading }}>
      {children}
    </DefaultOrgAgentContext.Provider>
  );
}

/**
 * Hook to access and manage the default organization agent
 */
export function useDefaultOrgAgent() {
  const context = React.useContext(DefaultOrgAgentContext);
  if (context === undefined) {
    throw new Error("useDefaultOrgAgent must be used within a DefaultOrgAgentProvider");
  }
  return context;
}

