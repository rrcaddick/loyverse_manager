import { createContext, useContext } from "react";

/** Shell-level actions any part of the authenticated app may call. */
export interface ShellContextValue {
  /** Open the keyboard cheat sheet (the `?` dialog). */
  openHelp: () => void;
}

export const ShellContext = createContext<ShellContextValue>({ openHelp: () => {} });

export function useShell(): ShellContextValue {
  return useContext(ShellContext);
}
