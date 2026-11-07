/**
 * True while the viewport is narrower than `px` (false when `px` is unset).
 * Subscribes to matchMedia so it updates on resize without re-rendering
 * every frame.
 */

import { useSyncExternalStore } from "react";

export function useMediaBelow(px: number | undefined): boolean {
  const query = px ? `(max-width: ${px - 1}px)` : null;
  return useSyncExternalStore(
    (onChange) => {
      if (!query || typeof window === "undefined") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => (query && typeof window !== "undefined" ? window.matchMedia(query).matches : false),
    () => false,
  );
}
