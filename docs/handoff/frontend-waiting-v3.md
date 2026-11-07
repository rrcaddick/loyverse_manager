# Frontend waiting v3 — per-person waiting, unanswered marks, mail rules

Owner: the Waiting v3 frontend agent, branch `feat/booking`. Implements the
owner's decision of 2026-10-09 on top of Mail + Bank v2
(`frontend-mail-bank-v2.md`) against the backend in `waiting-v3.md`
(contract: `waiting-v3-contract.md`): **"waiting on us" is per PERSON, not
per thread**. One Needs-reply row per person, every conversation with them
merged in one stream, each unanswered message marked, one reply (or Done)
covers all of it, and "Not a booking" teaches an ignored-sender list that a
Settings page manages.

```bash
cd frontend && VITE_API_TARGET=http://127.0.0.1:5100 pnpm dev --port 5316
pnpm typecheck && pnpm lint && pnpm build                       # all pass at handoff
.venv/bin/python -I frontend/scripts/shoot-waiting-v3.py --phase all   # seed → shots → flow → cleanup
```

## 1. What changed

| File | Change |
| --- | --- |
| `features/mail/types.ts` | `Party`, `PartyResponse`, `PartyActionResponse`, `IgnoredSender`, `NotBookingInput/Response`; `isParty()` / `listKey()` guards; `Thread.unanswered_count?` + `party_key?`; `MessageItem.unanswered?`; `BookingConversationResponse.unanswered_count?`; `ConversationsResponse.items` is `(Thread \| Party)[]`; `ThreadReplyInput.thrid?`. |
| `features/mail/api.ts` | `useParty(key)` → `["mail","party",key]`; `usePartyDone` / `usePartyReopen` / `usePartyReply`; `useNotBooking` takes `{learn, scope?, value?}` and returns the `rule`; `useIgnoredSenders` → `["mail","ignored-senders"]`, `useAddIgnoredSender` (reads the `{item}` envelope), `useDeleteIgnoredSender`; `clearUnanswered(items)` and `bookingIdOfParty(key)`. Party keys travel URL-encoded as one path segment (`/inbox/parties/b%3A124`). |
| `features/mail/lib.ts` | `partyName`, `waitingLine` ("2 messages waiting · oldest 4 Jun" / "1 message waiting · yesterday"), `oldestLabel`, `partyWaitingDays`, `daysSince`, `newestThread`, `domainPattern`; `waitingDays(thread)` trusts the server's `unanswered_count` when present. |
| `features/mail/conversation-list.tsx` | Two row shapes in one list: **PartyRow** (name, booking chip or amber Unmatched, waiting line in amber once > 2 days, "N conversations · subject — snippet", attachment icon, 3 px amber edge when the oldest has waited > 2 days) and **ThreadRow** (as before plus an amber `N unanswered` pill). Props: `items`, `openKey` (a `party_key` or a `thrid`), `onOpen(item)`. |
| `features/mail/message-card.tsx` | `UnansweredMark` (amber pill, 20 px) and an `unanswered` prop: the inbound card gets the mark beside its time, a 3 px amber edge and `data-unanswered="true"`; the collapsed line gets the pill. |
| `features/mail/composer.tsx` | `replyThreads` / `replyThrid` / `onReplyThridChange` → a "Reply in: <subject> · newest ▾" selector (`data-testid="reply-in"`, radio menu with "Newest · date") under the Subject line when the person has more than one thread. The default subject follows the chosen thread unless the subject was edited. |
| `features/mail/conversation-view.tsx` | New `partyKey` mode (see §2); `bookingId` mode reads `unanswered_count` and shows the waiting strip; unanswered messages stay open by default; marks clear at once after a send or Done (`settleMarks` writes into the view's own cache entry; the party mutations also write into the party / booking caches). |
| `features/mail/not-booking-dialog.tsx` | **new** — the "Not a booking?" AlertDialog with the learn checkbox (on by default), `POST …/not-booking {learn}`, toast quoting the rule the server made, Undo = `DELETE /inbox/ignored-senders/:id` + party (or thread) reopen. |
| `features/mail/context-panel.tsx` | `AttachPanel`'s "Not a booking" opens the dialog (new `partyKey` prop so Undo reopens the person). |
| `pages/mail/MailPage.tsx` | `?party=<key>` opens a person (`/mail/:thrid` still opens a thread; the path wins when both are present); the reading-pane header is the person — name, "N messages waiting · oldest … · N conversations · email" (amber while waiting), **Done** (`E`) → `POST /inbox/parties/:key/done` with an undo toast → reopen, **Reopen** once nothing waits; the ⋯ menu's "Not a booking…" opens the dialog; the context aside and the attach dialog use the person's newest thread. J/K/Enter move over parties and threads alike; the Work verb lands on `/mail?party=…`. |
| `features/work/types.ts`, `use-work-actions.tsx` | `OpenConversationAction.party_key?`; `open_conversation` navigates to `/mail?party=<key>` when present (else `/mail/<thrid>`). The row's context text is the API's ("Mrs Daniels · 1 message waiting · oldest 6 Oct"). |
| `pages/settings/MailRulesSection.tsx` | **new** — Settings › Documents & mail › **Mail rules**: ignored senders table (pattern, kind pill, reason, added, remove behind a destructive ConfirmDialog), an add form (zod: `name@host` or `@host`, optional reason), a 404 empty state while the API is not deployed. |
| `pages/settings/SettingsPage.tsx` | one rail entry: `{ value: "mail-rules", label: "Mail rules", kind: "page" }` under Documents & mail (the minimal registration the foundation note asks for). |
| `pages/bookings/BookingDetailPage.tsx` | **outside my list, two lines, flagged**: the Conversation tab's badge is now `unanswered_count` from `useBookingConversation(booking.id)` (the same query the tab's ConversationView uses, so no extra request) instead of the email count — the badge means "messages waiting on you" and hides at zero. |
| `frontend/scripts/shoot-waiting-v3.py` | **new** — seed / shots / flow / cleanup (below). |

