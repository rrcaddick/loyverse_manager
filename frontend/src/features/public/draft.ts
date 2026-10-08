/**
 * The visitor's answers live in sessionStorage so a refresh or a Back loses
 * nothing and the Check screen can read all three steps. Everything is kept
 * as the strings the text boxes hold; the step schemas parse them.
 *
 *   fy.request.draft          the answers (Draft)
 *   fy.request.server-errors  422 field messages from the last send, shown
 *                             inline on the step they belong to until the
 *                             field changes
 */

import type { ContactInput, GroupInput, VisitInput } from "./schema";

const DRAFT_KEY = "fy.request.draft";
const ERRORS_KEY = "fy.request.server-errors";

export type Draft = VisitInput & GroupInput & ContactInput;

export function emptyDraft(): Draft {
  return {
    visit_date: "",
    alternative_date: "",
    visitors: "",
    arrival_time: "",
    group_name: "",
    group_type: "",
    area: "",
    vehicles: "",
    gazebos: "",
    questions: [""],
    customer_notes: "",
    contact_name: "",
    contact_email: "",
    contact_mobile: "",
  };
}

function read<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage full: the form still works for this page load.
  }
}

/** The stored answers merged over an empty draft, so new fields never come back undefined. */
export function loadDraft(): Draft {
  const stored = read<Partial<Draft>>(DRAFT_KEY) ?? {};
  const draft = { ...emptyDraft(), ...stored };
  if (!Array.isArray(draft.questions) || draft.questions.length === 0) draft.questions = [""];
  draft.questions = draft.questions.map((q) => (typeof q === "string" ? q : ""));
  return draft;
}

export function saveDraft(patch: Partial<Draft>): void {
  write(DRAFT_KEY, { ...loadDraft(), ...patch });
}

export function clearDraft(): void {
  write(DRAFT_KEY, null);
  write(ERRORS_KEY, null);
}

/** Field → message from the server's last 422, until the visitor edits the field. */
export function loadServerErrors(): Record<string, string> {
  return read<Record<string, string>>(ERRORS_KEY) ?? {};
}

export function saveServerErrors(errors: Record<string, string>): void {
  write(ERRORS_KEY, Object.keys(errors).length ? errors : null);
}

export function clearServerError(field: string): void {
  const current = loadServerErrors();
  if (!(field in current)) return;
  delete current[field];
  saveServerErrors(current);
}
