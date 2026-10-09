/**
 * Presentation helpers for Mail: dates that tolerate the two formats the API
 * emits, display names, the kind chip, a tiny Markdown → HTML converter for
 * the composer, and draft storage.
 */

import { differenceInCalendarDays, differenceInHours } from "date-fns";
import { toZonedTime } from "date-fns-tz";

import { TIME_ZONE, formatDate, formatDateShort, formatDateTime, formatRelativeDay, formatTime, parseDate } from "@/lib/format";

import type { MessageItem, Party, StreamItem, Thread } from "./types";

// ------------------------------------------------------------------ dates

/**
 * Thread rows serialise `booking.visit_date` as an RFC-1123 string
 * ("Sat, 28 Nov 2026 00:00:00 GMT") while every other response uses ISO.
 * Accept both and return a Date (or null).
 */
export function parseApiDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = parseDate(value);
  if (iso) return iso;
  const fallback = new Date(value);
  if (Number.isNaN(fallback.getTime())) return null;
  // RFC dates for a calendar day arrive at UTC midnight; read them as that day.
  if (/GMT$|UTC$/.test(value)) {
    return new Date(fallback.getUTCFullYear(), fallback.getUTCMonth(), fallback.getUTCDate(), 12);
  }
  return fallback;
}

/** "Sat 28 Nov" for any visit date shape. */
export function visitDateShort(value: string | null | undefined): string {
  const date = parseApiDate(value);
  return date ? formatDateShort(date) : "—";
}

/** "28 Nov 2026" for any visit date shape. */
export function visitDateLong(value: string | null | undefined): string {
  const date = parseApiDate(value);
  return date ? formatDate(date) : "—";
}

/** List time: "15:35" today, "Yesterday", "Mon", "3 Oct", "3 Oct 2025". */
export function listTime(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "";
  const now = toZonedTime(new Date(), TIME_ZONE);
  const local = toZonedTime(date, TIME_ZONE);
  const days = differenceInCalendarDays(now, local);
  if (days === 0) return formatTime(date);
  if (days === 1) return "Yesterday";
  if (days < 7) return local.toLocaleDateString("en-ZA", { weekday: "short" });
  if (local.getFullYear() === now.getFullYear()) return local.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  return formatDate(date);
}

/** Card time: "Today, 15:35" / "Yesterday, 09:12" / "12 Aug 2026, 11:32". */
export function cardTime(value: string | null | undefined): string {
  const rel = formatRelativeDay(value);
  return rel === "Today" || rel === "Yesterday" ? `${rel}, ${formatTime(value)}` : formatDateTime(value);
}

/** Whole days a reply has been waiting (0 when nothing is waiting). */
export function waitingDays(thread: Thread): number {
  if (thread.unanswered_count !== undefined) {
    // v3: the server decides what is unanswered; the age comes from the last inbound.
    if (thread.unanswered_count === 0) return 0;
    return daysSince(thread.last_inbound_at ?? thread.last_message_at);
  }
  if (thread.status !== "open" || thread.last_direction !== "inbound") return 0;
  const at = parseDate(thread.last_inbound_at ?? thread.last_message_at);
  if (!at) return 0;
  return Math.max(0, Math.floor(differenceInHours(new Date(), at) / 24));
}

/** Whole days since a timestamp (0 for today or anything unparseable). */
export function daysSince(value: string | null | undefined): number {
  const at = parseDate(value);
  if (!at) return 0;
  return Math.max(0, Math.floor(differenceInHours(new Date(), at) / 24));
}

/** Whole days the party's oldest unanswered message has waited. */
export function partyWaitingDays(party: Pick<Party, "unanswered_count" | "oldest_unanswered_at">): number {
  if (!party.unanswered_count) return 0;
  return daysSince(party.oldest_unanswered_at);
}

/** "today" / "yesterday" / "Mon" / "4 Jun" — the relative date for "oldest …". */
export function oldestLabel(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "";
  const now = toZonedTime(new Date(), TIME_ZONE);
  const local = toZonedTime(date, TIME_ZONE);
  const days = differenceInCalendarDays(now, local);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return local.toLocaleDateString("en-ZA", { weekday: "short" });
  if (local.getFullYear() === now.getFullYear()) return local.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  return formatDate(date);
}

/** "2 messages waiting · oldest 4 Jun" / "1 message waiting · yesterday". */
export function waitingLine(party: Pick<Party, "unanswered_count" | "oldest_unanswered_at">): string {
  const n = party.unanswered_count;
  if (!n) return "Nothing waiting";
  const head = n === 1 ? "1 message waiting" : `${n} messages waiting`;
  const oldest = oldestLabel(party.oldest_unanswered_at);
  if (!oldest) return head;
  return n === 1 ? `${head} · ${oldest}` : `${head} · oldest ${oldest}`;
}

/** The newest thread of a party by last message (the default reply target). */
export function newestThread(threads: Thread[]): Thread | null {
  let best: Thread | null = null;
  for (const t of threads) {
    if (!best) {
      best = t;
      continue;
    }
    const a = parseDate(t.last_message_at)?.getTime() ?? 0;
    const b = parseDate(best.last_message_at)?.getTime() ?? 0;
    if (a > b) best = t;
  }
  return best;
}

// ------------------------------------------------------------------ names

export function threadName(thread: Pick<Thread, "counterpart_name" | "counterpart_email">): string {
  return titleCase(thread.counterpart_name) || thread.counterpart_email || "Unknown sender";
}

/** A party reads as its person first, then the booking's contact, then the group. */
export function partyName(party: Pick<Party, "counterpart_name" | "counterpart_email" | "booking">): string {
  return titleCase(party.counterpart_name) || party.booking?.contact_name || party.counterpart_email || party.booking?.group_name || "Unknown sender";
}