Not touched: `hooks/use-keyboard.ts` (the cheat sheet already lists J, K,
Enter and `E` "Mark a conversation done"), the router (`/mail` already
accepts a query string), `features/work/components/*` (the row renders the
API's context text unchanged; the detail panel's "Open in Mail" goes through
the same `open_conversation` dispatcher and therefore to the party).

## 2. `ConversationView` API

```tsx
<ConversationView partyKey="b:124" markDone="default" bridge={bridge} />   // Mail › Needs reply (v3)
<ConversationView thrid="1878302343153220866" markDone="offer" />         // Mail, other views
<ConversationView bookingId={124} />                                      // booking record › Conversation
```

| Prop | Meaning |
| --- | --- |
| `partyKey?` / `thrid?` / `bookingId?` | exactly one. `partyKey` → `GET /inbox/parties/:key` (every thread of the person merged); `thrid` → `GET /inbox/conversations/:thrid`; `bookingId` → `GET /bookings/:id/conversation` (the party stream for `b:<id>`). |
| `markDone?` | as before; in party mode "Send and mark done" sends `mark_done` to the party reply. |
| `waitingStrip?` | show "N messages waiting on you · **Mark handled**" above the stream (`data-testid="waiting-strip"`). Default: booking mode only — Mail's header carries the count instead. Mark handled = `POST /inbox/parties/b:<id>/done`. |
| `shortcuts?`, `bridge?`, `className?` | unchanged. |

Behaviour:

- **Threads and the reply target.** The person's threads are ordered newest
  first (`newestThread`); the composer's "Reply in:" lists them when there
  is more than one, newest selected. Party mode replies via
  `POST /inbox/parties/:key/reply` with `thrid` = the chosen thread; thread
  mode via the thread endpoint; booking mode via the chosen thread's reply
  endpoint (any outbound to the person clears the whole party on the server),
  or `POST /bookings/:id/emails/reply` when the booking has no mail yet.
  To / name come from the latest non-automated inbound of the whole person,
  then the party's counterpart, then the booking contact.
- **Marks.** `item.unanswered` → `MessageCard unanswered`; unanswered messages
  are open by default (they are what needs reading) and the 3 px amber edge
  runs down the card. After a successful send or Done the marks and the
  count clear optimistically in the query cache; the refetch (`invalidateMailWorld`)
  confirms.
- Re-mounts per scope (`party:<key>` / `thread:<thrid>` / `booking:<id>`),
  so drafts (`localStorage["fy.mail.draft.party:b:124"]`) and composer state
  never bleed between people.

## 3. Mail page behaviour

- URL: `/mail?party=b:124&view=needs_reply` or `/mail/<thrid>?view=all`.
  `open(item)` picks the right form; `openNext` after Done / Not a booking
  works over either list. The list's cursor keys on `listKey(item)`.
- Header for a person: title = `partyName` (person, else booking contact,
  else group); line = `waitingLine` · "N conversations" (when > 1) · email,
  amber while something waits. Done when `unanswered_count > 0`, Reopen
  otherwise. For a thread: unchanged plus "N unanswered" in the line.
- `E` = Done on the open person (or thread); `R` reply and `N` note are the
  ConversationView's; `A` attach uses the person's newest thread; `J`/`K`
  move and flip the open conversation; `/` search.
- Empty copy for Needs reply now reads "Nobody is waiting on you".
- Pagination footer counts "people" in Needs reply, "conversations" elsewhere.

## 4. Not a booking

