# Frontend Mail + Bank v2 — handoff

Owner: Mail + Bank page agent. Scope: `frontend/src/pages/mail/**`,
`frontend/src/pages/bank/**`, `frontend/src/features/mail/**`,
`frontend/src/features/bank/**`, this note. Built on the foundation
(`frontend-foundation-v2.md`), the spec (`redesign-spec.md` §7, §8) and the
backend notes `mail-v2.md`, `backend-v2-misc.md` §1, `payments.md`.

```bash
cd frontend
VITE_API_TARGET=http://127.0.0.1:5100 pnpm dev --port 5314
pnpm typecheck && pnpm lint && pnpm build        # all pass at handoff
```

The first build's `features/inbox`, `features/payments`, `pages/inbox` and
`pages/payments` are untouched and no longer referenced by any route; delete
them when the Bookings agent has stopped importing `features/queue`'s
`BookingPicker` from the same era (I still use `BookingPicker` and
`BookingFinanceMeta` from `features/queue/booking-picker.tsx`).

## 1. Component map

### Mail (`/mail`, `/mail/:thrid`)

| File | What |
| --- | --- |
| `pages/mail/MailPage.tsx` | The page: queue tabs under the title, search, list, reading pane, context aside, attach dialog, keys. Collapses the sidebar (`useSidebarCollapsed`) so three panes fit at 1440. URL `?view=&chip=&q=&page=`. |
| `features/mail/types.ts` | `Thread`, `StreamItem` (`MessageItem` · `NoteItem` · `EventItem`), responses, `ThreadReplyInput`. `isMessage()` guard. |
| `features/mail/api.ts` | Queries under `["mail", …]`; mutations done / reopen / not-booking / attach / detach / note / reply / reply-on-booking / bounce-back / sync. `invalidateMailWorld(qc)` → `["mail"]`, `["inbox"]`, `["work"]`, `["queue"]`, `["bookings"]`, `["today"]`. |
| `features/mail/lib.ts` | `parseApiDate` (ISO **or** the RFC-1123 string thread rows emit), `listTime`, `cardTime`, `waitingDays`, `threadName`, `kindChip`, `markdownToHtml`, `htmlToComposerText`, drafts (`readDraft` / `writeDraft`). |
| `features/mail/conversation-list.tsx` | `ConversationList` — the rows (spec §7 anatomy), cursor + `aria-current`, 3 px amber edge when a reply has waited > 2 days. |
| `features/mail/conversation-view.tsx` | **`ConversationView`** (below). |
| `features/mail/message-card.tsx` | `MessageCard` (inbound paper card / outbound tinted + 2 px accent rule / collapsed one-liner), `PendingCard` (Sending… / Failed · Retry), `NoteCard` (amber), `EventLine` (icon + link). |
| `features/mail/message-body.tsx` | `MessageHtml` — sandboxed iframe, auto height, "Show images"; `MessageText`. |
| `features/mail/composer.tsx` | `Composer` — the docked composer (below). |
| `features/mail/composer-bridge.ts` | `useComposerBridge()` — lets a sibling panel open the composer or attach a document. |
| `features/mail/context-panel.tsx` | `BookingContextPanel` (contact, date, visitors, balance, deposit, documents with **Attach**, Detach), `AttachPanel` (suggestions, booking search, Not a booking, Send form link behind a ConfirmDialog), `ContextStrip` (one line for narrow layouts), `PanelEmpty`. |
| `features/mail/original-dialog.tsx` | "View original" (`GET /inbox/messages/:id/original`). |

Layout (container queries on the page root): ≥ `@3xl` (768 px) list 340 px
beside the reading pane; ≥ `@6xl` (1152 px) the 288 px context aside
appears, below that the context is the `ContextStrip` and the attach panel
lives in a dialog (`A`). Below `@3xl` the page stacks: list, or the open
thread full-screen with a back arrow. At 1440×900 with the sidebar collapsed
the pane is ~600 px; with the sidebar open the aside gives way to the strip.

### Bank (`/bank`)