/** The sender's domain as a rule pattern ("@acme.co.za"), or null. */
export function domainPattern(email: string | null | undefined): string | null {
  const host = email?.split("@")[1]?.trim().toLowerCase();
  return host ? `@${host}` : null;
}

export function senderName(message: Pick<MessageItem, "from_name" | "from_email">): string {
  return titleCase(message.from_name) || message.from_email || "Unknown sender";
}

/** "gaylynn cleophas" → "Gaylynn Cleophas"; leaves mixed-case names alone. */
export function titleCase(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = name.trim();
  if (trimmed !== trimmed.toLowerCase()) return trimmed;
  return trimmed.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** The snippet without our own "You: " prefix, and whether it was ours. */
export function splitSnippet(snippet: string | null | undefined): { ours: boolean; text: string } {
  const text = (snippet ?? "").trim();
  if (text.startsWith("You: ")) return { ours: true, text: text.slice(5) };
  return { ours: false, text };
}

// ------------------------------------------------------------------ kinds

const KIND_LABELS: Record<string, string> = {
  proforma: "Proforma",
  invoice: "Statement",
  final_invoice: "Tax invoice",
  payment_confirmation: "Payment confirmation",
  deposit_reminder: "Reminder",
  still_interested: "Reminder",
  final_details: "Final details",
  acknowledgement: "Acknowledgement",
  ticket: "Ticket",
  expiry: "Expiry notice",
  answers: "Answers",
  bounce_back: "Form link",
  reply: "Reply",
  custom: "Email",
};

/** "Proforma FY1703", "Statement", "Reply"… from an outbound message. */
export function kindChip(message: MessageItem): string | null {
  if (message.type !== "outbound") return null;
  const kind = message.kind;
  if (!kind) return null;
  const base = KIND_LABELS[kind] ?? kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  if ((kind === "proforma" || kind === "invoice" || kind === "final_invoice") && message.subject) {
    const number = message.subject.match(/\b((?:FY|INV)\d{3,5}(?:-S)?)\b/i)?.[1];
    if (number) return `${base} ${number.toUpperCase()}`;
  }
  return base;
}

// ------------------------------------------------------------------ stream

/** Index of the newest message in the stream (notes and events are never "the newest message"). */
export function newestMessageIndex(items: StreamItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item && (item.type === "inbound" || item.type === "outbound")) return i;
  }
  return -1;
}

/** First line of the new text, for the collapsed one-liner. */
export function firstLine(message: MessageItem, max = 120): string {
  const text = (message.body_new_text || message.snippet || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// ------------------------------------------------------------- markdown

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(text: string): string {
  let out = escapeHtml(text);
  // [label](https://url)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => `<a href="${url}">${label}</a>`);
  // bare URLs (not already inside an href)
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, lead: string, url: string) => `${lead}<a href="${url}">${url}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>");
  return out;
}

/**
 * The composer's Markdown subset → simple HTML: paragraphs, `**bold**`,
 * `_italic_`, `[text](url)`, bare links, `- ` bullet lists and `1. ` numbered
 * lists. Everything else is escaped text with line breaks.
 */
export function markdownToHtml(text: string): string {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.replace(/^\n+|\n+$/g, "")).filter(Boolean);
  return blocks
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
      }
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("\n");
}

/** Rough plain text of a template's HTML, for inserting into the Markdown composer. */
export function htmlToComposerText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    const label = a.textContent?.trim() ?? "";
    if (href && label && href !== label) a.replaceWith(`[${label}](${href})`);
    else a.replaceWith(label || href);
  });
  doc.querySelectorAll("strong, b").forEach((el) => el.replaceWith(`**${el.textContent ?? ""}**`));
  doc.querySelectorAll("li").forEach((li) => li.replaceWith(`- ${li.textContent?.trim() ?? ""}\n`));
  doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  doc.querySelectorAll("p, div, ul, ol, h1, h2, h3").forEach((el) => el.replaceWith(`${el.textContent ?? ""}\n\n`));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

// --------------------------------------------------------------- drafts

export type ComposerMode = "reply" | "note";

export interface ComposerDraft {
  mode: ComposerMode;
  body: string;
  subject: string;
  cc: string;
  to: string[];
  document_ids: number[];
  updated_at: string;
}

const DRAFT_PREFIX = "fy.mail.draft.";

export function readDraft(scope: string): ComposerDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + scope);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ComposerDraft>;
    if (typeof parsed.body !== "string") return null;
    return {
      mode: parsed.mode === "note" ? "note" : "reply",
      body: parsed.body,
      subject: typeof parsed.subject === "string" ? parsed.subject : "",
      cc: typeof parsed.cc === "string" ? parsed.cc : "",
      to: Array.isArray(parsed.to) ? parsed.to.filter((t): t is string => typeof t === "string") : [],
      document_ids: Array.isArray(parsed.document_ids) ? parsed.document_ids.filter((d): d is number => typeof d === "number") : [],
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeDraft(scope: string, draft: Omit<ComposerDraft, "updated_at"> | null): void {
  try {
    if (!draft || (!draft.body.trim() && !draft.subject.trim())) {
      localStorage.removeItem(DRAFT_PREFIX + scope);
      return;
    }
    localStorage.setItem(DRAFT_PREFIX + scope, JSON.stringify({ ...draft, updated_at: new Date().toISOString() }));
  } catch {
    // Storage may be unavailable (private mode); drafts are a convenience.
  }
}

// --------------------------------------------------------------- misc

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** "Re: subject" unless it already starts with Re:. */
export function replySubjectFor(subject: string | null | undefined): string {
  const base = (subject ?? "").trim();
  if (!base) return "Re: your enquiry";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