Reached from the ⋯ menu ("Not a booking…") and the attach panel / dialog.
The dialog explains that every conversation from the sender is marked not a
booking and leaves the queues, with the checkbox **Also ignore future mail
from this sender** on (hint: "their address, or everyone at `@host` when it
is a company domain"); the confirm button reads "Mark and ignore sender" /
"Mark not a booking". It calls `POST /inbox/conversations/:thrid/not-booking
{learn}` on the open thread (the person's newest), toasts "Marked as not a
booking · Future mail from @vendor.co.za is ignored · Undo" (or "… leaves
every queue" without a rule); Undo deletes the rule and reopens the person
(`/parties/:key/reopen`, thread reopen when no party is open). "Undo 'not a
booking'" in the menu still sends `{value: false, learn: false}` for a
flagged thread. The dialog body mounts per opening so the checkbox resets.

## 5. Settings › Mail rules

`/settings/mail-rules`, admin only. Table: Pattern (mono), Kind pill
(Domain blue / Address grey), Reason, Added, remove → "Stop ignoring
@host?" destructive confirm → `DELETE`. Add form: pattern validated as
`name@host` or `@host` (lower-cased), optional reason; a 422 with
`fields.pattern` lands on the field. While the endpoint 404s the card shows
an explanatory empty state and the add button is disabled.

## 6. Screenshots (`data/screenshots/v3/`, 1440×900)

Read-only on real data, Graphite light and Fynbos dark:

- `mail-needs-reply-{theme}-1440` — one row per person; amber edges on the old ones.
- `mail-party-two-threads-{theme}-1440` — the Charisse address party (2 threads, 3 unanswered) merged; `mail-party-unanswered-marks-graphite-light-1440` — the same stream scrolled to the top: amber edge, "Unanswered" pills.
- `mail-composer-reply-in-graphite-light-1440`, `mail-composer-reply-in-menu-…` — the "Reply in:" selector and its menu (nothing sent).
- `mail-not-booking-dialog-graphite-light-1440` — the dialog (cancelled).
- `mail-party-mondale-{theme}-1440` — the Mondale booking party `b:2440`: 7 threads merged, "Nothing waiting · 7 conversations", Reopen, context panel.
- `mail-all-threads-{theme}-1440` — All mail with the per-thread "N unanswered" pills.
- `work-reply-{theme}-1440` — Work › Reply rows with the API context; the verb was clicked and landed on `/mail?party=e%3A…`.
- `settings-mail-rules-{theme}-1440` — the page with two temporary rules (added and deleted through the API for the shot).

Flow on the fixtures only (Graphite light): `booking-conversation-{theme}-1440`
(tab badge "2", waiting strip, both marks), `flow-01-done-toast`,
`flow-02-not-booking-toast` ("Future mail from @example.com is ignored ·
Undo"), `flow-03-test-party`, `flow-04-reply-older-thread` (Reply in: the
older thread, subject followed), `flow-05-after-reply` ("Nothing waiting",
Reopen, the sent card), `flow-06-mail-rules-added`.

## 7. Verification

`frontend/scripts/shoot-waiting-v3.py`, Playwright Chromium against the dev
server on :5316 and the working-tree API on :5100, as the scratch admin
`test-v3@example.com` (deleted afterwards).

Fixtures (seed): booking **"V3 TEST Waiting"** (not "TEST …" — the backend
agent was running `tests/ops`, whose conftest deletes every `TEST %`
booking; the first two fixtures vanished mid-run), two synthetic inbound
threads from its contact (`91000000000000008{11,12}`, oldest 3 days old)
attached to it, and one unmatched synthetic sender thread (`…813`,
`test-v3-sender@example.com`).

Flow, all asserted against the API after each step: `E` on the sender party
→ `unanswered_count` 0 → toast Undo → 1 again; "Not a booking" with the
checkbox on → rule `@example.com` (kind domain, since example.com is not a
public mailbox) → Undo → rule deleted, party reopened; booking tab shows
"Conversation 2", the strip and two marks; the booking party in Mail reads
"2 messages waiting · oldest Tue · 2 conversations"; `R`, "Reply in:" the
older thread (subject follows), **one** send (dev-redirected to
`DEV_MAIL_RECIPIENT`, row 8333) → the outbound landed in `…811`,
`unanswered_count` 0, header "Nothing waiting", marks gone, the booking tab
shows no badge/strip/marks; Settings: `@test-v3.example` added and removed
with the confirm. Real parties were only opened; nothing real was marked or
sent. Cleanup removed the three fixture threads, the sent row (which the
Sent-folder sync had re-threaded into a real Gmail thread id — cleanup
collects thread ids by booking for that reason), the booking and any
`test-v3` rule.

## 8. Gaps and notes

- `BookingDetailPage.tsx` is the Bookings agent's file; the two-line badge
  change is the only edit there. If a thread-count badge is wanted back, add
  a second item or put the email count in the tab label.
- Work › Reply shows the API's `title` verbatim; address parties arrive
  lower-cased when the sender wrote their name that way ("sumaya keraan");
  Mail title-cases through `partyName`. A `titleCase` in `work._reply_rows`
  (backend) or in `WorkRow` would align them.
- The Mail list keeps the server's party order (oldest unanswered first) and
  `?page=`; Done / Not a booking move to the next row on the current page.
- "Reply in:" only appears with two or more threads; a booking with one
  thread replies there without a selector.
- The address party's attach panel acts on the person's newest thread; the
  server links threads one at a time, so a two-thread address party needs
  two attaches (or the second shows up under the booking after the matcher's
  thread step).
- The docker worker still runs the old image (per `waiting-v3.md`): until it
  is rebuilt, its minute sync clears `done_at` on auto-reopen and stores
  automated mail, so the needs-reply counts in the browser against :8010
  differ from the working-tree API.
