"use client";

import * as React from "react";
import { useConnection } from "./connection-context";

export interface DefaultOrgAgent {
  ensName: string;
  agentName: string;
  agentAccount?: string;
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
  setDefaultOrgAgent: (agent: DefaultOrgAgent | null) => void;
  isLoading: boolean;
}

const DefaultOrgAgentContext = React.createContext<DefaultOrgAgentContextType | undefined>(undefined);

const STORAGE_KEY = "itg_default_org_agent";

function normalizeStoredAgent(raw: any): DefaultOrgAgent | null {
  if (!raw || typeof raw !== "object") return null;
  const ensName = String(raw.ensName ?? raw.ens_name ?? raw.ens ?? "").trim();
  let agentName = String(raw.agentName ?? raw.agent_name ?? raw.name ?? "").trim();
  const agentAccount = String(raw.agentAccount ?? raw.agent_account ?? raw.account ?? "").trim();
  const chainIdRaw = raw.chainId ?? raw.chain_id ?? raw.chain ?? 11155111;
  const chainId = typeof chainIdRaw === "number" ? chainIdRaw : Number.parseInt(String(chainIdRaw), 10);
  if (!agentName && ensName) {
    agentName = String(ensName.split(".")[0] || "").trim();
  }
  if (!ensName || !agentName || !Number.isFinite(chainId)) return null;
  const out: DefaultOrgAgent = {
    ...(raw as any),
    ensName,
    agentName,
    chainId,
  };
  if (agentAccount) out.agentAccount = agentAccount;
  return out;
}

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
          const normalized = normalizeStoredAgent(parsed.agent);
          if (!normalized) {
            console.warn("[useDefaultOrgAgent] Stored agent missing required fields; clearing.");
            localStorage.removeItem(STORAGE_KEY);
            setDefaultOrgAgentState(null);
          } else {
            setDefaultOrgAgentState(normalized);
          }
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
  }, [user]);

  // Save to localStorage when agent changes.
  // This acts as a long‑term browser cache: once set, the org agent is kept
  // until overwritten or the email domain changes (see validation effect above).
  const setDefaultOrgAgent = React.useCallback(
    (agent: DefaultOrgAgent | null) => {
      console.info("[useDefaultOrgAgent] setDefaultOrgAgent called, agent:", agent ? "present" : "null");
      const normalized = agent ? normalizeStoredAgent(agent) : null;
      setDefaultOrgAgentState(normalized);
      try {
        if (agent) {
          const storageData = {
            agent: normalized ?? agent,
            timestamp: Date.now(),
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(storageData));
          console.info("[useDefaultOrgAgent] Saved agent to localStorage");
        } else {
          // If caller explicitly clears the agent, also clear from storage.
          localStorage.removeItem(STORAGE_KEY);
          console.info("[useDefaultOrgAgent] Cleared agent from localStorage");
        }
      } catch (error) {
        console.warn("[useDefaultOrgAgent] Failed to save default org agent to storage:", error);
      }
    },
    []
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

