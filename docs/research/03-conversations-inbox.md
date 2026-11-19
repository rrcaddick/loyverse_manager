# 03 — Conversation threads, composers and the shared inbox

## Who and what for

One operator, all day, replacing Gmail. Her jobs, by frequency: triage new mail (is it a booking enquiry, which booking), read a conversation and answer it, send a document email from a booking, and know at a glance who is waiting on us. Unlike a mailbox, every conversation here belongs to a *record*, and the app already knows what it sent (proforma, invoice, ticket, reminder) and what happened (deposit matched). The screen must be a conversation attached to a booking, not a mail client.

## What the best products do

**Help Scout.** Reply and Note buttons sit under the newest message; `R` opens a reply, `N` a note, and the note editor turns yellow with the button reading "Add Note". `/` opens a menu for saved replies, attachments and "Switch to a note"; `Cmd+Enter` sends. Folders are work queues (Unassigned, Mine, Closed; `G U`, `G M`, `G C`), `J`/`K` move. A thread can be edited to strip quoted content before replying ([respond](https://docs.helpscout.com/article/69-respond-to-conversations), [shortcuts](https://docs.helpscout.com/article/419-keyboard-shortcuts), [edit threads](https://docs.helpscout.com/article/32-thread-options)).

**Front.** An "Add internal comment" box is docked at the bottom of every conversation; Enter posts. Comments live inline with the messages. `;` expands all messages, `Shift+;` collapses; `R` reply, `Cmd+.` comment, `Cmd+E` archive, `Cmd+Enter` send-and-archive ([comments](https://help.front.com/t/k924v1), [expand all](https://help.front.com/en/articles/2416), [shortcuts](https://help.front.com/en/articles/2189)).

**Intercom.** `R` reply, `N` note, `\` macro, `Cmd+K` palette, `J`/`K` navigate; shortcuts are suspended inside the composer. Quoted parts of emails are marked with a vertical line and collapsed behind a "…" button, Gmail-style; when detection fails the thread becomes "20 browser heights of quoted text", which Intercom calls a bug ([Cmd-K](https://www.intercom.com/help/en/articles/6272267-how-to-use-command-k-with-intercom-help-desk), [quoted content](https://community.intercom.com/helpdesk-9/collapse-quoted-content-in-conversation-11077)).

**Zendesk Agent Workspace.** Newest at the bottom, composer under it, customer context in a resizable right panel. Admins can flip the order, dock the composer above, or start it collapsed "to show more of the conversation at first glance". Internal notes are yellow, public replies white; a faint tint led to agents sending private notes to customers ([order and composer](https://support.zendesk.com/hc/en-us/articles/6070249202202), [before/after](https://support.zendesk.com/hc/en-us/articles/4882193306394-Quick-reference-Before-and-after-activating-the-Agent-Workspace), [note colour complaint](https://support.zendesk.com/hc/es/community/posts/4409217497626-How-to-change-the-Internal-Note-background-color)).

**Gorgias.** Thread newest-at-bottom; composer "directly below the thread" with a channel selector top-left (Internal Note recolours the composer), macro search, "Send & Close", and a right sidebar with customer timeline and orders. `r` reply, `m` macros, `c` close, arrows next/previous ([handle tickets](https://docs.gorgias.com/en-US/handle-incoming-tickets-81832)).

**HubSpot Conversations.** The reply editor sits in the thread view and can be dragged larger. Insert adds snippets and documents; drafts autosave; outgoing mail is logged to the contact record and shows in a Sent view. The right sidebar shows the contact, ticket and past conversations ([compose and reply](https://knowledge.hubspot.com/inbox/compose-and-reply-to-emails-in-the-conversations-inbox), [use the inbox](https://knowledge.hubspot.com/inbox/use-the-conversations-inbox)).

**Chatwoot.** Reply / Private Note tabs above the composer, `Alt+P` toggles, the note composer is amber and labelled "Hidden from customers"; in the thread a note reads "Private Note · Only visible to your team". `J`/`K` navigate, `Cmd+/` lists shortcuts ([private notes](https://www.chatwoot.com/features/private-notes), [shortcuts](https://www.chatwoot.com/docs/user-guide/features/keyboard-shortcuts)).

**Missive.** Emails and internal chat "live together in unified conversations" with the chat box at the bottom; you can reply to one message or quote part of it. Gmail preset: `R` reply, `Shift+C` comment, `E` archive, `C` compose, `Cmd+Enter` send ([internal chat](https://missiveapp.com/docs/core-features/conversations/internal-chat), [shortcuts](https://missiveapp.com/docs/advanced-features/shortcuts)).

**Superhuman.** Split Inbox partitions one inbox into tabs; "Splits only show emails that are in your inbox, and haven't been marked Done". `E` done, `H` remind, `O` expand a message, `Shift+O` expand all ([splits](https://help.superhuman.com/article/441-splits), [shortcuts](https://help.superhuman.com/hc/en-us/articles/46005789591693-Speed-Up-With-Shortcuts)).

**HEY.** Receipts and notifications go to the Paper Trail, newsletters to the Feed, so the Imbox is only people. For long threads HEY "reliably detects previous replies and tucks them away until you need them", and expanding one message no longer expands all ([how it works](https://www.hey.com/how-it-works/), [improved threads](https://updates.37signals.com/post/new-in-hey-improved-threads)).

## Principles that transfer

1. **A row is a conversation, not a message.** New messages bump the row.
2. **Show only new content.** Quote and signature are collapsed behind a labelled, visible control; nothing is deleted and the original is always reachable (Plain collapses everything below "X wrote:" and keeps a "View original email" escape hatch for customers who answer inline: [article](https://help.plain.com/article/why-are-inline-email-responses-hidden-in-the-thread-timeline-5x78qm9q2t3y7j5xcxi1g7c5)). Fail open when detection is unsure.
3. **Direction needs three cues at once** (side, tint, label). Help desks do not mirror long email bodies into chat bubbles; they indent, tint and label.
4. **Notes and events share the timeline** with different skins: amber card for notes, one muted line for events.
5. **The composer is docked under the conversation**, expands in place to a cap, never a modal. The message you are answering stays visible.
6. **Views are work queues with an exit.** "Done" removes from every queue; Sent is a filter, never a queue row.
7. **Record context is a side panel**, the same panel in the inbox and on the record.
8. **`J`/`K`, `R`, `N`, `E`, `Cmd+Enter`, `Cmd+K`** are the defaults everywhere.

## Critique of our current build

Screenshots in `data/screenshots/research/`.

- **`inbox-review.png` vs `inbox-unmatched.png`: the same list.** The first seven rows are identical (Peter John Abrahams 15:35 … Lucinda Phillips 10:00); only the pager differs (1–25 of 49 vs 1–25 of 166). The API confirms why: Review is `review_status = 'pending'`, Unmatched is `booking_id IS NULL AND inbound AND NOT auto AND status <> 'not_booking'`; pending is a strict subset of unmatched (the same rows minus those older than the 14-day window), and both sort by `sent_at DESC`, so page one is always the same. Neither tab says what to *do*.
- **One row per message.** Thembakazi Silimela appears twice (12:10 "Re: Booking" and 10:31 "Booking", one thread). Counts count messages, so 166 overstates the work.
- **`inbox-all.png`: sent mail dumped in.** The first six rows are our own outbound sends, distinguished only by a "To:" prefix; no tint, no side, no kind. Inbound and outbound interleave in one grey list.
- **`inbox-thread.png`: Gmail again.** The pane scrolls to the selected message, so the two older ones are off-screen above. Five lines of new text are followed by 25+ lines of quoted history under a thin rule; the body is raw sanitised HTML in an iframe and there is no quote or signature detection anywhere in `mail_ingest.py` or the frontend. `inbox-thread-expanded.png` and `inbox-thread-scrolled.png` show the compounding: message 2 quotes message 1, message 3 quotes both, so the same paragraphs appear three times on one screen.
- **Direction is invisible.** Inbound and outbound cards are left-aligned, same width, same type; the only cue is a 14px avatar (initials vs a paper-plane glyph). The "Formatted / Plain text" toggle on every message is developer UI.
- **`inbox-composer.png`, `inbox-compose-new.png`: the modal.** It covers the message being answered. The textarea is `field-sizing-content` (auto-grows) and this `DialogContent` has no `max-h`/overflow (the create-booking dialog has one), which is exactly "a narrow box that grew off screen". Plain text only, no templates, no file attachments, no cc, no draft; documents only via a booking.
- **`inbox-booking-emails.png`: the booking's Emails tab.** Two messages, with a "Send log" column repeating the same outbound message. The Timeline tab (8) holds proforma-sent and payment events separately from Emails (2), so the booking's story is split across two tabs. The reply form is below the fold.
- **Keep:** the sandboxed iframe and remote-image gate, the failed-send alert, the attachment list, the `↑ ↓ Enter` hint.

## Recommendation for ours

**Message anatomy.** Newest at the bottom, older messages collapsed to one line each (name · first line of *new* text · time); the newest is open. Incoming: paper card, full width, ink initials avatar, name and address, time right. Outgoing: indented one avatar column, accent tint at ~6% with a 2px accent left rule, label "Farmyard Park · Linda", a kind chip ("Proforma FY1703", "Reply", "Ticket", "Reminder"), and send state ("Sent 11:02", or red "Failed · Retry"). Note: amber card, "Note · only the team sees this", author and time. System event: no card; one muted line with an icon, "Deposit R1 500 matched from FNB · booking confirmed · 09:14", "Proforma FY1703 sent · 11:00", linking to the document or payment. Attachments: chips under the body.

**Quoted history and signature.** Split at ingest, not in React: `div.gmail_quote`, a `blockquote` preceded by an "On … wrote:" / "From: … Sent:" line, `>`-prefixed text; signature = trailing block after `--`, "Sent from my iPhone", or a sign-off plus up to four lines. Store `body_new_html` and `body_quoted_html`; unparseable means all new. Render the new part, then one control: "Show quoted history (23 lines)", and "Show signature". "View original" opens the full sanitised HTML. The customer's mail still carries the quote; we just stop rendering it. `;` expands every message.

**Composer.** Docked at the bottom of the conversation pane in both the inbox and the booking, as a collapsed bar ("Reply to Nolene…" | "Note"). `R`/`N` or a click expands it in place to at most 45% of the pane; the textarea scrolls inside; the conversation stays above. Header: To chips (prefilled, editable, Cc toggle); Subject shown only when it differs from "Re: …". Mode tabs Reply / Note; Note tints the whole composer amber. Toolbar: Template (price list, availability, deposit terms, form link), Attach document (the booking's PDFs), Attach file, bold / list / link with Markdown shortcuts. Footer: Send (`Cmd+Enter`) and "Send and mark done" as default in Needs reply. On send the outgoing card appears instantly as "Sending…", then "Sent 11:02"; failure stays on the card with Retry. Drafts autosave; `Esc` collapses.

**Views and what "sent" means.** Replace Review / Unmatched / All with queues over *conversations*: **Needs reply** (latest message inbound, non-automated, not done — attached or not), **Unmatched** (no booking, not "Not a booking", any reply state), **Waiting on customer** (latest is ours), **Done**, **All mail**. The two counts are now conversations and overlap only where they should. "Done" (`E`) replaces "Mark resolved" and leaves every queue; a new inbound reopens it. Sent mail is never a queue row: it appears inside conversations as outgoing cards, and in All mail under a chip filter (Inbound · Sent · Failed · Automated); automated mail never reaches a queue. Row anatomy: counterpart name, booking chip (`FY1703 · Mount Olive`) or an amber "Unmatched" chip, subject, snippet of the latest *new* text ("You: …" when ours), time, unread dot.

**The booking's conversation tab.** Rename Emails to Conversation and merge the events into it: one stream of incoming, outgoing, notes and system lines, the same component the inbox renders. Drop the Send log column (state lives on each card; a Failed filter covers the rest). Make the right column the booking context (contact, date, status, people, balance, documents with "attach" buttons) and reuse that panel in the inbox whenever a conversation is attached; "Attach to booking" moves into that panel's empty state.

**Empty states.** Needs reply: "Nothing waiting on you · synced 2 min ago". Unmatched: "Every conversation is attached to a booking." A booking with no mail: keep "No emails yet — send the proforma or attach one from the inbox".

**Keyboard basics.** `↑`/`↓` or `J`/`K` move, `Enter` open, `R` reply, `N` note, `E` done, `A` attach to booking, `Cmd+Enter` send, `Esc` collapse, `;` expand all, `/` search, `?` cheat sheet, `G I` inbox, `G B` bookings. Single-key shortcuts are off while the composer has focus.

## Sources

- Help Scout: https://docs.helpscout.com/article/69-respond-to-conversations · https://docs.helpscout.com/article/419-keyboard-shortcuts · https://docs.helpscout.com/article/32-thread-options · https://articles.helpscout.com/blog/new-conversation-editor/
- Front: https://help.front.com/t/k924v1 · https://help.front.com/en/articles/2416 · https://help.front.com/en/articles/2189
- Intercom: https://www.intercom.com/help/en/articles/6272267-how-to-use-command-k-with-intercom-help-desk · https://community.intercom.com/helpdesk-9/collapse-quoted-content-in-conversation-11077
- Zendesk: https://support.zendesk.com/hc/en-us/articles/6070249202202 · https://support.zendesk.com/hc/en-us/articles/4882193306394-Quick-reference-Before-and-after-activating-the-Agent-Workspace · https://support.zendesk.com/hc/en-us/articles/6259543948442-Best-practices-for-creating-custom-layouts · https://support.zendesk.com/hc/es/community/posts/4409217497626-How-to-change-the-Internal-Note-background-color
- Gorgias: https://docs.gorgias.com/en-US/handle-incoming-tickets-81832
- HubSpot: https://knowledge.hubspot.com/inbox/compose-and-reply-to-emails-in-the-conversations-inbox · https://knowledge.hubspot.com/inbox/use-the-conversations-inbox
- Chatwoot: https://www.chatwoot.com/features/private-notes · https://www.chatwoot.com/docs/user-guide/features/keyboard-shortcuts
- Missive: https://missiveapp.com/docs/core-features/conversations/internal-chat · https://missiveapp.com/docs/advanced-features/shortcuts
- Superhuman: https://help.superhuman.com/article/441-splits · https://help.superhuman.com/hc/en-us/articles/46005789591693-Speed-Up-With-Shortcuts
- HEY: https://www.hey.com/how-it-works/ · https://updates.37signals.com/post/new-in-hey-improved-threads
- Plain: https://help.plain.com/article/why-are-inline-email-responses-hidden-in-the-thread-timeline-5x78qm9q2t3y7j5xcxi1g7c5
- Our code: `src/models/email_message.py` (`list_messages`, `_UNMATCHED_WHERE`), `frontend/src/features/inbox/{thread-view,composer-dialog,message-body,message-list}.tsx`, `frontend/src/features/bookings/components/emails-tab.tsx`, `docs/handoff/mail.md`.
