/**
 * Appearance runtime: a Material 2 swatch pair (primary + accent, like
 * materialpalette.com), mode (light / dark / system) and text size.
 *
 *   const { appearance, pair, resolvedMode, setAppearance, setPair } = useAppearance();
 *   setPair({ primary: "indigo", accent: "pink" });
 *
 * - `theme` is the pair as a slug ("indigo_pink"); legacy ids (graphite, …)
 *   map to a pair. It is what the server stores in users.preferences.
 * - Applying computes every token for the pair and mode (src/styles/m2.mjs)
 *   and sets them inline on <html>; tokens.css holds the Indigo + Pink
 *   defaults for the first paint.
 * - The server copy is reconciled by `useAppearanceServerSync`.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { DEFAULT_PAIR, SWATCHES, cssVars, normalisePair, pairFromSlug, slugFromPair, swatch, tokensFor, type Pair } from "@/styles/m2.mjs";

export type Mode = "light" | "dark" | "system";
export type TextSize = "default" | "large" | "xlarge";
export type ResolvedMode = "light" | "dark";
export type { Pair };

export interface Appearance {
  /** Swatch pair slug, e.g. "indigo_pink". */
  theme: string;
  mode: Mode;
  text_size: TextSize;
}

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

export const DEFAULT_APPEARANCE: Appearance = { theme: slugFromPair(DEFAULT_PAIR), mode: "system", text_size: "large" };

const STORAGE_KEY = "fy.appearance";
const LEGACY_KEY = "fy.theme";

export function pairOf(value: Appearance | string): Pair {
  return pairFromSlug(typeof value === "string" ? value : value.theme);
}

/** "Indigo · Pink" */
export function pairName(pair: Pair): string {
  const p = normalisePair(pair);
  return `${swatch(p.primary)?.name ?? p.primary} · ${swatch(p.accent)?.name ?? p.accent}`;
}

/** Coerce anything (server JSON, storage, user input) into a full Appearance. */
export function normaliseAppearance(input: unknown, base: Appearance = DEFAULT_APPEARANCE): Appearance {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const theme = typeof obj.theme === "string" && obj.theme ? slugFromPair(pairFromSlug(obj.theme)) : base.theme;
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

/** Inline style variables for a pair and mode (previews use these on their own root). */
export function styleVarsFor(pair: Pair, mode: ResolvedMode): Record<string, string> {
  return cssVars(tokensFor(pair, mode));
}

/** Write the appearance onto <html>: every token inline, plus the mode class. */
export function applyAppearance(value: Appearance): ResolvedMode {
  const root = document.documentElement;
  const resolved = resolveMode(value.mode);
  const pair = pairOf(value);
  const tokens = tokensFor(pair, resolved);
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(`--${k}`, v);
  root.setAttribute("data-theme", slugFromPair(pair));
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
  const setPair = useCallback((patch: Partial<Pair>) => {
    const next = normalisePair({ ...pairOf(getAppearance()), ...patch });
    setAppearance({ theme: slugFromPair(next) }, "user");
  }, []);
  return useMemo(
    () => ({
      appearance: current.appearance,
      pair: pairOf(current.appearance),
      resolvedMode: current.resolvedMode,
      setAppearance: set,
      setPair,
      swatches: SWATCHES,
      modes: MODES,
      textSizes: TEXT_SIZES,
    }),
    [current, set, setPair],
  );
}
