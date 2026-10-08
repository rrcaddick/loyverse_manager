/**
 * Compatibility layer over src/lib/appearance.ts for code written against
 * the first build's ThemeProvider. New code should use `useAppearance()`.
 *
 *   const { theme, resolved, setTheme } = useTheme();   // theme = mode
 */

import type { ReactNode } from "react";

import { useAppearance, type Mode, type ResolvedMode } from "@/lib/appearance";

export type ThemePreference = Mode;
export type ResolvedTheme = ResolvedMode;

/** No-op wrapper kept so existing trees that render <ThemeProvider> still work. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useTheme(): { theme: ThemePreference; resolved: ResolvedTheme; setTheme: (theme: ThemePreference) => void } {
  const { appearance, resolvedMode, setAppearance } = useAppearance();
  return {
    theme: appearance.mode,
    resolved: resolvedMode,
    setTheme: (mode) => setAppearance({ mode }),
  };
}