| File | What |
| --- | --- |
| `pages/bank/BankPage.tsx` | Title, `SummaryLine`, `SegmentedTabs` Needs attention · Matched · All entries, search, rows / table, drawer (`?tx=`), Find-booking dialog, Ignore-rules dialog (`?rules=1`), the match flow's confirm dialog. Tab remembered in `localStorage["fy.bank.tab"]`. |
| `features/bank/types.ts` | `BankTransaction` (+ `ignore`, `preselected_booking_id`), `BankSuggestion` with every v2 field optional, `BankSummary`, `IgnoreRule`, responses. |
| `features/bank/lib.ts` | `describeSuggestion` (server sentence/tone/arithmetic when present, derived otherwise), `orderedSuggestions`, `preselectedId`, `rowDate`, `deriveRulePattern` (preview of the server rule), `canMakeRule`. |
| `features/bank/api.ts` | Queries under `["bank", …]`; match / unmatch / ignore / rules / poll / `useSendPaymentConfirmation`. `invalidateBankWorld(qc)` → `["bank"]`, `["payments"]`, `["work"]`, `["queue"]`, `["bookings"]`, `["today"]`. |
| `features/bank/match-flow.tsx` | `useMatchFlow()` — `match`, `unmatch`, `ignore` with the slide-out, undo toasts and the follow-up "Deposit covered — send payment confirmation?" toast + `ConfirmDialog` (`flow.dialog`). |
| `features/bank/transaction-row.tsx` | `NeedsAttentionRow` (Xero halves, proposal card, "N possible bookings — choose", Find booking…, Ignore ▾), `MatchedRow` (Remove match). |
| `features/bank/ignore-menu.tsx` | Ignore ▾: Own transfer / Card settlement / Interest each with "Only this entry" or "This and similar in future" (shows the derived prefix), Other… (note dialog). |
| `features/bank/find-booking-dialog.tsx` | The one search dialog. |
| `features/bank/summary-line.tsx` | "4 to confirm · 12 unmatched credits this month (R…) · last poll 20:10, OK · Poll now · Ignore rules". |
| `features/bank/transaction-drawer.tsx` | Amount and description first, match block, bank metadata collapsed. |
| `features/bank/all-entries-table.tsx` | `DataTable`, server-paginated, balance column; status folded into the Booking column. |
| `features/bank/ignore-rules-dialog.tsx` | List + delete (`GET/DELETE /payments/ignore-rules`). |

## 2. `ConversationView` API

```tsx
import { ConversationView } from "@/features/mail/conversation-view";

<ConversationView bookingId={124} />                       // booking record's Conversation tab
<ConversationView thrid="1878302343153220866" markDone="default" bridge={bridge} />
```

| Prop | Meaning |
| --- | --- |
| `bookingId?` / `thrid?` | exactly one. `thrid` → `GET /inbox/conversations/:thrid`; `bookingId` → `GET /bookings/:id/conversation` (every thread on the booking merged with its events). |
| `markDone?` | `"offer"` (default on threads) shows "Send and mark done" beside Send; `"default"` makes it the primary verb (Mail uses this in Needs reply); `"none"`. Booking mode without a thread is always `"none"`. |
| `shortcuts?` | default `true`: registers `R` reply, `N` note, `;` expand/collapse all while mounted. Pass `false` if the host page owns those keys. |
| `bridge?` | a `useComposerBridge()` value; `bridge.open("reply" \| "note")`, `bridge.attachDocument(id)`. |
| `className?` | the root is `flex min-h-0 flex-1 flex-col gap-3`; mount it inside a column with a definite height so the stream scrolls and the composer docks. |

Behaviour: re-mounts per conversation (internal `key` on the scope, so
drafts and composer state never bleed between threads). Newest message open,
older ones collapsed to `name · first line of new text · time`; notes and
events inline. Replies go to `POST /inbox/conversations/:thrid/reply` when a
thread is known (thrid mode, or the booking's primary thread —
`booking.email_thread_id`, else its newest thread); otherwise to
`POST /bookings/:id/emails/reply`. Notes need a thread (the booking record
should keep its own note box for bookings with no mail yet). The booking's
documents (for Attach document and the context panel) come from
`["bookings", id]`, the same key the record page uses.

Sending: an optimistic `PendingCard` ("Sending…") appears at once; on
success the server's item replaces it (set into the query cache, then
invalidated). A 502 means the server stored a failed row — the stream shows
it red with **Retry** (refills the composer); a transport error keeps the
pending card as Failed with Retry.

## 3. Composer behaviour

- Collapsed bar `Reply to <name>…` | **Note** (with `R` / `N` hints); reads
  `Draft · <first words>` when a draft exists. Disabled "No address to reply
  to" when the thread has none.
- Expands in place, `max-h-[45dvh]`, `min-h-56`; the textarea grows with
  content and scrolls inside once the cap is hit (the conversation stays
  above). Opening focuses the textarea at the end.
