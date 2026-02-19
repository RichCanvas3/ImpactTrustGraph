import * as React from "react";

export interface HelloProps {
  name?: string;
}

/**
 * A simple example React component.
 */
export const HelloMessage: React.FC<HelloProps> = ({ name = "world" }) => {
  return <span>Hello, {name}!</span>;
};

/**
 * A small example hook that manages a boolean toggle state.
 */
export function useToggle(initial: boolean = false) {
  const [on, setOn] = React.useState<boolean>(initial);

  const toggle = React.useCallback(() => {
    setOn((prev) => !prev);
  }, []);

  const setOnTrue = React.useCallback(() => setOn(true), []);
  const setOnFalse = React.useCallback(() => setOn(false), []);

  return { on, toggle, setOn, setOnTrue, setOnFalse };
}

// Export A2A server utilities
export * from './a2a/server';

// Export validation core functions
export * from './validation/core';

// Re-export types for convenience
export type { Request, Response, NextFunction } from 'express';


