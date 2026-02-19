"use client";

import * as React from "react";

export interface ConnectionUser {
  name: string;
  email: string;
}

interface ConnectionContextValue {
  user: ConnectionUser | null;
  setUser: (user: ConnectionUser | null) => void;
}

export const ConnectionContext = React.createContext<ConnectionContextValue | undefined>(
  undefined
);

const USER_STORAGE_KEY = "arn_connection_user";

function loadUserFromStorage(): ConnectionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(USER_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as ConnectionUser;
    }
  } catch (e) {
    console.warn("Failed to load user from storage:", e);
  }
  return null;
}

function saveUserToStorage(user: ConnectionUser | null): void {
  if (typeof window === "undefined") return;
  try {
    if (user) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_STORAGE_KEY);
    }
  } catch (e) {
    console.warn("Failed to save user to storage:", e);
  }
}

export function ConnectionProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const [user, setUserState] = React.useState<ConnectionUser | null>(() => 
    loadUserFromStorage()
  );

  const setUser = React.useCallback((newUser: ConnectionUser | null) => {
    setUserState(newUser);
    saveUserToStorage(newUser);
  }, []);

  const value = React.useMemo(
    () => ({
      user,
      setUser
    }),
    [user, setUser]
  );

  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  const ctx = React.useContext(ConnectionContext);
  if (!ctx) {
    throw new Error("useConnection must be used within a ConnectionProvider");
  }
  return ctx;
}


