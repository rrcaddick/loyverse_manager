/**
 * Keyboard shortcuts with one document listener.
 *
 *   useShortcut("g t", () => navigate("/today"));      // sequence: G then T
 *   useShortcut("/", () => inputRef.current?.focus()); // single key
 *   useShortcut("mod+enter", send, { allowInInputs: true });
 *   useShortcut("shift+arrowup", prevWeek);
 *
 * Rules: single keys and sequences are ignored while typing in an input,
 * textarea, select or contenteditable (pass `allowInInputs` to override, as
 * a composer's Cmd+Enter must). A sequence prefix waits one second. When
 * several components register the same combo, the most recent wins, so a
 * page can override a global key while mounted.
 *
 * `KEYBOARD_MAP` is the documented map for the cheat sheet (`?`).
 */

import { useEffect, useRef } from "react";

type Handler = (event: KeyboardEvent) => void;

interface Registration {
  combo: string;
  handler: Handler;
  allowInInputs: boolean;
}

const SEQUENCE_TIMEOUT_MS = 1000;

const registrations: Registration[] = [];
let listening = false;
let pendingPrefix: string | null = null;
let pendingTimer: number | null = null;

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  if (el.isContentEditable) return true;
  return !!el.closest("input, textarea, select, [contenteditable=true], [role='textbox']");
}

function canonical(event: KeyboardEvent): string {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey && key.length > 1) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

function clearPrefix() {
  pendingPrefix = null;
  if (pendingTimer) window.clearTimeout(pendingTimer);
  pendingTimer = null;
}

function find(combo: string, editable: boolean): Registration | undefined {
  for (let i = registrations.length - 1; i >= 0; i--) {
    const r = registrations[i]!;
    if (r.combo === combo && (r.allowInInputs || !editable)) return r;
  }
  return undefined;
}

function hasPrefix(prefix: string, editable: boolean): boolean {
  return registrations.some((r) => r.combo.startsWith(`${prefix} `) && (r.allowInInputs || !editable));
}

function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return;
  const editable = isEditableTarget(event.target);
  const key = canonical(event);

  if (pendingPrefix) {
    const combo = `${pendingPrefix} ${key}`;
    const prefix = pendingPrefix;
    clearPrefix();
    const match = find(combo, editable);
    if (match) {
      event.preventDefault();
      match.handler(event);
      return;
    }
    if (key === prefix) {
      // Repeated prefix key: start over rather than fall through.
      pendingPrefix = key;
      pendingTimer = window.setTimeout(clearPrefix, SEQUENCE_TIMEOUT_MS);
      return;
    }
  }

  if (!key.includes("+") && hasPrefix(key, editable)) {
    event.preventDefault();
    pendingPrefix = key;
    pendingTimer = window.setTimeout(clearPrefix, SEQUENCE_TIMEOUT_MS);
    return;
  }

  const match = find(key, editable);
  if (match) {
    event.preventDefault();
    match.handler(event);
  }
}

function ensureListening() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("keydown", onKeyDown);
}

export interface ShortcutOptions {
  enabled?: boolean;
  /** Fire even when focus is in a text field (for Cmd+Enter style combos). */
  allowInInputs?: boolean;
}

/** Register a keyboard shortcut while the component is mounted. */
export function useShortcut(combo: string, handler: Handler, options: ShortcutOptions = {}): void {
  const { enabled = true, allowInInputs = false } = options;
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    ensureListening();
    const registration: Registration = {
      combo: combo.trim().toLowerCase(),
      handler: (event) => handlerRef.current(event),
      allowInInputs,
    };
    registrations.push(registration);
    return () => {
      const index = registrations.indexOf(registration);
      if (index >= 0) registrations.splice(index, 1);
    };
  }, [combo, enabled, allowInInputs]);
}

// ------------------------------------------------------------ documented map

export interface KeyboardMapGroup {
  title: string;
  items: { keys: string[]; label: string }[];
}

/** The map shown by the `?` cheat sheet. Pages add their rows via `extra`. */
export const KEYBOARD_MAP: KeyboardMapGroup[] = [
  {
    title: "Go to",
    items: [
      { keys: ["G", "T"], label: "Today" },
      { keys: ["G", "W"], label: "Work" },
      { keys: ["G", "C"], label: "Calendar" },
      { keys: ["G", "B"], label: "Bookings" },
      { keys: ["G", "M"], label: "Mail" },
    ],
  },
  {
    title: "Anywhere",
    items: [
      { keys: ["/"], label: "Search bookings" },
      { keys: ["?"], label: "This cheat sheet" },
      { keys: ["Ctrl", "B"], label: "Show or hide the sidebar" },
      { keys: ["Esc"], label: "Close a panel or dialog" },
    ],
  },
  {
    title: "Calendar and day view",
    items: [
      { keys: ["T"], label: "Jump to today" },
      { keys: ["←", "→"], label: "Previous or next month" },
      { keys: ["↑", "↓"], label: "Previous or next week" },
      { keys: ["Enter"], label: "Open the selected day" },
    ],
  },
  {
    title: "Work, Mail and lists",
    items: [
      { keys: ["J", "K"], label: "Move down or up" },
      { keys: ["Enter"], label: "Open the row" },
      { keys: ["1"], label: "The row's primary action" },
      { keys: ["2"], label: "The row's secondary action" },
      { keys: ["E"], label: "Mark a conversation done" },
      { keys: ["Ctrl", "Enter"], label: "Send the reply you are writing" },
    ],
  },
];
