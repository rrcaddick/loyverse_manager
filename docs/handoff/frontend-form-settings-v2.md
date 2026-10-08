# Public form + Settings (Booking form, Templates) v2 — handoff

Owner: Public form + Settings agent, branch `feat/booking`. Built on
`docs/handoff/frontend-foundation-v2.md` (tokens, `PublicLayout`, the
`/request/*` routes and the Settings rail), to `docs/redesign-spec.md`
§0/§10/§11/§14, `docs/research/06-public-request-form.md` ("Recommendation
for ours") and the API in `docs/handoff/backend-v2-misc.md` §6–§7.

Files owned and changed:

| Area | Files |
| --- | --- |
| Public form feature | `frontend/src/features/public/{types,api,dates,schema,draft,a11y,use-step-form}.ts`, `{fields,date-field,step-shell,config-gate,turnstile}.tsx` (`visit-date-field.tsx` removed) |
| Public pages | `frontend/src/pages/public/Request{,Visit,Group,Contact,Check,Sent}Page.tsx` |
| Settings | `frontend/src/pages/settings/FormTab.tsx` (Booking form), `TemplatesSection.tsx` (Templates) |
| Screenshots | `frontend/scripts/shoot-public-form.py` → `data/screenshots/v2/p5-*.png` |

Run: `cd frontend && VITE_API_TARGET=http://127.0.0.1:5100 pnpm dev --port 5315`
(no login needed for `/request`). Screenshots:
`.venv/bin/python frontend/scripts/shoot-public-form.py --base http://localhost:5315 [--only form|settings] [--submit]`.

## 1. Flow

```
/request  →  /request/visit  →  /request/group  →  /request/contact  →  /request/check  →  /request/sent/:id?token=
 redirect     Step 1 of 3        Step 2 of 3         Step 3 of 3          Check your answers   Request sent
```

- **Step 1 "When would you like to come?"** (`RequestVisitPage`): Preferred
  date (required; `dd/mm/yyyy` text box, `inputmode=numeric`, plus a calendar
  button — bottom `Sheet` below 768 px, `Popover` above), Alternative date
  (optional, same control), How many visitors? (required, numeric text),
  Arrival time (native `<select>` of `form-config.arrival_slots`, "Choose a
  time" first). The one intro line sits under this title only.
- **Step 2 "Tell us about your group"** (`RequestGroupPage`): Group name,
  Kind of group (native radios in 44 px rows), Area or town, Vehicles,
  Gazebos to hire (≤ `max_gazebos`), Questions for us (one box; "Add another
  question" up to `max_questions`; × removes), Anything else we should know?
- **Step 3 "How do we reach you?"** (`RequestContactPage`): Your name
  (`autocomplete=name`), Email (`type=email`, `autocomplete=email`,
  `autocapitalize=none`), Mobile (`type=tel`, `autocomplete=tel`).
- **Check** (`RequestCheckPage`): three summary lists (`<dl>`), a Change link
  per row that navigates to the step with `state.focus = <field id>` so the
  field takes focus; the booking terms as the declaration paragraph from the
  note (no tick box; `policy_accepted: true` is sent); the honeypot
  (`website`); Turnstile; "Send request"; "Nothing is paid now." beneath.
- **Sent** (`RequestSentPage`): `GET /public/requests/:id?token=` seeded with
  the POST result (`queryClient.setQueryData` + router state) so it paints at
  once and survives a refresh. Green solid panel "Request sent", the
  reference in `text-display` with a copy button, "We have emailed a copy of
  your answers and this reference to …" **only when `acknowledged` is true**,
  the dated promise ("expect to hear from us by Friday 9 October" =
  `replyByDate`: the first weekday after the submission day that is not in
  `closed_weekdays`) with the closed-days sentence ("We are closed on Mondays
  and Tuesdays, so a request sent on a Sunday is answered on the
  Wednesday."), "What you asked for" (group, date, visitors), the three next
  steps, phone (`tel:`), WhatsApp (`https://wa.me/27814614246`), email, and
  "Send another request". Missing/expired token → "Your request was sent"
  fallback with the contact block (403/404 from the API land here too).

Every step: caption "Step N of 3", Back link (steps 2–3 and Check), a
focusable `<h1>` that takes focus on arrival (`window.scrollTo(0)` first), a
full-width 48 px Continue. The shell is `StepShell` (`step-shell.tsx`); the
form wiring is `useStepForm` (`use-step-form.ts`).

Mobile first, single column, inputs `h-11` (44 px) with `text-[1rem]` (16 px
at the default root; 17 px at the app's "large" setting), labels carry
"(optional)" (no asterisks), calendar cells 44 px on phones / 40 px on
desktop. Nothing below 12 px.

## 2. Validation and server mapping

Client rules live in `features/public/schema.ts` (`visitSchema`,
`groupSchema`, `contactSchema`, one per screen, built from `form-config`)
and mirror `src/services/public_form.validate_request`; the server stays
authoritative.

| Field | Client message(s) |
| --- | --- |
| `visit_date` | "Enter your preferred date" · "Enter the date as dd/mm/yyyy, for example 07/11/2026" · "Choose a date after today" · "The season opens on 31 October 2026" · "The season ends on 30 April 2027" · "We are closed on Mondays and Tuesdays. The next open day is Wednesday 11 November." · "The park is closed on 24 December 2026. The next open day is Friday 25 December." (`dates.ts: dateProblem`, same order and words as the server minus the closure label) |
| `alternative_date` | as above (optional) · "Choose a different day from your preferred date" |
| `visitors` | "Enter how many visitors are coming" · "Enter a whole number, for example 45" · "Group bookings are for 10 or more people. For smaller groups, buy day tickets on Quicket." · "For more than 900 people please phone us on 081 461 4246." (limits and phone from form-config) |
| `arrival_time` | "Choose an arrival time from the list" |
| `group_name` / `group_type` / `area` | "Enter the name of your group" · "Choose the kind of group" · length limits |
| `vehicles` / `gazebos` | "Enter a whole number of vehicles, for example 2" · "We have 7 gazebos to hire" |
| `questions` | per item ≤ 500 chars; blanks dropped; ≤ `max_questions` |
| `customer_notes` | ≤ 2 000 |
| `contact_name` / `contact_email` / `contact_mobile` | "Enter your name" · "Enter your email address" / "Enter an email address in the format name@example.com" · "Enter a mobile number" / "Enter a mobile number, for example 082 123 4567" (`+27`, spaces, dashes, brackets accepted; the server normalises) |

Behaviour: validate on Continue (`mode: "onSubmit"`), re-validate on change
(`reValidateMode: "onChange"`), no "please"/"invalid". On failure the
"There is a problem" summary (`ErrorSummary`, `role=alert`, `tabindex=-1`)
renders above the heading, takes focus (through an effect, after the
errors are in the DOM), and each item links to its field (`#id`, or a
router `Link` with `state.focus` when the field is on another screen). The
same words appear inline under the label; invalid fields get `aria-invalid`,
`aria-describedby="<id>-hint <id>-error"` and a 3 px red left bar
(`fields.tsx: Field`).

Server responses on the Check screen:

| Response | Handling |
| --- | --- |
| 201 | `clearDraft()`, seed `["public","request",id]`, `navigate(/request/sent/:id?token=…, {replace: true, state: {summary}})` |
| 422 `fields` | each field → `FIELD_STEP` (`schema.ts`) → summary item linking to that step; the messages are also stored (`fy.request.server-errors`) so the step shows them inline on arrival (`form.setError(type: "server")`), cleared on the field's first keystroke; Turnstile reset |
| 429 | "Too many requests have come from this connection in the last hour. Try again a little later, or phone us on 081 461 4246." |
| 400 `turnstile_failed` | "We could not confirm that you are not a robot. Complete the check again, then send your request." + widget reset |
| other | the API message, or a generic "not sent, try again" |

Opening Check with incomplete answers (deep link, cleared storage) shows the
summary with links to the screens that need attention, focused.

## 3. Session storage

| Key | Content |
| --- | --- |
| `fy.request.draft` | `Draft` (`draft.ts`): every answer as the string the box holds (`questions: string[]`, at least one entry). Written on every keystroke (`form.watch`), read once per screen mount; `clearDraft()` after a 201 |
| `fy.request.server-errors` | `{field: message}` from the last 422; `clearServerError(field)` on edit |

`emptyDraft()` is the shape; `loadDraft()` merges stored values over it so
new fields never come back `undefined`.

## 4. Dates and the calendar (`date-field.tsx`, `dates.ts`)

- Text box accepts `dd/mm/yyyy` (also `d.m.yy`, dashes, spaces, ISO);
  `parseDmy` → ISO, `formatDmy` back. The chosen day is read back under the
  box: "Saturday 7 November 2026 · peak rates apply" (`readBack`).
- The calendar (`react-day-picker` v10 through `components/ui/calendar`)
  opens on `firstBookableMonth(config)`: the first month with at least five
  bookable days (so a 31 October season start opens on November — the
  "wall of greyed dates" from the critique). `startMonth`/`endMonth` bound
  the season; days before `min_date`/after `max_date` are disabled.
- Closed weekdays and `closed_days` are a `closed` modifier (not disabled):
  hatched (`hatched` utility) and muted, legend "Closed (Mondays and
  Tuesdays)" and an amber dot "Peak rates". Tapping a closed day does not
  select; the footer `role=status` says "We are closed on Mondays and
  Tuesdays. The next open day is Wednesday 11 November."
- "Today" is not highlighted (it is never bookable).

## 5. Turnstile

`features/public/turnstile.tsx` (unchanged API: `siteKey`, `onToken`,
`onError`, `ref.reset()`), mounted **only on the Check screen**, so the
`api.js` script loads there and nowhere else; managed mode, `size:
"flexible"`, theme follows the app's resolved mode, rendered directly above
"Send request". Token expiry/timeout → `onToken(null)`. If the widget cannot
load (`error-callback` or script failure) its container collapses and the
text "The check that you are not a robot could not load. Refresh the page to
try again, or phone us on …" shows; sending then returns the server's
`turnstile_failed`, which is handled as above. Clicking Send before the
widget has produced a token shows "The check that you are not a robot has
not finished yet. Wait a moment, then send again."

Locally the real site key refuses `localhost` (headless Chromium always sees
the fallback), and `TURNSTILE_SECRET_KEY` is set, so an end-to-end send
needs an API started with both variables exported empty
(`TURNSTILE_SITE_KEY= TURNSTILE_SECRET_KEY= … create_app().run(port=5101)`;
`load_dotenv()` does not override) and a Vite proxying to it. That is how the
real submission below was made.

## 6. Settings pages

Both use the foundation's split `Section` layout and `SettingsForm`
(`SaveBar` + unsaved-changes guard) from `pages/settings/shared.tsx`.

**Booking form** (`FormTab.tsx`, `/settings/form`, section `form`):
Introduction (intro textarea; "Preview the public form" opens
`/request/visit` in a new tab), Limits (min/max group size, questions per
request), Arrival times (rows of `<input type="time">` with move up/down,
remove, "Add a time" = last + 30 min; a switch "Offer 'Not sure yet'" that
appends the literal last), Group types (code, label, weekday tier, weekend
tier, reorder, remove — restacked to fit the card), Acknowledgement (switch
"Email an acknowledgement when a request arrives" with the help text that it
is the one automatic email, off by default). Save computes
`arrival_slots = times + ["Not sure yet"]?` and PUTs only the keys whose
JSON differs from the loaded section (`useSaveFormSettings`, a local
mutation that updates the `["settings"]` cache). Validation: times
`HH:MM` and unique, max ≥ min group size, group-type codes unique.

**Templates** (`TemplatesSection.tsx`, `/settings/templates`, section
`templates`): fetches `GET /settings` itself (the rail marks it `kind:
"page"`), lists `templates.items` as cards (title, body, key shown in mono),
move up/down, remove, "Add template". New rows get `key = slug(title)`
(unique, `_2` suffix) at save; existing keys are never changed. Saved as a
whole list with `PUT /settings/templates {items}` (`useSaveTemplates`).
Validation: title and body required, titles that would slug to the same key.

## 7. Verification

Playwright (`.venv/bin/python -m playwright`, Chromium headless), see
`frontend/scripts/shoot-public-form.py` and the ad-hoc checks below.

- 390×844 (`is_mobile`, 2×): every step empty and filled, the error summary
  on empty Continue, the closed-day error, the date sheet (opens on
  November; closed tap shows the explanation), the Check screen, Check
  after a refresh (answers kept), Change → field focused (`group_name`),
  the sent page (real), the sent page after a refresh, the acknowledged
  variant (mocked GET), the invalid-link fallback, a server 422 mapped onto
  two screens, the contact step with the server message inline, 429 and
  `turnstile_failed` messages, Check with an empty draft (7 links, focused).
- 1440×900: visit (with the popover), check.
- Settings › Booking form and › Templates at 1440×900 in Graphite light and
  Fynbos dark; acknowledgement switched on → saved (API shows `true`) →
  switched off → saved (API shows `false`; left **OFF**); duplicate arrival
  time blocks Save; Templates add → key preview → body required → Discard.

TEST data created locally (delete when convenient):

- Booking **FY3713** (id 2270), group "TEST P5 form Sunshine Primary Grade
  3", 7 Nov 2026, 45 visitors, source `form` — the one real submission
  (through the Turnstile-free API on :5101). One `form_submissions` row from
  127.0.0.1. The scratch admin `test-p5@example.com` was deleted at the end.

Screenshots (`data/screenshots/v2/`): `p5-form-390-step1-empty`,
`-step1-errors`, `-step1-closed-day`, `-step1-filled`, `-date-sheet`,
`-date-sheet-closed-tap`, `-step2-empty`, `-step2-filled`, `-step3-empty`,
`-step3-server-error`, `-check`, `-check-server-422`,
`-check-turnstile-failed`, `-sent`, `-sent-after-refresh`,
`-sent-acknowledged`, `-sent-invalid-link`; `p5-form-1440-visit`,
`-visit-popover`, `-check`; `p5-settings-form-{graphite-light,fynbos-dark}-1440`,
`p5-settings-form-savebar-1440`, `p5-settings-templates-{graphite-light,fynbos-dark}-1440`,
`p5-settings-templates-adding-1440`.

## 8. Shared-component requests (not changed by this agent)

- `src/types/api.ts`: add to `FormSettings` → `max_group_size: number`,
  `arrival_slots: string[]`, `acknowledgement_enabled: boolean`; add
  `TemplatesSettings { items: {key, title, body}[] }` and `templates` to
  `Settings`. `FormTab.tsx` (`FormSettingsV2`) and `TemplatesSection.tsx`
  (`TemplateItem`) carry local copies until then; `useUpdateSection` could
  then replace the two local mutations.
- `components/form/fields.tsx`: a `TimeField` (native `type="time"`) would
  save the inline `FormField` in the arrival-times editor.
- `lib/nav.ts` / router: none needed; `/request` index now redirects to
  `/request/visit` from `RequestPage.tsx` (query string kept).
- Mail composer: read `settings.templates.items` (ordered) for the Template
  menu; keys are stable.

## 9. Gaps and notes

- At handoff `pnpm typecheck`, `pnpm lint` and `pnpm build` all pass
  repo-wide (the build was run once, at the end; earlier runs saw other
  agents' in-progress files, which have since landed).
- The widget cannot be exercised headless on localhost (site-key hostname),
  so the "token minted seconds before use" path is verified by reasoning and
  the error paths by mocked responses; try it once on the public host.
- The closed-day label ("Christmas Eve") is not in `form-config`; the client
  message omits it, the server's 422 (shown on retry) includes it. Adding
  `closed_day_labels` to form-config would align them.
- "Clicked Send before Turnstile finished" shows a message rather than
  waiting for the token; a small auto-wait could replace it.
- The sent page's reply-by rule assumes the office answers on any open park
  day (Wed–Sun); if the office keeps different days, give `replyByDate` its
  own list.
- Arrival-time rows are not auto-sorted; the operator's order is the form's
  order.
