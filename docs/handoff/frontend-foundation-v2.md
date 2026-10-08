# Frontend foundation v2 — handoff

Owner: foundation agent. Scope: `frontend/src/styles`, `components`, `layouts`,
`app`, `lib`, `hooks`, `index.html`, `pages/settings`, `pages/auth`,
`pages/errors`, plus the route placeholders. This note is for the page agents
(Today + Work + Gate, Calendar + Day, Bookings, Mail + Bank, Public form +
Settings) and for the lead. It supersedes the token, theme, shell and
component sections of `frontend-shell.md`; everything else there (API client,
query keys, forms, formatting) still holds.

Spec: `docs/redesign-spec.md` (§0–§2 are what this delivers). Evidence:
`docs/research/07-design-system-colour-themes.md`.

## Running it

```bash
# API with real data (docker) on :8010, then:
cd frontend
VITE_API_TARGET=http://localhost:8010 pnpm dev --port 5301
pnpm typecheck && pnpm lint && pnpm build      # all three pass at handoff
node scripts/check-contrast.mjs                # 636 pairs, exit 1 on any failure
node scripts/check-contrast.mjs --md           # markdown table for notes
.venv/bin/python frontend/scripts/shoot-foundation.py   # screenshots → data/screenshots/v2/
```

The screenshot script logs in as the read-only research user and switches
theme through the Appearance page itself, so it exercises the preference
path; it leaves the account on Graphite / Match system / Large.

## 1. Tokens v2 (`src/styles/tokens.css`, mapped in `src/index.css`)

### Colour is meaning

Five hues, identical in every theme, each with a text colour, a soft fill
and a solid. White (`--on-solid`) sits on every solid. Use the hue that
matches the *meaning*, never the one that looks nice.

| Meaning | Tokens | Tailwind |
| --- | --- | --- |
| Done, paid, confirmed, matched | `--green-text` `--green-soft` `--green-solid` | `text-green-text` `bg-green-soft` `bg-green-solid` |
| Waiting on someone (proforma sent, deposit due, hold expiring, unmatched credit) | `--amber-*` | `text-amber-text` `bg-amber-soft` `bg-amber-solid` |
| Wrong or overdue (cancelled, no-show, overdue balance, errors) — always with a word or icon | `--red-*` | `text-red-text` `bg-red-soft` `bg-red-solid` |
| Information (incoming mail, notes, today) — never a button | `--blue-*` | `text-blue-text` `bg-blue-soft` `bg-blue-solid` |
| Not started (enquiry, lapsed, ignored, closed days) | `--grey-*` | `text-grey-text` `bg-grey-soft` `bg-grey-solid` |
| White on any solid | `--on-solid` | `text-on-solid` |
| Interactive, selected, nav, links, primary button, focus — **the only hue a theme changes** | `--primary` `--primary-foreground` `--primary-hover` `--primary-soft` `--ring` | `bg-primary` `text-primary` `hover:bg-primary-hover` `bg-primary-soft` |

Rules of thumb: text colours (`-text`) for words and, in dark mode, for
icons and dots; solids for fills, dots and icons in light mode (3:1 or
better on the card); soft fills only on small things (pills, counters),
never behind a paragraph. Tailwind's default palette is switched off
(`--color-*: initial`), so `bg-green-500` does not exist; one compatibility
alias `--color-red-500` → red solid remains for the first calendar build's
OVER rule and goes with calendar v2.

Semantic aliases the shadcn primitives use: `--success` / `--warning` /
`--info` / `--destructive` are the green / amber / blue / red solids with
`--on-solid` foregrounds (`text-warning-foreground` is therefore white —
use `text-amber-text` for amber words).

Direction of mail: `--direction-in` (blue dot, "From"), `--direction-out`
(grey arrow). Selection: `--selection-ring` (2 px accent ring) and
`--selection-row` (accent tint at L 0.93 light / 0.30 dark) →
`ring-selection-ring`, `bg-selection-row`.

### Status map (`--status-*-bg/fg`, consumed by `StatusPill`)

enquiry grey · proforma_sent amber · confirmed green · completed
green-muted (tick, no fill) · cancelled red (**bold: solid fill, white
text**) · lapsed / no_show red-muted (grey fill, red text) · blue for
information. `--pill-ring` is a 10 % ink ring in normal themes and
`currentColor` in High contrast, where every pill fill drops to transparent.

### Surfaces (shared lightness in every theme)

| Token | Light L | Dark L | Tailwind |
| --- | --- | --- | --- |
| `--background` (canvas) | 0.985 | 0.20 | `bg-background` |
| `--card` / `--popover` | 0.995 | 0.245 / 0.26 | `bg-card` |
| `--surface-nested` (`--muted`, `--accent`) | 0.965 | 0.27 | `bg-nested` `bg-muted` |
| `--sidebar` | 0.94 | 0.17 | `bg-sidebar` |
| `--border` | 0.86 | white 14 % | `border-border` `ring-border` |
| `--border-strong` / `--input` | 0.78 / 0.80 | 22 % / 20 % | `border-border-strong` `border-input` |
| `--foreground` / `--muted-foreground` / `--faint-foreground` | 0.21 / 0.47 / 0.62 | 0.95 / 0.72 / 0.58 | `text-foreground` `text-muted-foreground` `text-faint-foreground` |

Cards are `bg-card ring-1 ring-border rounded-xl` (not `ring-foreground/10`).
High contrast: canvas and card pure white (dark: black / 0.12), borders at
L 0.75 (dark: white 45 %), 3 px focus outline, muted text ≥ 7:1.

### Themes

`[data-theme="graphite|fynbos|indigo|lagoon|cocoa|contrast"]` on `<html>`
plus `.dark`. A theme block sets only `--accent-h`, `--accent-c`,
`--accent-c-dark`, `--accent-light(-hover)`, `--accent-dark(-hover)`,
`--surface-h`, `--surface-c(-dark)`, `--ink-c`, `--heat-chroma`; every other
token is derived in the two shared blocks (`:root, [data-theme]` for light,
`.dark, [data-theme].dark` for dark). Because the derived blocks also match
any element carrying `data-theme`, a `<div data-theme="fynbos" class="dark">`
renders a complete Fynbos-dark token set inside a Graphite-light page — that
is how the Appearance tiles work, and page agents may use the same trick
for previews. Adding a theme = one block of twelve variables; run the
contrast script.

| Theme | Accent light / dark | Surface tint |
| --- | --- | --- |
| Graphite (default) | `oklch(0.25 0.012 60)` / `oklch(0.92 0.008 80)` | warm, hue 85 |
| Fynbos | `oklch(0.48 0.17 305)` / `oklch(0.76 0.13 305)` | lilac, hue 300 |
| Indigo | `oklch(0.47 0.17 265)` / `oklch(0.74 0.13 265)` | slate, hue 250 |
| Lagoon | `oklch(0.47 0.09 195)` / `oklch(0.76 0.10 195)` | neutral |
| Cocoa | `oklch(0.40 0.07 55)` / `oklch(0.78 0.07 60)` | warm, hue 85 |
| High contrast | `#030303` / `#ffffff` | none |

