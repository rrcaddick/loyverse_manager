/**
 * The docked composer (spec §7): a collapsed bar "Reply to Nolene…" | Note
 * that expands in place to at most 45 % of the pane, with the textarea
 * scrolling inside. Reply / Note modes (Note tints the whole thing amber),
 * To chips with a Cc toggle, Subject only when it differs from "Re: …",
 * Template and Attach document menus, bold / list / link as Markdown
 * shortcuts converted to simple HTML on send, Send (Ctrl+Enter) and
 * "Send and mark done". Drafts autosave to localStorage per thread; Esc
 * collapses (the draft stays). When the person has more than one thread
 * (v3 parties) a "Reply in: <subject>" selector picks where the reply
 * lands — the newest thread by default.
 *
 * It is controlled: the conversation view owns `open` and `mode` so the
 * R / N keys work from anywhere in the pane.
 */

import { Bold, ChevronDown, FileText, Link as LinkIcon, List, MessagesSquare, Paperclip, Reply, Send, StickyNote, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { KeyboardHint } from "@/components/keyboard-hint";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BookingDocument } from "@/features/bookings/types";
import { useShortcut } from "@/hooks/use-keyboard";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

import { useTemplates } from "./api";
import { htmlToComposerText, isValidEmail, listTime, markdownToHtml, readDraft, writeDraft, type ComposerMode } from "./lib";

/** A thread the reply could land in (v3 parties). */
export interface ReplyThreadOption {
  thrid: string;
  subject: string | null;
  last_message_at: string | null;
}

export interface ComposerSend {
  to: string[];
  cc: string[];
  subject: string;
  body_html: string;
  body_text: string;
  attach_document_ids: number[];
  mark_done: boolean;
}

export interface ComposerProps {
  /** Draft key, e.g. "thread:187…" or "booking:124". Re-mount (key) when it changes. */
  scope: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
  /** "Reply to <name>…" */
  counterpartName: string;
  defaultTo: string[];
  defaultSubject: string;
  /** The booking's PDFs, offered under "Attach document". */
  documents?: BookingDocument[];
  /** False when the conversation has no address to reply to. */
  canReply: boolean;
  /** Offer "Send and mark done" (threads only) and make it the default verb. */
  markDone?: "offer" | "default" | "none";
  /** Text to prefill when retrying a failed send. */
  prefill?: { body: string; subject?: string } | null;
  /** Attached document ids (controlled, so the context panel can add one). */
  documentIds: number[];
  onDocumentIdsChange: (ids: number[]) => void;
  /** v3: when the person has several threads, "Reply in:" picks one (controlled by the view). */
  replyThreads?: ReplyThreadOption[];
  replyThrid?: string | null;
  onReplyThridChange?: (thrid: string) => void;
  onSend: (input: ComposerSend) => Promise<void>;
  onNote: (body: string) => Promise<void>;
  className?: string;
}

const DRAFT_DEBOUNCE_MS = 400;

