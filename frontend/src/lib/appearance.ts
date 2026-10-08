/**
 * Appearance runtime: theme (six curated), mode (light / dark / system) and
 * text size (default / large / xlarge).
 *
 *   const { appearance, resolvedMode, setAppearance, themes } = useAppearance();
 *   setAppearance({ theme: "fynbos" });
 *
 * - The current value lives in a module store and in localStorage
 *   ("fy.appearance") so index.html can apply it before the first paint.
 * - Applying means setting `data-theme`, `data-text-size` and `.dark` on
 *   <html>; tokens.css does the rest. A system watcher re-applies when the
 *   OS switches while mode is "system".
 * - The server copy (users.preferences) is reconciled by
 *   `useAppearanceServerSync` in src/lib/appearance-sync.tsx: server wins
 *   when the session loads, local changes are PUT back.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

export const THEME_IDS = ["graphite", "fynbos", "indigo", "lagoon", "cocoa", "contrast"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export type Mode = "light" | "dark" | "system";
export type TextSize = "default" | "large" | "xlarge";
export type ResolvedMode = "light" | "dark";

export interface Appearance {
  theme: ThemeId;
  mode: Mode;
  text_size: TextSize;
}

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  description: string;
}

export const THEMES: ThemeMeta[] = [
  { id: "graphite", name: "Graphite", description: "Ink buttons on warm paper. All colour is meaning." },
  { id: "fynbos", name: "Fynbos", description: "Heather purple on lilac greys." },
  { id: "indigo", name: "Indigo", description: "Classic blue admin on slate greys." },
  { id: "lagoon", name: "Lagoon", description: "Teal on clean neutral greys." },
  { id: "cocoa", name: "Cocoa", description: "Farm brown on cream. The warmest." },
  { id: "contrast", name: "High contrast", description: "Pure black and white, strong borders, outlined pills." },
];

export const MODES: { value: Mode; label: string; description: string }[] = [
  { value: "light", label: "Light", description: "Always light." },
  { value: "dark", label: "Dark", description: "Always dark." },
  { value: "system", label: "Match system", description: "Follows the computer's day and night setting." },
];

export const TEXT_SIZES: { value: TextSize; label: string; px: number; description: string }[] = [
  { value: "default", label: "Default", px: 16, description: "Body text 15 px." },
  { value: "large", label: "Large", px: 17, description: "Body text 16 px. Easier at arm's length." },
  { value: "xlarge", label: "Extra large", px: 18, description: "Body text 17 px." },
];

export const DEFAULT_APPEARANCE: Appearance = { theme: "graphite", mode: "system", text_size: "large" };

const STORAGE_KEY = "fy.appearance";
const LEGACY_KEY = "fy.theme";

/** Coerce anything (server JSON, storage, user input) into a full Appearance. */
export function normaliseAppearance(input: unknown, base: Appearance = DEFAULT_APPEARANCE): Appearance {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const theme = THEME_IDS.includes(obj.theme as ThemeId) ? (obj.theme as ThemeId) : base.theme;
  const mode = obj.mode === "light" || obj.mode === "dark" || obj.mode === "system" ? (obj.mode as Mode) : base.mode;
  const text_size =
    obj.text_size === "default" || obj.text_size === "large" || obj.text_size === "xlarge" ? (obj.text_size as TextSize) : base.text_size;
  return { theme, mode, text_size };
}

export function sameAppearance(a: Appearance, b: Appearance): boolean {
  return a.theme === b.theme && a.mode === b.mode && a.text_size === b.text_size;
}

function readStored(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normaliseAppearance(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === "light" || legacy === "dark") return { ...DEFAULT_APPEARANCE, mode: legacy };
  } catch {
    // Storage unavailable (private mode) → defaults.
  }
  return DEFAULT_APPEARANCE;
}

function writeStored(value: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
}

function systemMode(): ResolvedMode {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveMode(mode: Mode): ResolvedMode {
  return mode === "system" ? systemMode() : mode;
}

/** Write the appearance onto <html>. Safe to call before React mounts. */
export function applyAppearance(value: Appearance): ResolvedMode {
  const root = document.documentElement;
  const resolved = resolveMode(value.mode);
  root.setAttribute("data-theme", value.theme);
  root.setAttribute("data-text-size", value.text_size);
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  return resolved;
}

// ------------------------------------------------------------------ store

export type ChangeSource = "user" | "server" | "storage";

interface Snapshot {
  appearance: Appearance;
  resolvedMode: ResolvedMode;
}

type Listener = (snapshot: Snapshot, source: ChangeSource) => void;

let snapshot: Snapshot = { appearance: DEFAULT_APPEARANCE, resolvedMode: "light" };
const listeners = new Set<Listener>();
let started = false;

function emit(source: ChangeSource) {
  for (const listener of listeners) listener(snapshot, source);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const initial = readStored();
  snapshot = { appearance: initial, resolvedMode: applyAppearance(initial) };

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    if (snapshot.appearance.mode !== "system") return;
    snapshot = { appearance: snapshot.appearance, resolvedMode: applyAppearance(snapshot.appearance) };
    emit("storage");
  });

  // Another tab changed the preference.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    const next = readStored();
    if (sameAppearance(next, snapshot.appearance)) return;
    snapshot = { appearance: next, resolvedMode: applyAppearance(next) };
    emit("storage");
  });
}

export function getAppearance(): Appearance {
  start();
  return snapshot.appearance;
}

/**
 * Update the appearance. `source` says who asked: "user" changes are
 * persisted locally and pushed to the server by the sync hook; "server"
 * changes are persisted locally only.
 */
export function setAppearance(patch: Partial<Appearance>, source: ChangeSource = "user"): Appearance {
  start();
  const next = normaliseAppearance({ ...snapshot.appearance, ...patch }, snapshot.appearance);
  if (sameAppearance(next, snapshot.appearance)) return next;
  snapshot = { appearance: next, resolvedMode: applyAppearance(next) };
  writeStored(next);
  emit(source);
  return next;
}

export function subscribeAppearance(listener: Listener): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function subscribe(onStoreChange: () => void) {
  return subscribeAppearance(() => onStoreChange());
}

function getSnapshot(): Snapshot {
  start();
  return snapshot;
}

const serverSnapshot: Snapshot = { appearance: DEFAULT_APPEARANCE, resolvedMode: "light" };

/** React hook over the store. */
export function useAppearance() {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
  const set = useCallback((patch: Partial<Appearance>) => setAppearance(patch, "user"), []);
  return useMemo(
    () => ({
      appearance: current.appearance,
      resolvedMode: current.resolvedMode,
      setAppearance: set,
      themes: THEMES,
      modes: MODES,
      textSizes: TEXT_SIZES,
    }),
    [current, set],
  );
}