### Capacity ramp

`--heat-0` (transparent) and `--heat-1…5` on the accent hue: L 0.95 / 0.89 /
0.81 / 0.72 / 0.62 light, 0.28 / 0.34 / 0.40 / 0.46 / 0.52 dark, chroma
scaled by the theme's `--heat-chroma` (Graphite 0.35 = warm greys, Indigo
0.8, Lagoon 0.75, Contrast 0 = grey ramp). `bg-heat-N`. **All text on a
heat cell is full ink** (`--heat-text` = `--foreground`, `text-heat-text`):
ink on heat-5 measures 4.8:1 light / 4.8:1 dark, so captions must differ by
size and weight, not by a lighter colour — muted ink fails at every step.

### Type scale (`src/index.css`)

Root 16 px scaled by `data-text-size` (default 16, large 17 — the default
preference, xlarge 18). Everything is rem, so the knob scales spacing too.

| Utility | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `text-display` | 36 / 40 | 600, −0.01em | BigNumber, week totals, balance |
| `text-title` | 28 / 34 | 600 | one per page (PageHeader) |
| `text-section` | 18 / 26 | 600 | card and section headers |
| `text-body` (= `text-base`) | 15 / 22 | 400 | tables, forms, previews; the body default |
| `text-sm` | 14 / 20 | 400, muted | second line in a cell, help text (the spec's "secondary"; a `text-secondary` utility would collide with the `secondary` colour) |
| `text-label` | 12 / 16 | 500, +0.04em | column headers, eyebrows, rail group labels; never below 12 |
| `text-button` | 15 / 20 | 500 | buttons (built in) |
| `text-xs` … `text-4xl` | 12 · 14 · 15 · 18 · 20 · 28 · 36 · 48 | | the raw scale |

`tabular` (utility) or `[data-numeric]` for every number; tables get it
automatically. Prose/email width `max-w-prose` (42 rem); page content
`max-w-page` (1600 px, applied by the layout).

### Spacing and shape

Named sizes beside Tailwind's 4 px grid: `gutter` 32 (`px-gutter`), `card`
20 (`p-card`), `card-gap` 24 (`gap-card-gap`), `field` 16, `row-sm` 36,
`row` 44, `row-lg` 48, `row-queue` 56, `thead` 40, `header` 56, `target` 44
— e.g. `h-row`, `min-h-row-queue`, `h-thead`. Radius 8 px family
(`rounded-lg` 8, `rounded-xl` 12). Two elevations: `shadow-sm` raised,
`shadow-md` overlay; everything else is a 1 px border. Utilities:
`edge-amber|red|green|blue|accent` (3 px left bar), `hatched` (closed days),
`scrollbar-thin`, `hc:` variant (High contrast only).

## 2. Appearance runtime (`src/lib/appearance.ts`, `appearance-sync.tsx`)

```ts
const { appearance, resolvedMode, setAppearance, themes, modes, textSizes } = useAppearance();
setAppearance({ theme: "fynbos" });           // applied at once, persisted, synced
```

- `Appearance = { theme, mode: light|dark|system, text_size: default|large|xlarge }`;
  default Graphite / system / large. Stored in `localStorage["fy.appearance"]`
  (the old `fy.theme` is migrated), applied as `data-theme`, `data-text-size`
  and `.dark` on `<html>` plus `color-scheme`. `index.html` applies the stored
  value before first paint. A `matchMedia` watcher re-applies for "system";
  a `storage` listener follows other tabs.
- `AppearanceSync` (mounted in `App.tsx`): when the session carries
  `user.preferences` it wins over local on load; a change made in the app
  is `PUT /users/me/preferences {theme, mode, text_size}` after 400 ms. A 404
  marks the endpoint unavailable for the session and we keep working from
  storage (the docker API at :8010 returned no `preferences` and 404 on PUT
  during this build). `User.preferences?` is in `types/api.ts`;
  `useUpdateMyPreferences()` in `features/users/api.ts` is the toasting form.
- `useTheme()` in `lib/theme.tsx` is a shim over the store for the first
  build's `ThemeToggle` / `ThemeMenuItems` (mode only). `ThemeProvider` is a
  pass-through.

## 3. Shell

- **Sidebar** (`components/layout/app-sidebar.tsx`, model in `lib/nav.ts`):
  Today · Work · Calendar · Bookings · Mail · Bank · Gate, then Settings ·
  Users · System and the user menu at the bottom. Managers see Today,
  Calendar, Gate, Settings (Personal only). 40 px items, 20 px icons, a 3 px
  accent bar on the active item, counts on Work / Mail / Bank (a dot in the
  icon rail). Ctrl/Cmd+B, the rail handle and `useSidebarCollapsed()`
  collapse it; `/calendar` is collapsed automatically by the layout and the
  person's own cookie is never overwritten by a forced collapse.
- **`useNavCounts()`** (`hooks/use-nav-counts.ts`): work = sum of
  `GET /work/counts` (minus `stale`, or its `total`), mail =
  `GET /inbox/conversations?view=needs_reply&page_size=1` → `total`, bank =
  `GET /payments/summary` → `counts.suggested`. 404 or any failure → `null`
  → no badge (today only Bank has a number: 4). Keys `["work","counts"]`,
  `["mail","counts"]`, `["bank","counts"]`, refetched every 60 s;
  invalidating `["work"]`, `["mail"]` or `["bank"]` refreshes a badge, or call
  `invalidateNavCounts(queryClient)`.
- **Header**: 56 px, breadcrumb (route `handle.crumb`), search (`/`), `?`
  help button. **User menu**: Appearance, Change password, Keyboard
  shortcuts, Sign out. `useShell().openHelp()` opens the cheat sheet.
- **Layout handles** (`layouts/AppLayout.tsx`): `handle.layout = "full"`
  drops the page padding and gives the page `calc(100dvh − 56px)` (the
  calendar's viewport fit); `handle.collapseSidebar = true` forces the icon
  rail. Content otherwise sits in `max-w-page` with 32 px gutters and 24 px
  gaps.
- **Keyboard** (`hooks/use-keyboard.ts`): `useShortcut("g t", fn)`,
  `useShortcut("/", fn)`, `useShortcut("mod+enter", fn, { allowInInputs: true })`,
  `useShortcut("shift+arrowup", fn)`. One document listener; keys pause in
  text fields unless `allowInInputs`; a sequence prefix waits 1 s; the most
  recent registration of a combo wins so a page can override. Global map:
  `G T/W/C/B/M`, `/`, `?`, Ctrl+B, Esc; documented page keys (T, ← → ↑ ↓,
  J K, Enter, 1, 2, E, Ctrl+Enter) live in `KEYBOARD_MAP` and the `?` dialog
  (`components/keyboard-cheat-sheet.tsx`); pass `extra` groups to add rows.

## 4. Routes (`src/app/router.tsx`) and placeholders

| Route | Component | Status |
| --- | --- | --- |
| `/today`, `/today/:date` | `pages/today/TodayPage.tsx` | placeholder → renders `calendar/DayPage` (reads `:date`, today when absent) |
| `/work` | `pages/work/WorkPage.tsx` | placeholder → renders `queue/QueuePage` |
| `/calendar` | `pages/calendar/CalendarPage.tsx` | existing; sidebar auto-collapsed; add `handle: { layout: "full" }` when the viewport-fit layout lands |
| `/bookings`, `/bookings/:id` | existing | |
| `/mail`, `/mail/:thrid` | `pages/mail/MailPage.tsx` | placeholder → renders `inbox/InboxPage` (list only; reading pane returns with Mail v2) |
| `/bank` | `pages/bank/BankPage.tsx` | placeholder → renders `payments/PaymentsPage` (`?tx=` drawer works) |
| `/gate` | `pages/gate/GatePage.tsx` | placeholder empty state |
| `/settings`, `/settings/:section` | `pages/settings/SettingsPage.tsx` | done (rail) |
| `/users`, `/system` | existing; `system/SystemPage.tsx` is the moved Ops page | |
| `/request`, `/request/visit|group|contact|check`, `/request/sent[/:id]` | `pages/public/Request*Page.tsx` | step placeholders render `RequestPage`; `/request/sent/:id` renders `RequestSentPage` |
| `/login`, `/change-password` | restyled | |

Redirects (query string and hash carried): `/` → `/today`, `/day/:date` →
`/today/:date`, `/queue` → `/work`, `/inbox[/:id]` → `/mail`, `/payments` →
`/bank`, `/ops` → `/system`; `/settings` → `/settings/season` (manager:
`/settings/appearance`). `homeFor()` is `/today` for both roles;
`MANAGER_PATHS` in `lib/nav.ts` lists what a manager may open — add a
pattern there when a shared page gains a sub-route. Replace a placeholder by
overwriting the file and keeping the default export; the route, crumb and
role rules already exist. `DayPage` itself only changed its links
(`/day/…` → `/today/…`).

## 5. Component inventory

All in `src/components/` unless noted. Existing components not listed
(`KeyValue`, `ConfirmDialog`, `CopyButton`, `Logo`, forms, skeletons) are
unchanged apart from the new scale.

**StatusPill** (`status-pill.tsx`; `status-badge.tsx` re-exports it as
`StatusBadge` / `BooleanBadge` for existing callers)
```tsx
<StatusPill status="proforma_sent" />                    // booking status → tone + label
<StatusPill tone="amber" label="Waiting 3 d" />
<StatusPill tone="green-muted" label="Completed" />      // tick, no fill
<StatusPill tone="red" label="Overdue" icon={Clock} />   // the only bold pill
<StatusDot tone="green" label="Confirmed" />             // bare dot for rows
```
Tones: `neutral | amber | green | green-muted | red | red-muted | blue`;
`BOOKING_STATUS_META` maps statuses. 22 px, 13 px text, 1 px ring.

**BigNumber / BigNumberRow** (`big-number.tsx`)
```tsx
<BigNumberRow>
  <BigNumber label="Groups today" value={3} detail="0 arrived" />
  <BigNumber label="People" value={formatNumber(300)} detail="200 confirmed" />
  <BigNumber label="Owed at the gate" value={formatMoney(20210, { compact: true })} detail="R 7 790 paid" tone="amber" />
  <BigNumber label="Needs you" value={12} detail="oldest 3 d" to="/work" />
</BigNumberRow>
```
`tone` only when the state deviates; `loading` keeps the height; `to` /
`onClick` make the tile a link; `size="lg"` for 1920.

**KindRail** (`kind-rail.tsx`) — vertical views with counts, hidden at zero
unless `always`; ↑ ↓ Home End; items with `to` become links.
```tsx
<KindRail aria-label="Work views" value={view} onChange={setView}
  items={[{ value: "up_next", label: "Up next", count: 10, always: true },
          { value: "reply", label: "Reply", count: 4, tone: "blue", icon: Mail },
          { value: "stale", label: "Stale", count: 38, muted: true }]} />
```

**SegmentedTabs** (`segmented-tabs.tsx`) — `variant="segmented"` (buckets)
or `"line"` (record tabs), counts hide at zero, ← → Home End.
```tsx
<SegmentedTabs aria-label="Buckets" value={tab} onChange={setTab}
  items={[{ value: "pending", label: "Pending", count: 12 }, { value: "confirmed", label: "Confirmed", count: 7 }, { value: "all", label: "All" }]} />
```

**CapacityBar** (`capacity-bar.tsx`) — green confirmed, amber pending,
denominator = capacity or the interest when larger; `caption="full|compact|none"`;
sets `data-over` and shows OVER when over capacity. `role="meter"`.
```tsx
<CapacityBar confirmed={550} pending={250} capacity={1000} height={6} caption="compact" />
```

**MoneyLadder** (`money-ladder.tsx`) — Total / Deposit / Paid / Balance,
one state word top right, `onClick` on a row for the payments list.
```tsx
<MoneyLadder state={{ label: "Deposit paid", tone: "green" }} rows={[
  { key: "total", label: "Total", amount: 6365, note: "67 × R95" },
  { key: "deposit", label: "Deposit", amount: 3800, note: "due Fri 31 Oct", tone: "amber" },
  { key: "paid", label: "Paid", amount: 3800, note: "2 payments", tone: "green", onClick: openPayments },
  { key: "balance", label: "Balance", amount: 2565, emphasis: true, note: "on the day" }]} />
```

**NextStepStrip** (`next-step-strip.tsx`) — urgency `neutral | blue | amber
| red | green` colours the left edge and icon only; one filled `primary`,
ghost `secondary`, `menu` for ⋯.
```tsx
<NextStepStrip urgency="amber" icon={Clock} title="Deposit due in 3 days"
  detail="R 3 800 by Fri 31 Oct · proforma sent 12 days ago"
  primary={<Button>Record payment</Button>} secondary={<Button variant="ghost">Send reminder</Button>} />
```

**SectionHeader** (`section-header.tsx`) — icon in semantic colour
(`tone`), title, count pill, actions, 1 px rule (`rule={false}` inside cards).
```tsx
<SectionHeader icon={Mail} tone="blue" title="Needs a reply" count={9} actions={<Button size="sm" variant="ghost">All mail</Button>} />
```

**EdgeBar** (`edge-bar.tsx`) — `<EdgeBar tone="amber" as="li">…</EdgeBar>`
draws the 3 px bar; `tone={null}` draws none. Or use `className="edge-amber"`.

**DataTable** (`data-table/`) — 44 px rows (`py-[0.6875rem]`), 40 px sticky
header with `text-label`, `compact` → 36 px; selection uses
`bg-selection-row`. Density toggle:
```tsx
const [compact, setCompact] = useTableDensity("bookings");
<DataTable columns={columns} data={items} compact={compact}
  toolbar={<DataTableDensityToggle compact={compact} onChange={setCompact} />} … />
```
`dense` still works as an alias.

**EmptyState** (`empty-state.tsx`) — `variant="page" | "card" | "inline"`
(`compact` = inline), `hint` for the learning cue, `link` for the pathway.
```tsx
<EmptyState icon={Inbox} title="Nothing to reply to" hint="Mail is checked every minute; customer replies land here." link={{ to: "/mail", label: "Open Mail" }} />
```

**KeyboardHint** (`keyboard-hint.tsx`) — `<KeyboardHint keys={["G", "T"]} />`
renders "G then T"; `["Ctrl", "Enter"]` a chord. Put one inside a button
label for the row verbs (`1`, `2`).

**PageHeader** (`layout/page-header.tsx`) — 28 px title, optional one-line
description, `eyebrow`, `actions`, children for tabs. **Section**
(`section.tsx`) — card with `text-section` title; `layout="split"` (or the
`SectionLayoutContext`) gives the Settings two-column form. **SaveBar**
reads "Unsaved changes · Discard · Save".

**Toasts** (`lib/toast.ts`)
```ts
toastWithUndo("R 3 800 recorded on FY1698", { description: "Harbour of Hope", onUndo: () => unmatch.mutateAsync(id) }); // 10 s
toastWithAction("Deposit covered", { label: "Send payment confirmation", onClick: send });
```

## 6. Settings

`pages/settings/SettingsPage.tsx` renders the rail (Park: Season, Pricing &
deposits · Documents & mail: Documents, Email, Reminders, Templates · Public:
Booking form · Personal: Appearance, Password · Admin: Users, System as
links) and the current section; every `<Section>` inside is two-column via
`SectionLayoutContext = "split"`. The existing tabs (`SeasonTab` …
`FormTab`) are unchanged and still receive `data: SettingsResponse`. To add a
section: push `{ value, label, roles, kind: "settings" | "page", component }`
into `SETTINGS_GROUPS`; `kind: "page"` sections get no `data`. Managers get
Personal only and are redirected elsewhere.

- **Appearance** (`AppearancePage.tsx`): six 160×100 tiles rendered in
  their own theme (sidebar strip, card, green and amber pills, primary
  button), Mode and Text size as radio cards; applies at once, no save bar.
- **Templates** (`TemplatesSection.tsx`): lists `GET /inbox/templates`
  when it exists (404 today → explanatory empty state). Placeholder for the
  Settings agent.
- **Password** (`PasswordSection.tsx`): the shared `ChangePasswordForm`
  (`pages/auth/change-password-form.tsx`) in a card; `/change-password`
  uses the same form for the forced flow.

## 7. Auth 401 race (fixed)

`lib/auth.tsx`: an anonymous 401 (the first session check on `/request`)
now only sets the session to `null`. Private queries are removed only when
a user *was* signed in (expiry or sign-out), and never the `auth` or
`public` prefixes, so the public `["public","form-config"]` query is never
discarded mid-flight. `clearPrivateQueries(queryClient)` is exported for
anyone who needs the same rule.

## 8. What each page agent must use

- Tiles → `BigNumber`; rails → `KindRail`; buckets/tabs → `SegmentedTabs`;
  statuses → `StatusPill` (never a custom pill); urgency → `EdgeBar` /
  `NextStepStrip`, never a tinted fill; section titles → `SectionHeader`;
  money → `formatMoney` + `tabular`, colour only when the state deviates;
  tables → `DataTable` (44 px) or 56 px list rows (`min-h-row-queue`);
  empties → `EmptyState` with a `hint` and a `link`; done rows →
  `toastWithUndo`.
- Colour: `text-*-text` for words, `bg-*-solid` for dots/icons/fills,
  `bg-*-soft` only on pills and counters; the accent only on interactive or
  selected things. Nothing below `text-xs` (12 px).
- Keys: `useShortcut`; add page rows to the cheat sheet via `extra`.
- Counts: after any action that changes work, invalidate your prefix
  (`["work"]`, `["mail"]`, `["bank"]`) or call `invalidateNavCounts`.
- Calendar: add `handle: { layout: "full" }` to its route when the
  viewport-fit layout lands; the sidebar is already collapsed there. All
  text on heat cells is `text-heat-text` (full ink).
- Public form: keep the `["public", …]` key prefix for anything the
  anonymous visitor loads.
- Previews in another theme: wrap in `<div data-theme="…" className={dark ? "dark" : ""}>`.

## 9. Contrast (WCAG 2, measured on the gamut-mapped sRGB values)

`node scripts/check-contrast.mjs` checks 636 pairs across six themes × two
modes: body and secondary text on canvas, card, nested and sidebar; the
active sidebar item; button text on the accent and the accent as text;
selected-row text; every hue's text on its soft fill, on card and on canvas;
white on every solid; icon colours on card; every status pill; ink on each
heat step; border visibility. All pass; the key pairs:

<details>
<summary>Key pairs for all six themes, light and dark (228 rows)</summary>

| Theme | Mode | Pair | Colours | Ratio | Min | Result |
| --- | --- | --- | --- | ---: | ---: | --- |
| graphite | light | Body text on card | `#1b1812` on `#fefdfc` | 17.43 | 4.5 | pass |
| graphite | light | Secondary text on card | `#5e5a53` on `#fefdfc` | 6.75 | 4.5 | pass |
| graphite | light | Sidebar text on sidebar | `#312d27` on `#edebe7` | 11.49 | 4.5 | pass |
| graphite | light | Button text on accent | `#ffffff` on `#26201c` | 16.08 | 4.5 | pass |
| graphite | light | Accent as text on card | `#26201c` on `#fefdfc` | 15.83 | 4.5 | pass |
| graphite | light | Card border on card | `#d3d1cd` on `#fefdfc` | 1.50 | 1.3 | pass (visibility, not WCAG) |
| graphite | light | green text on green soft | `#005725` on `#ccf4d3` | 7.30 | 4.5 | pass |
| graphite | light | white on green solid | `#ffffff` on `#09672e` | 7.02 | 4.5 | pass |
| graphite | light | amber text on amber soft | `#6c4200` on `#ffe5af` | 7.07 | 4.5 | pass |
| graphite | light | white on amber solid | `#ffffff` on `#976202` | 5.17 | 4.5 | pass |
| graphite | light | red text on red soft | `#94020d` on `#ffdfdc` | 7.41 | 4.5 | pass |
| graphite | light | white on red solid | `#ffffff` on `#cc2827` | 5.38 | 4.5 | pass |
| graphite | light | blue text on blue soft | `#004b7a` on `#d2ecff` | 7.51 | 4.5 | pass |
| graphite | light | white on blue solid | `#ffffff` on `#0068a6` | 5.95 | 4.5 | pass |
| graphite | light | grey text on grey soft | `#423c37` on `#eae7e3` | 8.81 | 4.5 | pass |
| graphite | light | white on grey solid | `#ffffff` on `#5d5751` | 7.12 | 4.5 | pass |
| graphite | light | status red-muted pill | `#94020d` on `#eae7e3` | 7.49 | 4.5 | pass |
| graphite | light | ink on heat-1 | `#1b1812` on `#f5ede6` | 15.29 | 4.5 | pass (all text on a heat cell is full ink) |
| graphite | light | ink on heat-5 | `#1b1812` on `#9b806b` | 4.80 | 4.5 | pass (all text on a heat cell is full ink) |
| graphite | dark | Body text on card | `#f0eeea` on `#22201d` | 14.02 | 4.5 | pass |
| graphite | dark | Secondary text on card | `#a7a49e` on `#22201d` | 6.54 | 4.5 | pass |
| graphite | dark | Sidebar text on sidebar | `#d3d1cc` on `#110f0c` | 12.54 | 4.5 | pass |
| graphite | dark | Button text on accent | `#0e0d0c` on `#e7e4df` | 15.31 | 4.5 | pass |
| graphite | dark | Accent as text on card | `#e7e4df` on `#22201d` | 12.81 | 4.5 | pass |
| graphite | dark | Card border on card | `#6d6d6c` on `#22201d` | 3.14 | 1.3 | pass (visibility, not WCAG) |
| graphite | dark | green text on green soft | `#9ee1ab` on `#1a3520` | 8.77 | 4.5 | pass |
| graphite | dark | white on green solid | `#ffffff` on `#21763c` | 5.64 | 4.5 | pass |
| graphite | dark | amber text on amber soft | `#f4cf82` on `#432a08` | 8.96 | 4.5 | pass |
| graphite | dark | white on amber solid | `#ffffff` on `#905c00` | 5.65 | 4.5 | pass |
| graphite | dark | red text on red soft | `#ffb5ae` on `#521d1b` | 8.05 | 4.5 | pass |
| graphite | dark | white on red solid | `#ffffff` on `#ba2b28` | 6.06 | 4.5 | pass |
| graphite | dark | blue text on blue soft | `#a4d5f7` on `#163347` | 8.41 | 4.5 | pass |
| graphite | dark | white on blue solid | `#ffffff` on `#0f68a2` | 5.96 | 4.5 | pass |
| graphite | dark | grey text on grey soft | `#d1cdc8` on `#312d2a` | 8.63 | 4.5 | pass |
| graphite | dark | white on grey solid | `#ffffff` on `#625c58` | 6.58 | 4.5 | pass |
| graphite | dark | status red-muted pill | `#ffb5ae` on `#312d2a` | 8.10 | 4.5 | pass |
| graphite | dark | ink on heat-1 | `#f0eeea` on `#302720` | 12.61 | 4.5 | pass (all text on a heat cell is full ink) |
| graphite | dark | ink on heat-5 | `#f0eeea` on `#7b6451` | 4.79 | 4.5 | pass (all text on a heat cell is full ink) |
| fynbos | light | Body text on card | `#19171d` on `#fefdff` | 17.53 | 4.5 | pass |
| fynbos | light | Secondary text on card | `#5c5961` on `#fefdff` | 6.77 | 4.5 | pass |
| fynbos | light | Sidebar text on sidebar | `#2f2d33` on `#eceaef` | 11.39 | 4.5 | pass |
| fynbos | light | Button text on accent | `#ffffff` on `#753ba8` | 7.12 | 4.5 | pass |
| fynbos | light | Accent as text on card | `#753ba8` on `#fefdff` | 7.03 | 4.5 | pass |
| fynbos | light | Card border on card | `#d1d0d5` on `#fefdff` | 1.51 | 1.3 | pass (visibility, not WCAG) |
| fynbos | light | green text on green soft | `#005725` on `#ccf4d3` | 7.30 | 4.5 | pass |
| fynbos | light | white on green solid | `#ffffff` on `#09672e` | 7.02 | 4.5 | pass |
| fynbos | light | amber text on amber soft | `#6c4200` on `#ffe5af` | 7.07 | 4.5 | pass |
| fynbos | light | white on amber solid | `#ffffff` on `#976202` | 5.17 | 4.5 | pass |
| fynbos | light | red text on red soft | `#94020d` on `#ffdfdc` | 7.41 | 4.5 | pass |
| fynbos | light | white on red solid | `#ffffff` on `#cc2827` | 5.38 | 4.5 | pass |
| fynbos | light | blue text on blue soft | `#004b7a` on `#d2ecff` | 7.51 | 4.5 | pass |
| fynbos | light | white on blue solid | `#ffffff` on `#0068a6` | 5.95 | 4.5 | pass |
| fynbos | light | grey text on grey soft | `#423c37` on `#eae7e3` | 8.81 | 4.5 | pass |
| fynbos | light | white on grey solid | `#ffffff` on `#5d5751` | 7.12 | 4.5 | pass |
| fynbos | light | status red-muted pill | `#94020d` on `#eae7e3` | 7.49 | 4.5 | pass |
| fynbos | light | ink on heat-1 | `#19171d` on `#f3eaff` | 15.25 | 4.5 | pass (all text on a heat cell is full ink) |
| fynbos | light | ink on heat-5 | `#19171d` on `#9970c4` | 4.63 | 4.5 | pass (all text on a heat cell is full ink) |
| fynbos | dark | Body text on card | `#efeef2` on `#212024` | 14.02 | 4.5 | pass |
| fynbos | dark | Secondary text on card | `#a5a3aa` on `#212024` | 6.49 | 4.5 | pass |
| fynbos | dark | Sidebar text on sidebar | `#d1d0d5` on `#100f12` | 12.46 | 4.5 | pass |
| fynbos | dark | Button text on accent | `#11081a` on `#c49bf3` | 8.69 | 4.5 | pass |
| fynbos | dark | Accent as text on card | `#c49bf3` on `#212024` | 7.19 | 4.5 | pass |
| fynbos | dark | Card border on card | `#6d6d6e` on `#212024` | 3.13 | 1.3 | pass (visibility, not WCAG) |
| fynbos | dark | green text on green soft | `#9ee1ab` on `#1a3520` | 8.77 | 4.5 | pass |
| fynbos | dark | white on green solid | `#ffffff` on `#21763c` | 5.64 | 4.5 | pass |
| fynbos | dark | amber text on amber soft | `#f4cf82` on `#432a08` | 8.96 | 4.5 | pass |
| fynbos | dark | white on amber solid | `#ffffff` on `#905c00` | 5.65 | 4.5 | pass |
| fynbos | dark | red text on red soft | `#ffb5ae` on `#521d1b` | 8.05 | 4.5 | pass |
| fynbos | dark | white on red solid | `#ffffff` on `#ba2b28` | 6.06 | 4.5 | pass |
| fynbos | dark | blue text on blue soft | `#a4d5f7` on `#163347` | 8.41 | 4.5 | pass |
| fynbos | dark | white on blue solid | `#ffffff` on `#0f68a2` | 5.96 | 4.5 | pass |
| fynbos | dark | grey text on grey soft | `#d1cdc8` on `#312d2a` | 8.63 | 4.5 | pass |
| fynbos | dark | white on grey solid | `#ffffff` on `#625c58` | 6.58 | 4.5 | pass |
| fynbos | dark | status red-muted pill | `#ffb5ae` on `#312d2a` | 8.10 | 4.5 | pass |
| fynbos | dark | ink on heat-1 | `#efeef2` on `#2f223d` | 12.83 | 4.5 | pass (all text on a heat cell is full ink) |
| fynbos | dark | ink on heat-5 | `#efeef2` on `#7955a0` | 5.02 | 4.5 | pass (all text on a heat cell is full ink) |
| indigo | light | Body text on card | `#13191f` on `#fcfeff` | 17.50 | 4.5 | pass |
| indigo | light | Secondary text on card | `#555c63` on `#fcfeff` | 6.70 | 4.5 | pass |
| indigo | light | Sidebar text on sidebar | `#292e35` on `#e7ecf1` | 11.50 | 4.5 | pass |
| indigo | light | Button text on accent | `#ffffff` on `#2a51b8` | 7.08 | 4.5 | pass |
| indigo | light | Accent as text on card | `#2a51b8` on `#fcfeff` | 7.00 | 4.5 | pass |
| indigo | light | Card border on card | `#cdd1d7` on `#fcfeff` | 1.52 | 1.3 | pass (visibility, not WCAG) |
| indigo | light | green text on green soft | `#005725` on `#ccf4d3` | 7.30 | 4.5 | pass |
| indigo | light | white on green solid | `#ffffff` on `#09672e` | 7.02 | 4.5 | pass |
| indigo | light | amber text on amber soft | `#6c4200` on `#ffe5af` | 7.07 | 4.5 | pass |
| indigo | light | white on amber solid | `#ffffff` on `#976202` | 5.17 | 4.5 | pass |
| indigo | light | red text on red soft | `#94020d` on `#ffdfdc` | 7.41 | 4.5 | pass |
| indigo | light | white on red solid | `#ffffff` on `#cc2827` | 5.38 | 4.5 | pass |
| indigo | light | blue text on blue soft | `#004b7a` on `#d2ecff` | 7.51 | 4.5 | pass |
| indigo | light | white on blue solid | `#ffffff` on `#0068a6` | 5.95 | 4.5 | pass |
| indigo | light | grey text on grey soft | `#423c37` on `#eae7e3` | 8.81 | 4.5 | pass |
| indigo | light | white on grey solid | `#ffffff` on `#5d5751` | 7.12 | 4.5 | pass |
| indigo | light | status red-muted pill | `#94020d` on `#eae7e3` | 7.49 | 4.5 | pass |
| indigo | light | ink on heat-1 | `#13191f` on `#e7efff` | 15.33 | 4.5 | pass (all text on a heat cell is full ink) |
| indigo | light | ink on heat-5 | `#13191f` on `#6784c5` | 4.79 | 4.5 | pass (all text on a heat cell is full ink) |
| indigo | dark | Body text on card | `#ebeff3` on `#1d2125` | 14.02 | 4.5 | pass |
| indigo | dark | Secondary text on card | `#9fa5ab` on `#1d2125` | 6.51 | 4.5 | pass |
| indigo | dark | Sidebar text on sidebar | `#cdd1d6` on `#0c1014` | 12.44 | 4.5 | pass |
| indigo | dark | Button text on accent | `#060c1e` on `#82a8fd` | 8.31 | 4.5 | pass |
| indigo | dark | Accent as text on card | `#82a8fd` on `#1d2125` | 6.92 | 4.5 | pass |
| indigo | dark | Card border on card | `#6c6d6e` on `#1d2125` | 3.12 | 1.3 | pass (visibility, not WCAG) |
| indigo | dark | green text on green soft | `#9ee1ab` on `#1a3520` | 8.77 | 4.5 | pass |
| indigo | dark | white on green solid | `#ffffff` on `#21763c` | 5.64 | 4.5 | pass |
| indigo | dark | amber text on amber soft | `#f4cf82` on `#432a08` | 8.96 | 4.5 | pass |
| indigo | dark | white on amber solid | `#ffffff` on `#905c00` | 5.65 | 4.5 | pass |
| indigo | dark | red text on red soft | `#ffb5ae` on `#521d1b` | 8.05 | 4.5 | pass |
| indigo | dark | white on red solid | `#ffffff` on `#ba2b28` | 6.06 | 4.5 | pass |
| indigo | dark | blue text on blue soft | `#a4d5f7` on `#163347` | 8.41 | 4.5 | pass |
| indigo | dark | white on blue solid | `#ffffff` on `#0f68a2` | 5.96 | 4.5 | pass |
| indigo | dark | grey text on grey soft | `#d1cdc8` on `#312d2a` | 8.63 | 4.5 | pass |
| indigo | dark | white on grey solid | `#ffffff` on `#625c58` | 6.58 | 4.5 | pass |
| indigo | dark | status red-muted pill | `#ffb5ae` on `#312d2a` | 8.10 | 4.5 | pass |
| indigo | dark | ink on heat-1 | `#ebeff3` on `#1f283d` | 12.72 | 4.5 | pass (all text on a heat cell is full ink) |
| indigo | dark | ink on heat-5 | `#ebeff3` on `#4e67a0` | 4.82 | 4.5 | pass (all text on a heat cell is full ink) |
| lagoon | light | Body text on card | `#181818` on `#fdfdfd` | 17.46 | 4.5 | pass |
| lagoon | light | Secondary text on card | `#5b5b5b` on `#fdfdfd` | 6.68 | 4.5 | pass |
| lagoon | light | Sidebar text on sidebar | `#2e2e2e` on `#ebebeb` | 11.39 | 4.5 | pass |
| lagoon | light | Button text on accent | `#ffffff` on `#006969` | 6.51 | 4.5 | pass |
| lagoon | light | Accent as text on card | `#006969` on `#fdfdfd` | 6.40 | 4.5 | pass |
| lagoon | light | Card border on card | `#d1d1d1` on `#fdfdfd` | 1.50 | 1.3 | pass (visibility, not WCAG) |
| lagoon | light | green text on green soft | `#005725` on `#ccf4d3` | 7.30 | 4.5 | pass |
| lagoon | light | white on green solid | `#ffffff` on `#09672e` | 7.02 | 4.5 | pass |
| lagoon | light | amber text on amber soft | `#6c4200` on `#ffe5af` | 7.07 | 4.5 | pass |
| lagoon | light | white on amber solid | `#ffffff` on `#976202` | 5.17 | 4.5 | pass |
| lagoon | light | red text on red soft | `#94020d` on `#ffdfdc` | 7.41 | 4.5 | pass |
| lagoon | light | white on red solid | `#ffffff` on `#cc2827` | 5.38 | 4.5 | pass |
| lagoon | light | blue text on blue soft | `#004b7a` on `#d2ecff` | 7.51 | 4.5 | pass |
| lagoon | light | white on blue solid | `#ffffff` on `#0068a6` | 5.95 | 4.5 | pass |
| lagoon | light | grey text on grey soft | `#423c37` on `#eae7e3` | 8.81 | 4.5 | pass |
| lagoon | light | white on grey solid | `#ffffff` on `#5d5751` | 7.12 | 4.5 | pass |
| lagoon | light | status red-muted pill | `#94020d` on `#eae7e3` | 7.49 | 4.5 | pass |
| lagoon | light | ink on heat-1 | `#181818` on `#dbf4f4` | 15.44 | 4.5 | pass (all text on a heat cell is full ink) |
| lagoon | light | ink on heat-5 | `#181818` on `#249898` | 5.09 | 4.5 | pass (all text on a heat cell is full ink) |
| lagoon | dark | Body text on card | `#eeeeee` on `#202020` | 14.04 | 4.5 | pass |
| lagoon | dark | Secondary text on card | `#a4a4a4` on `#202020` | 6.54 | 4.5 | pass |
| lagoon | dark | Sidebar text on sidebar | `#d1d1d1` on `#0f0f0f` | 12.55 | 4.5 | pass |
| lagoon | dark | Button text on accent | `#001111` on `#57c5c5` | 9.37 | 4.5 | pass |
| lagoon | dark | Accent as text on card | `#57c5c5` on `#202020` | 7.91 | 4.5 | pass |
| lagoon | dark | Card border on card | `#6d6d6d` on `#202020` | 3.15 | 1.3 | pass (visibility, not WCAG) |
| lagoon | dark | green text on green soft | `#9ee1ab` on `#1a3520` | 8.77 | 4.5 | pass |
| lagoon | dark | white on green solid | `#ffffff` on `#21763c` | 5.64 | 4.5 | pass |
| lagoon | dark | amber text on amber soft | `#f4cf82` on `#432a08` | 8.96 | 4.5 | pass |
| lagoon | dark | white on amber solid | `#ffffff` on `#905c00` | 5.65 | 4.5 | pass |
| lagoon | dark | red text on red soft | `#ffb5ae` on `#521d1b` | 8.05 | 4.5 | pass |
| lagoon | dark | white on red solid | `#ffffff` on `#ba2b28` | 6.06 | 4.5 | pass |
| lagoon | dark | blue text on blue soft | `#a4d5f7` on `#163347` | 8.41 | 4.5 | pass |
| lagoon | dark | white on blue solid | `#ffffff` on `#0f68a2` | 5.96 | 4.5 | pass |
| lagoon | dark | grey text on grey soft | `#d1cdc8` on `#312d2a` | 8.63 | 4.5 | pass |
| lagoon | dark | white on grey solid | `#ffffff` on `#625c58` | 6.58 | 4.5 | pass |
| lagoon | dark | status red-muted pill | `#ffb5ae` on `#312d2a` | 8.10 | 4.5 | pass |
| lagoon | dark | ink on heat-1 | `#eeeeee` on `#0e2f2f` | 12.34 | 4.5 | pass (all text on a heat cell is full ink) |
| lagoon | dark | ink on heat-5 | `#eeeeee` on `#007979` | 4.51 | 4.5 | pass (all text on a heat cell is full ink) |
| cocoa | light | Body text on card | `#1b1811` on `#fefdfb` | 17.43 | 4.5 | pass |
| cocoa | light | Secondary text on card | `#5e5a52` on `#fefdfb` | 6.75 | 4.5 | pass |
| cocoa | light | Sidebar text on sidebar | `#312d26` on `#eeebe4` | 11.50 | 4.5 | pass |
| cocoa | light | Button text on accent | `#ffffff` on `#643d20` | 9.42 | 4.5 | pass |
| cocoa | light | Accent as text on card | `#643d20` on `#fefdfb` | 9.26 | 4.5 | pass |
| cocoa | light | Card border on card | `#d4d1c9` on `#fefdfb` | 1.50 | 1.3 | pass (visibility, not WCAG) |
| cocoa | light | green text on green soft | `#005725` on `#ccf4d3` | 7.30 | 4.5 | pass |
| cocoa | light | white on green solid | `#ffffff` on `#09672e` | 7.02 | 4.5 | pass |
| cocoa | light | amber text on amber soft | `#6c4200` on `#ffe5af` | 7.07 | 4.5 | pass |
| cocoa | light | white on amber solid | `#ffffff` on `#976202` | 5.17 | 4.5 | pass |
| cocoa | light | red text on red soft | `#94020d` on `#ffdfdc` | 7.41 | 4.5 | pass |
| cocoa | light | white on red solid | `#ffffff` on `#cc2827` | 5.38 | 4.5 | pass |
| cocoa | light | blue text on blue soft | `#004b7a` on `#d2ecff` | 7.51 | 4.5 | pass |
| cocoa | light | white on blue solid | `#ffffff` on `#0068a6` | 5.95 | 4.5 | pass |
| cocoa | light | grey text on grey soft | `#423c37` on `#eae7e3` | 8.81 | 4.5 | pass |
| cocoa | light | white on grey solid | `#ffffff` on `#5d5751` | 7.12 | 4.5 | pass |
| cocoa | light | status red-muted pill | `#94020d` on `#eae7e3` | 7.49 | 4.5 | pass |
| cocoa | light | ink on heat-1 | `#1b1811` on `#ffeadc` | 15.23 | 4.5 | pass (all text on a heat cell is full ink) |
| cocoa | light | ink on heat-5 | `#1b1811` on `#b97340` | 4.72 | 4.5 | pass (all text on a heat cell is full ink) |
| cocoa | dark | Body text on card | `#f1eee9` on `#22201c` | 14.05 | 4.5 | pass |
| cocoa | dark | Secondary text on card | `#a8a49d` on `#22201c` | 6.55 | 4.5 | pass |
| cocoa | dark | Sidebar text on sidebar | `#d3d1cb` on `#110f0b` | 12.54 | 4.5 | pass |
| cocoa | dark | Button text on accent | `#140b05` on `#d9ad8a` | 9.53 | 4.5 | pass |
| cocoa | dark | Accent as text on card | `#d9ad8a` on `#22201c` | 7.97 | 4.5 | pass |
| cocoa | dark | Card border on card | `#6d6d6c` on `#22201c` | 3.14 | 1.3 | pass (visibility, not WCAG) |
| cocoa | dark | green text on green soft | `#9ee1ab` on `#1a3520` | 8.77 | 4.5 | pass |
| cocoa | dark | white on green solid | `#ffffff` on `#21763c` | 5.64 | 4.5 | pass |
| cocoa | dark | amber text on amber soft | `#f4cf82` on `#432a08` | 8.96 | 4.5 | pass |
| cocoa | dark | white on amber solid | `#ffffff` on `#905c00` | 5.65 | 4.5 | pass |
| cocoa | dark | red text on red soft | `#ffb5ae` on `#521d1b` | 8.05 | 4.5 | pass |
| cocoa | dark | white on red solid | `#ffffff` on `#ba2b28` | 6.06 | 4.5 | pass |
| cocoa | dark | blue text on blue soft | `#a4d5f7` on `#163347` | 8.41 | 4.5 | pass |
| cocoa | dark | white on blue solid | `#ffffff` on `#0f68a2` | 5.96 | 4.5 | pass |
| cocoa | dark | grey text on grey soft | `#d1cdc8` on `#312d2a` | 8.63 | 4.5 | pass |
| cocoa | dark | white on grey solid | `#ffffff` on `#625c58` | 6.58 | 4.5 | pass |
| cocoa | dark | status red-muted pill | `#ffb5ae` on `#312d2a` | 8.10 | 4.5 | pass |
| cocoa | dark | ink on heat-1 | `#f1eee9` on `#392314` | 12.74 | 4.5 | pass (all text on a heat cell is full ink) |
| cocoa | dark | ink on heat-5 | `#f1eee9` on `#955729` | 4.94 | 4.5 | pass (all text on a heat cell is full ink) |
| contrast | light | Body text on card | `#030303` on `#ffffff` | 20.62 | 4.5 | pass |
| contrast | light | Secondary text on card | `#424242` on `#ffffff` | 10.05 | 4.5 | pass |
| contrast | light | Sidebar text on sidebar | `#030303` on `#f2f2f2` | 18.42 | 4.5 | pass |
| contrast | light | Button text on accent | `#ffffff` on `#030303` | 20.62 | 4.5 | pass |
| contrast | light | Accent as text on card | `#030303` on `#ffffff` | 20.62 | 4.5 | pass |
| contrast | light | Card border on card | `#aeaeae` on `#ffffff` | 2.22 | 1.3 | pass (visibility, not WCAG) |
| contrast | light | green text on green soft | `#004b1e` on `#ccf4d3` | 8.62 | 4.5 | pass |
| contrast | light | white on green solid | `#ffffff` on `#005724` | 8.79 | 4.5 | pass |
| contrast | light | amber text on amber soft | `#5d3904` on `#ffe5af` | 8.32 | 4.5 | pass |
| contrast | light | white on amber solid | `#ffffff` on `#754b03` | 7.60 | 4.5 | pass |
| contrast | light | red text on red soft | `#8b000a` on `#ffdfdc` | 8.01 | 4.5 | pass |
| contrast | light | white on red solid | `#ffffff` on `#b00c15` | 7.22 | 4.5 | pass |
| contrast | light | blue text on blue soft | `#05436c` on `#d2ecff` | 8.48 | 4.5 | pass |
| contrast | light | white on blue solid | `#ffffff` on `#015182` | 8.40 | 4.5 | pass |
| contrast | light | grey text on grey soft | `#2e2e2e` on `#eae7e3` | 11.02 | 4.5 | pass |
| contrast | light | white on grey solid | `#ffffff` on `#424242` | 10.05 | 4.5 | pass |
| contrast | light | status red-muted pill | `#8b000a` on `#ffffff` | 9.99 | 4.5 | pass |
| contrast | light | ink on heat-1 | `#030303` on `#eeeeee` | 17.78 | 4.5 | pass (all text on a heat cell is full ink) |
| contrast | light | ink on heat-5 | `#030303` on `#868686` | 5.66 | 4.5 | pass (all text on a heat cell is full ink) |
| contrast | dark | Body text on card | `#ffffff` on `#060606` | 20.26 | 4.5 | pass |
| contrast | dark | Secondary text on card | `#bebebe` on `#060606` | 10.90 | 4.5 | pass |
| contrast | dark | Sidebar text on sidebar | `#ffffff` on `#020202` | 20.75 | 4.5 | pass |
| contrast | dark | Button text on accent | `#000000` on `#ffffff` | 21.00 | 4.5 | pass |
| contrast | dark | Accent as text on card | `#ffffff` on `#060606` | 20.26 | 4.5 | pass |
| contrast | dark | Card border on card | `#b3b3b3` on `#060606` | 9.66 | 1.3 | pass (visibility, not WCAG) |
| contrast | dark | green text on green soft | `#a8ebb5` on `#1a3520` | 9.67 | 4.5 | pass |
| contrast | dark | white on green solid | `#ffffff` on `#21763c` | 5.64 | 4.5 | pass |
| contrast | dark | amber text on amber soft | `#fed98b` on `#432a08` | 9.86 | 4.5 | pass |
| contrast | dark | white on amber solid | `#ffffff` on `#905c00` | 5.65 | 4.5 | pass |
| contrast | dark | red text on red soft | `#fec4be` on `#521d1b` | 8.94 | 4.5 | pass |
| contrast | dark | white on red solid | `#ffffff` on `#ba2b28` | 6.06 | 4.5 | pass |
| contrast | dark | blue text on blue soft | `#b1deff` on `#163347` | 9.23 | 4.5 | pass |
| contrast | dark | white on blue solid | `#ffffff` on `#0f68a2` | 5.96 | 4.5 | pass |
| contrast | dark | grey text on grey soft | `#dedede` on `#312d2a` | 10.14 | 4.5 | pass |
| contrast | dark | white on grey solid | `#ffffff` on `#625c58` | 6.58 | 4.5 | pass |
| contrast | dark | status red-muted pill | `#fec4be` on `#060606` | 13.37 | 4.5 | pass |
| contrast | dark | ink on heat-1 | `#ffffff` on `#292929` | 14.55 | 4.5 | pass (all text on a heat cell is full ink) |
| contrast | dark | ink on heat-5 | `#ffffff` on `#696969` | 5.49 | 4.5 | pass (all text on a heat cell is full ink) |

</details>

Notes: two soft fills and the amber/blue text tints are a hair outside sRGB
in the note's original values; the tokens now hold the in-gamut chroma
(e.g. `--amber-soft` 0.075, `--amber-solid` 0.115), so what the file says is
what renders. Borders are "visible" (1.5:1 on card light, 3:1 dark, 3.5:1
High contrast), not WCAG-rated, which is the intent for hairlines.

## 10. Screenshots (`data/screenshots/v2/`, 1440×900 and 1920×1080)

`foundation-shell-{graphite-light,fynbos-dark,indigo-light,contrast-light,contrast-dark}-{1440,1920}.png`
(Today, the shell), `foundation-appearance-{graphite-light,fynbos-dark}-*.png`
(full page), `foundation-settings-rail-graphite-light-*.png`,
`foundation-settings-password-fynbos-dark-*.png`,
`foundation-calendar-collapsed-graphite-light-*.png` (icon rail),
`foundation-bookings-graphite-light-*.png` (table scale),
`foundation-cheatsheet-graphite-light-*.png`, `foundation-login-graphite-light-*.png`.

## 11. Notes for the lead

- The preferences endpoint is in the working tree but not in the running
  docker API; the runtime treats the PUT's 404 as "not available" and keeps
  localStorage. Once deployed, the session's `user.preferences` becomes the
  source of truth on load.
- `/work/counts` and `/inbox/conversations` 404 today, so only the Bank
  badge shows; the hooks need no change when they land (sum of counts /
  `total`).
- `pages/ops/OpsPage.tsx` moved to `pages/system/SystemPage.tsx` (title
  "System"); `/ops` redirects.
- Button, input, select and textarea primitives are now 36 / 40 px with
  15 px text (`lg` buttons 44 px); the sidebar is 15.5 rem / 3.5 rem icon
  rail; `SidebarProvider` writes its cookie only when uncontrolled.
- `frontend/scripts/` holds the contrast checker and the screenshot script;
  neither is part of the build.