- Reply mode: To chips (prefilled with the latest inbound sender, else the
  thread counterpart, else the booking contact; Enter/comma/Tab adds,
  Backspace removes, validated), **Cc** toggle, Subject shown as a line
  `Subject: Re: … · Edit` and as an input only when it differs from the
  default. Note mode tints the whole composer amber ("Only the team sees
  this").
- Toolbar: **Template** (`GET /inbox/templates`, inserted at the cursor as
  Markdown via `htmlToComposerText`; a template subject fills the subject
  when nothing is written yet), **Attach document** (checkbox menu of the
  booking's PDFs; chips with ×), **B** (`Ctrl+B`), list, link (`Ctrl+K`) as
  Markdown shortcuts. `markdownToHtml` converts `**bold**`, `_italic_`,
  `[text](url)`, bare URLs, `- ` and `1. ` lists and paragraphs to simple
  HTML on send; `body_text` is the raw Markdown.
- Footer: **Send** and **Send and mark done** (primary per `markDone`);
  `Ctrl/Cmd+Enter` fires the primary; **Esc** collapses (draft kept);
  **Discard** clears.
- Drafts autosave (400 ms) to `localStorage["fy.mail.draft.<scope>"]`
  (`thread:<thrid>` / `booking:<id>`): mode, body, subject, cc, to,
  document ids. Cleared on send or discard.
- Sent-item display: "Farmyard Park · <sender>" + kind chip (`Proforma
  FY1703`, `Statement`, `Tax invoice`, `Ticket`, `Reminder`, `Reply`…) +
  `Sent 11:02` or red `Failed · Retry` with the error.

## 4. Message bodies

`body_new_html` renders in an iframe with
`sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"`
(no scripts, ever), `srcdoc`, a CSP meta `default-src 'none'; img-src 'self'
data:` and `<base target="_blank">`. The brief said `sandbox=""`; a fully
opaque frame cannot be measured from the parent, so auto height would be
impossible — `allow-same-origin` with scripts off is the same trade the first
build made and gives the email nothing. **Show images** copies `data-src`
back to `src` (the ingest parks remote images there) and widens `img-src`
for that message only. Theme colours are read from the live tokens so the
frame follows light/dark. Text-only mail renders `body_new_text`.
"Show quoted history (n lines)" renders `body_quoted_html` in a second
frame; "Show signature" shows `signature_text`; `;` or "Expand all" expands
every message and its quoted parts.

## 5. Bank behaviour

- Rows: left date · amount 20 px tabular · description · reference (mono,
  hidden when identical to the description); the left half opens the drawer.
  Right: `FY1698 · Harbour of Hope · Sat 7 Nov · <status>`, the arithmetic
  line, the confidence sentence (`text-green-text` for the two "equals",
  muted otherwise) and a green **Match**. Several candidates with nothing
  pre-selected → "N possible bookings — choose" expanding in place with a
  Match per card; a pre-selected one shows its card plus "Or choose another
  · n". No candidates → Find booking… and Ignore ▾.
- Pre-selection: the server's `preselected_booking_id`, else a candidate
  flagged `preselected`, else the only candidate. Ties pre-select nothing.
- Match: the row slides out (`animate-out`), toast `R3 800 recorded on FY1698
  · Undo` (10 s, undo = unmatch), then — when `GET /bookings/:id` says
  `finance.deposit_covered` — a 12 s toast "Deposit covered — send payment
  confirmation?" whose button opens the ConfirmDialog for
  `POST /bookings/:id/actions/send-payment-confirmation` (attaches the
  statement when one exists).
- Remove match (Matched tab, one click): undo toast; the description reads
  "FY… is back to proforma sent" when `booking_reverted` is set.
- Ignore: no dialog for the three rule reasons; "This and similar in future"
  sends `create_rule: true` and the toast quotes the server's pattern and
  how many more entries it ignored; Undo un-ignores and deletes a rule it
  created. "Other…" asks for the note.
- Summary line: links switch to Needs attention; `last poll` goes red with
  the error; **Poll now** = `POST /payments/sync`, no dialog, result toast.
- Needs attention footer sums the unmatched credits on the page.

## 6. Keyboard map

| Key | Where | Does |
| --- | --- | --- |
| `J` / `K` | Mail list | move the cursor; when a conversation is open, also opens the next / previous one |
| `Enter` | Mail list | open the cursor row |
| `E` | Mail | mark the open conversation done → undo toast, opens the next row |
| `A` | Mail | attach dialog (unattached conversations) |
| `R` / `N` | Mail, booking Conversation tab | open the composer in reply / note mode |
| `;` | conversation | expand or collapse every message |
| `/` | Mail | focus the mail search (overrides the header's) |
| `Ctrl/Cmd+Enter` | composer | send (the primary verb) |
| `Esc` | composer | collapse, keep the draft |
| `Ctrl+B`, `Ctrl+K` | composer textarea | bold, link |

All through `useShortcut`; single keys pause in text fields.

## 7. Requests for the foundation / other owners

- **Cheat sheet**: add `R` reply, `N` note, `A` attach, `;` expand all and
  `/` "search the list" to `KEYBOARD_MAP` ("Work, Mail and lists"), or let
  `AppLayout` accept page `extra` groups. I did not edit `hooks/use-keyboard.ts`.
- **`/mail` route**: `handle: { layout: "full" }` would give the three-pane
  page its padding back as pane width; today the page computes
  `h-[calc(100dvh − header − 2.5rem)]` inside the padded layout.
- **`SheetTitle`** hard-codes `text-base`; `text-display` cannot override it
  through `cn`, so the drawer renders its own amount and keeps the title
  `sr-only`. A size variant on `SheetTitle` would be cleaner.
- **Backend (mail-v2)**: thread rows serialise `booking.visit_date` as an
  RFC-1123 string ("Sat, 28 Nov 2026 00:00:00 GMT") while every other
  response is ISO; `parseApiDate` tolerates both — please emit ISO. A reply
  sent from a booking with no thread is placed in a new Gmail thread when
  the Sent-folder sync claims it (`email_messages.gmail_thrid` changes), so
  the conversation it was composed in loses the card ≈ 1 min later; the
  booking view still shows it (merged threads).
- **Backend (bank)**: rows matched by the old worker image carry `score`
  suggestions without `confidence`/`arithmetic`/`preselected`; the UI
  derives them (`describeSuggestion`) until the worker is rebuilt. The
  summary's `needs_attention` (to confirm + unmatched credits this month)
  is smaller than the Needs-attention list total (every unmatched credit);
  the tab shows the list total once loaded.
- **Bookings agent**: mount `<ConversationView bookingId={id} />` inside a
  column with a definite height (e.g. `h-[70dvh]` or a flex column), and
  keep a note box on the record for bookings without mail.

## 8. Verification and screenshots

`data/screenshots/v2/p4-*.png`, Graphite light and Fynbos dark, 1440×900
and 1920×1080 (plus 390×844 mobile for Mail):

- `p4-mail-needs-reply-*` — Needs reply with the real FY1728 conversation open (11 messages collapsed, newest open, events, context panel).
- `p4-mail-composer-*` — the composer expanded on the TEST thread (To chip, subject line, toolbar, capped height with internal scroll).
- `p4-mail-note-*` — note mode (amber) on the TEST thread; `p4-mail-sent-graphite-light-1440` — the real sent card after the one dev-redirected reply.
- `p4-mail-all-chips-*` — All mail with the Sent chip.
- `p4-mail-unmatched-attach-*` — an unmatched conversation with the attach panel.
- `p4-mail-mobile-{list,thread,composer}-*-390`.
- `p4-bank-needs-attention-*`, `p4-bank-choose-*` (5 candidates expanded), `p4-bank-matched-*`, `p4-bank-drawer-*`, `p4-bank-all-entries-*-1440`, `p4-bank-ignore-menu-graphite-light-1440`, `p4-bank-ignored-toast-graphite-light-1440`.

Interaction checks (Playwright, read-only on real data): J/K/Enter/`/`,
A → dialog, quoted history and signature toggles, View original, panel
Attach → composer with the document chip, Template insert, note tint, Esc,
draft bar, Discard, choose expansion, Find booking dialog, drawer open/close
via `?tx=`, Ignore rules dialog — all passed.

Mutations were confined to fixtures created for the run and removed
afterwards: booking `TEST P4 Composer check` (FY3716, deposit override
R1 234.56, one issued proforma), a synthetic inbound thread
`9100000000000000777`, one reply (dev-redirected to `DEV_MAIL_RECIPIENT`),
one note, bank row fingerprint `TEST-P4-001` (matched → unmatched →
ignored with a rule → undone), the scratch admin `test-p4@example.com`.
One slip during the run: an early test script clicked a real list row whose
snippet contained the word "send" and added the test note to thread
FY1740 (Jennifer Morris); that note and its `booking_events` mirror were
deleted immediately and nothing was emailed.

## 9. Gaps

- Attach file (arbitrary upload) is not built: the reply endpoint only takes
  the booking's document ids.
- "Send form link" uses the per-message `POST /inbox/messages/:id/bounce-back`
  on the latest inbound message (no conversation-level endpoint exists).
- The `Expand all` control only appears when there is more than one message.
- The Mail list keeps `?page=`; Done / not-a-booking move to the next row on
  the current page only.
- The drawer's Match closes the drawer; the slide-out animation plays on the
  list behind it.
- Managers never see Mail or Bank (admin routes), so no manager layout was done.
