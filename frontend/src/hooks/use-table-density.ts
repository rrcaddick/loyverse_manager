import { useCallback, useSyncExternalStore } from "react";

/**
 * Table density, remembered per table in localStorage ("fy.table.density.<key>").
 *
 *   const [compact, setCompact] = useTableDensity("bookings");
 *   <DataTable compact={compact} toolbar={<DataTableDensityToggle compact={compact} onChange={setCompact} />} … />
 */

const listeners = new Set<() => void>();

function storageKey(key: string) {
  return `fy.table.density.${key}`;
}

function read(key: string): boolean {
  try {
    return localStorage.getItem(storageKey(key)) === "compact";
  } catch {
    return false;
  }
}

export function useTableDensity(key: string): [boolean, (compact: boolean) => void] {
  const compact = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => read(key),
    () => false,
  );
  const set = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(storageKey(key), next ? "compact" : "comfortable");
      } catch {
        // ignore
      }
      for (const listener of listeners) listener();
    },
    [key],
  );
  return [compact, set];
}