export function Composer({
  scope,
  open,
  onOpenChange,
  mode,
  onModeChange,
  counterpartName,
  defaultTo,
  defaultSubject,
  documents = [],
  canReply,
  markDone = "none",
  prefill,
  documentIds: docIds,
  onDocumentIdsChange,
  replyThreads = [],
  replyThrid = null,
  onReplyThridChange,
  onSend,
  onNote,
  className,
}: ComposerProps) {
  const [draft] = useState(() => readDraft(scope));
  const [body, setBody] = useState(() => prefill?.body ?? draft?.body ?? "");
  const [subject, setSubject] = useState(() => prefill?.subject ?? draft?.subject ?? defaultSubject);
  const [editingSubject, setEditingSubject] = useState(() => (draft?.subject ? draft.subject !== defaultSubject : false));
  const [to, setTo] = useState<string[]>(() => (draft?.to.length ? draft.to : defaultTo));
  const [toInput, setToInput] = useState("");
  const [cc, setCc] = useState(() => draft?.cc ?? "");
  const [showCc, setShowCc] = useState(() => Boolean(draft?.cc));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const templates = useTemplates(open && mode === "reply");

  const setDocIds = (next: number[] | ((current: number[]) => number[])) => onDocumentIdsChange(typeof next === "function" ? next(docIds) : next);
  const hasDraft = body.trim().length > 0;

  // "Reply in:" changes the default subject; follow it unless the subject was edited.
  const previousDefault = useRef(defaultSubject);
  useEffect(() => {
    if (previousDefault.current === defaultSubject) return;
    setSubject((current) => (current.trim() === previousDefault.current.trim() ? defaultSubject : current));
    previousDefault.current = defaultSubject;
  }, [defaultSubject]);
  const subjectDiffers = subject.trim() !== defaultSubject.trim();
  const note = mode === "note";

  // Autosave the draft (debounced); clearing happens in send/discard.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeDraft(scope, { mode, body, subject, cc, to, document_ids: docIds });
    }, DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [scope, mode, body, subject, cc, to, docIds]);

  // Focus the textarea when the composer opens.
  useEffect(() => {
    if (open) {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [open, mode]);

  function collapse() {
    onOpenChange(false);
  }

  function discard() {
    setBody("");
    setSubject(defaultSubject);
    setEditingSubject(false);
    setTo(defaultTo);
    setCc("");
    setShowCc(false);
    setDocIds([]);
    setError(null);
    writeDraft(scope, null);
    onOpenChange(false);
  }

  function addTo(raw: string) {
    const parts = raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const valid = parts.filter(isValidEmail);
    if (valid.length) setTo((current) => Array.from(new Set([...current, ...valid])));
    setToInput(parts.filter((p) => !isValidEmail(p)).join(" "));
  }

  function onToKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === "Tab") {
      if (toInput.trim()) {
        event.preventDefault();
        addTo(toInput);
      }
    } else if (event.key === "Backspace" && !toInput && to.length) {
      setTo((current) => current.slice(0, -1));
    }
  }

  /** Wrap the selection (or insert a placeholder) with Markdown markers. */
  function wrapSelection(before: string, after: string, placeholder: string) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const selected = body.slice(start, end) || placeholder;
    const next = `${body.slice(0, start)}${before}${selected}${after}${body.slice(end)}`;
    setBody(next);
    const cursorStart = start + before.length;
    const cursorEnd = cursorStart + selected.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursorStart, cursorEnd);
    });
  }

  function prefixLines(prefix: string) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const lineStart = body.lastIndexOf("\n", start - 1) + 1;
    const block = body.slice(lineStart, end) || "item";
    const prefixed = block
      .split("\n")
      .map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
      .join("\n");
    const lead = lineStart > 0 && body[lineStart - 1] !== "\n" && body.slice(0, lineStart).trim() ? "\n" : "";
    const next = `${body.slice(0, lineStart)}${lead}${prefixed}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = lineStart + lead.length + prefixed.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function insertAtCursor(text: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const lead = start > 0 && !body.slice(0, start).endsWith("\n\n") ? (body.slice(0, start).endsWith("\n") ? "\n" : "\n\n") : "";
    const next = `${body.slice(0, start)}${lead}${text}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + lead.length + text.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function onBodyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "b") {
      event.preventDefault();
      wrapSelection("**", "**", "bold");
    } else if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      wrapSelection("[", "](https://)", "link text");
    }
  }

  async function submit(withDone: boolean) {
    if (busy) return;
    const text = body.trim();
    if (!text) {
      setError(note ? "Write the note first" : "Write the reply first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (note) {
        await onNote(text);
      } else {
        const recipients = toInput.trim() && isValidEmail(toInput) ? [...to, toInput.trim()] : to;
        if (!recipients.length) {
          setError("Add at least one recipient");
          setBusy(false);
          return;
        }
        const ccList = cc
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter(isValidEmail);
        await onSend({
          to: recipients,
          cc: ccList,
          subject: subject.trim() || defaultSubject,
          body_html: markdownToHtml(text),
          body_text: text,
          attach_document_ids: docIds,
          mark_done: withDone,
        });
      }
      setBody("");
      setDocIds([]);
      setError(null);
      setSubject(defaultSubject);
      setEditingSubject(false);
      writeDraft(scope, null);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, "Could not send"));
    } finally {
      setBusy(false);
    }
  }

  const primaryIsDone = !note && markDone === "default";
  useShortcut("mod+enter", () => void submit(primaryIsDone), { allowInInputs: true, enabled: open });
  useShortcut("escape", collapse, { allowInInputs: true, enabled: open });

  // ---------------------------------------------------------- collapsed bar
  if (!open) {
    return (
      <div className={cn("flex h-12 shrink-0 items-center gap-1 rounded-xl bg-card px-2 ring-1 ring-border", className)}>
        <button
          type="button"
          onClick={() => {
            onModeChange("reply");
            onOpenChange(true);
          }}
          disabled={!canReply}
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-body text-muted-foreground transition-colors hover:bg-nested hover:text-foreground focus-visible:ring-2 focus-visible:ring-selection-ring focus-visible:outline-none disabled:opacity-60"
        >
          <Reply aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">
            {hasDraft && mode === "reply" ? (
              <>
                <span className="font-medium text-foreground">Draft</span> · {body.replace(/\s+/g, " ").slice(0, 80)}
              </>
            ) : canReply ? (
              `Reply to ${counterpartName}…`
            ) : (
              "No address to reply to"
            )}
          </span>
          <KeyboardHint keys={["R"]} className="ml-auto hidden sm:flex" />
        </button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onModeChange("note");
            onOpenChange(true);
          }}
        >
          <StickyNote data-icon="inline-start" className="text-amber-solid" />
          {hasDraft && mode === "note" ? "Draft note" : "Note"}
          <KeyboardHint keys={["N"]} className="hidden sm:flex" />
        </Button>
      </div>
    );
  }

  // --------------------------------------------------------------- expanded
  return (
    <section
      aria-label={note ? "Internal note" : "Reply"}
      className={cn(
        "flex max-h-[45dvh] min-h-56 shrink-0 flex-col rounded-xl ring-1 transition-colors",
        note ? "bg-amber-soft ring-amber-solid/40" : "bg-card ring-border",
        className,
      )}
    >
      {/* Mode tabs + close */}
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
        <div role="tablist" aria-label="Composer mode" className="flex gap-0.5 rounded-lg bg-background/60 p-[3px]">
          <ModeTab active={!note} onClick={() => onModeChange("reply")} disabled={!canReply} icon={Reply} label="Reply" />
          <ModeTab active={note} onClick={() => onModeChange("note")} icon={StickyNote} label="Note" amber />
        </div>
        {note ? <span className="ml-2 text-sm text-amber-text">Only the team sees this</span> : null}
        <div className="ml-auto flex items-center gap-1">
          {hasDraft ? (
            <Button type="button" variant="ghost" size="sm" onClick={discard}>
              Discard
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Collapse composer (Esc)" onClick={collapse}>
            <X />
          </Button>
        </div>
      </div>

      {/* Header: To / Cc / Subject (reply mode only) */}
      {!note ? (
        <div className="flex shrink-0 flex-col gap-1.5 px-3 pt-2">
          <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <span className="text-sm text-muted-foreground">To</span>
            {to.map((address) => (
              <span key={address} className="inline-flex h-6 items-center gap-1 rounded-md bg-nested pr-0.5 pl-2 text-sm text-foreground ring-1 ring-border">
                {address}
                <button type="button" aria-label={`Remove ${address}`} className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setTo((c) => c.filter((a) => a !== address))}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              onKeyDown={onToKeyDown}
              onBlur={() => toInput.trim() && addTo(toInput)}
              aria-label="Add a recipient"
              placeholder={to.length ? "" : "name@example.com"}
              className="h-6 min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {!showCc ? (
              <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setShowCc(true)}>
                Cc
              </button>
            ) : null}
          </div>
          {showCc ? (
            <Input value={cc} onChange={(e) => setCc(e.target.value)} aria-label="Cc" placeholder="Cc: one or more addresses" className="h-9 text-sm" />
          ) : null}
          {editingSubject || subjectDiffers ? (
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" placeholder="Subject" className="h-9 text-sm" />
          ) : (
            <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
              <span className="truncate">
                Subject: <span className="text-foreground">{subject}</span>
              </span>
              <button type="button" className="shrink-0 underline-offset-4 hover:underline" onClick={() => setEditingSubject(true)}>
                Edit
              </button>
            </div>
          )}
          {replyThreads.length > 1 ? (
            <ReplyInSelector threads={replyThreads} value={replyThrid} onChange={(thrid) => onReplyThridChange?.(thrid)} />
          ) : null}
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 px-2 pt-1.5">
        {!note ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm">
                  <FileText data-icon="inline-start" />
                  Template
                  <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Insert a template</DropdownMenuLabel>
                {templates.isPending ? (
                  <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
                ) : templates.data?.length ? (
                  templates.data.map((t) => (
                    <DropdownMenuItem
                      key={t.key}
                      onSelect={() => {
                        insertAtCursor(htmlToComposerText(t.body_html) || t.body_text);
                        if (t.subject && !hasDraft) {
                          setSubject(t.subject);
                        }
                      }}
                    >
                      {t.label}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>No templates — add some under Settings › Templates</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" disabled={!documents.length} title={documents.length ? undefined : "No documents on this booking yet"}>
                  <Paperclip data-icon="inline-start" />
                  Attach document
                  {docIds.length ? <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular">{docIds.length}</span> : null}
                  <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>The booking's documents</DropdownMenuLabel>
                {documents.map((d) => (
                  <DropdownMenuCheckboxItem
                    key={d.id}
                    checked={docIds.includes(d.id)}
                    onCheckedChange={(checked) => setDocIds((c) => (checked ? [...c, d.id] : c.filter((id) => id !== d.id)))}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className="truncate">
                      {d.label} <span className="tabular">{d.number}</span>
                      {d.version > 1 ? <span className="text-muted-foreground"> v{d.version}</span> : null}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
                {docIds.length ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setDocIds([])}>Clear</DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
          </>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Bold (Ctrl+B)" onClick={() => wrapSelection("**", "**", "bold")}>
              <Bold />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Bold · **text**</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Bullet list" onClick={() => prefixLines("- ")}>
              <List />
            </Button>
          </TooltipTrigger>
          <TooltipContent>List · "- " at the start of a line</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Link (Ctrl+K)" onClick={() => wrapSelection("[", "](https://)", "link text")}>
              <LinkIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Link · [text](https://…)</TooltipContent>
        </Tooltip>
        {docIds.length && !note ? (
          <ul className="ml-2 flex flex-wrap gap-1" aria-label="Attached documents">
            {docIds.map((id) => {
              const d = documents.find((x) => x.id === id);
              if (!d) return null;
              return (
                <li key={id} className="inline-flex h-6 items-center gap-1 rounded-md bg-nested pr-0.5 pl-2 text-xs text-foreground ring-1 ring-border">
                  <Paperclip aria-hidden="true" className="size-3 text-muted-foreground" />
                  {d.filename}
                  <button type="button" aria-label={`Remove ${d.filename}`} className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setDocIds((c) => c.filter((x) => x !== id))}>
                    <X className="size-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/* Body: grows with content, scrolls inside once the cap is reached */}
      <div className="flex min-h-0 flex-1 flex-col px-3 pt-1.5">
        <Textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onBodyKeyDown}
          aria-label={note ? "Note" : "Reply"}
          placeholder={note ? "Something the team should know — phoned, pays Friday…" : `Write to ${counterpartName}…`}
          className={cn("min-h-24 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-1 py-1 text-body shadow-none focus-visible:ring-0 scrollbar-thin", note && "placeholder:text-amber-text/60")}
        />
      </div>

      {/* Footer */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pt-1 pb-3">
        {error ? (
          <p role="alert" className="text-sm text-red-text">
            {error}
          </p>
        ) : (
          <p className="hidden text-xs text-muted-foreground sm:block">
            <KeyboardHint keys={["Esc"]} /> collapses · **bold** · - list · [link](url)
          </p>
        )}
        <div className="ml-auto flex items-center gap-2">
          {note ? (
            <Button type="button" onClick={() => void submit(false)} disabled={busy || !hasDraft}>
              {busy ? <Spinner data-icon="inline-start" /> : <StickyNote data-icon="inline-start" />}
              Add note
              <KeyboardHint keys={["Ctrl", "Enter"]} className="ml-1 hidden text-primary-foreground/80 sm:flex" />
            </Button>
          ) : (
            <>
              {markDone !== "none" ? (
                <Button type="button" variant={primaryIsDone ? "default" : "outline"} onClick={() => void submit(true)} disabled={busy || !hasDraft}>
                  {busy && primaryIsDone ? <Spinner data-icon="inline-start" /> : null}
                  Send and mark done
                  {primaryIsDone ? <KeyboardHint keys={["Ctrl", "Enter"]} className="ml-1 hidden text-primary-foreground/80 sm:flex" /> : null}
                </Button>
              ) : null}
              <Button type="button" variant={primaryIsDone ? "outline" : "default"} onClick={() => void submit(false)} disabled={busy || !hasDraft}>
                {busy && !primaryIsDone ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
                Send
                {!primaryIsDone ? <KeyboardHint keys={["Ctrl", "Enter"]} className="ml-1 hidden text-primary-foreground/80 sm:flex" /> : null}
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ModeTab({ active, onClick, disabled, icon: Icon, label, amber }: { active: boolean; onClick: () => void; disabled?: boolean; icon: typeof Reply; label: string; amber?: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-selection-ring disabled:opacity-50",
        active ? (amber ? "bg-card text-amber-text shadow-sm ring-1 ring-amber-solid/40" : "bg-card text-foreground shadow-sm ring-1 ring-border") : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-3.5", amber && "text-amber-solid")} />
      {label}
    </button>
  );
}

/** "Reply in: <thread subject> ▾" — which of the person's threads the reply lands in. */
function ReplyInSelector({ threads, value, onChange }: { threads: ReplyThreadOption[]; value: string | null; onChange: (thrid: string) => void }) {
  const current = threads.find((t) => t.thrid === value) ?? threads[0];
  const isNewest = current?.thrid === threads[0]?.thrid;
  return (
    <div className="flex min-w-0 items-center gap-2 px-1 text-sm text-muted-foreground">
      <span className="shrink-0">Reply in:</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Reply in: ${current?.subject || "(no subject)"}`}
            data-testid="reply-in"
            className="inline-flex h-7 min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 text-sm text-foreground ring-1 ring-border transition-colors hover:bg-nested focus-visible:ring-2 focus-visible:ring-selection-ring focus-visible:outline-none"
          >
            <MessagesSquare aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{current?.subject || "(no subject)"}</span>
            {isNewest ? <span className="shrink-0 text-xs text-muted-foreground">· newest</span> : null}
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuLabel>Which conversation the reply continues</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={current?.thrid} onValueChange={onChange}>
            {threads.map((t, index) => (
              <DropdownMenuRadioItem key={t.thrid} value={t.thrid}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{t.subject || "(no subject)"}</span>
                  <span className="text-xs text-muted-foreground tabular">
                    {index === 0 ? "Newest · " : ""}
                    {listTime(t.last_message_at)}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
