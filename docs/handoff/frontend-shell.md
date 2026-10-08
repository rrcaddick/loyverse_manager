# Frontend shell — handoff

Owner: frontend-shell agent. Scope: everything under `frontend/`. This note is
for the agents filling in the remaining pages (queue, calendar/day, bookings,
inbox, payments, public form) and for the lead integrating the build.

## Running it

```bash
# 1. API (any port; the Vite proxy targets 5106 by default)
.venv/bin/python -c "from web.app import create_app; create_app().run(port=5106)"

# 2. Dev server with HMR at http://localhost:5173/  (proxies /api and /group-bookings)
cd frontend && pnpm install && pnpm dev
#    VITE_API_TARGET=http://127.0.0.1:8010 pnpm dev   # point at another API

# 3. Checks — all three must pass before handing back
pnpm typecheck     # tsc --noEmit (strict, noUncheckedIndexedAccess)
pnpm lint          # eslint + typescript-eslint + react-hooks
pnpm build         # → ../web/static/app  (index.html + assets/, favicon.svg)
```

In dev the app is served from `/` (so deep links like `/settings/season`
work through Vite's SPA fallback). The production build uses
`base: "/static/app/"`; Flask serves `web/static/app/index.html` for every
non-API path and the hashed assets from `/static/app/assets/…` with immutable
caching. `web/static/app/` is a build artefact; the Dockerfile (lead) should
run `pnpm install --frozen-lockfile && pnpm build` in `frontend/`.

Test accounts used while building: `test-ui@example.com` (admin, password
`test-password-1234`) and `scratch-manager@example.com` — both deleted at the
end of the shell work. Ray's real account was not touched (no password change
was made). To get a throwaway admin again:
`.venv/bin/python -c "from src.services.users import create_user; print(create_user('test-ui@example.com','UI Test','admin', password='test-password-1234'))"`.

## Stack and decisions

- Vite 8, React 19, TypeScript 5.9 strict, pnpm.
- Tailwind v4 via `@tailwindcss/vite`; tokens in `src/styles/tokens.css`,
  mapped with `@theme inline` in `src/index.css`.
- shadcn/ui **v4 registry, Radix base, "nova" preset** (`components.json`).
  Components import `cn` from the `cn` package (the registry's convention);
  `@/lib/utils` re-exports it. The registry no longer ships `form`, so
  `src/components/ui/form.tsx` is hand-written (classic Form/FormField/… API
  styled with the registry's `field` component). `sonner.tsx` was rewritten to
  use our ThemeProvider instead of next-themes.
- **react-router v7 in data mode** (`createBrowserRouter` + `RouterProvider`).
  Reasons: route-level `lazy`, `handle.crumb` for breadcrumbs, `errorElement`,
  and `useBlocker` for dirty-form guards. Add routes in `src/app/router.tsx`.
- TanStack Query v5 (`src/lib/query.ts`), TanStack Table v8 (DataTable),
  react-hook-form + zod v4 + `@hookform/resolvers`, lucide-react, sonner,
  date-fns + date-fns-tz, Inter Variable bundled from `@fontsource-variable/inter`.
  No CDNs anywhere.
- Fonts/logo: `src/assets/brand/logo.svg` (full lock-up, `fill="currentColor"`),
  `mark.svg` (square tree mark cut from the logo for the collapsed sidebar and
  favicon). Both are rendered through CSS masks (`<Logo/>`, `<LogoMark/>` in
  `src/components/brand/Logo.tsx`) so they take the current text colour in
  either theme.

## Folder layout

```
frontend/
  index.html                 theme applied before first paint; favicon via %BASE_URL%
  vite.config.ts             base (build only), alias @ → src, outDir, proxy
  eslint.config.js           react-refresh rule off for components/ and lib/
  src/
    main.tsx, index.css      entry + Tailwind/@theme mapping
    styles/tokens.css        the design tokens (light on :root, dark on .dark)
    app/                     App.tsx (providers), router.tsx, guards.tsx, ErrorBoundary.tsx
    layouts/                 AppLayout (sidebar+header), PublicLayout, AuthLayout
    lib/                     api.ts, auth.tsx, auth-store.ts, query.ts, format.ts,
                             theme.tsx, nav.ts, brand.ts, utils.ts
    hooks/                   use-document-title, use-unsaved-changes, use-subject-dialog, use-mobile
    types/api.ts             API types (User, Settings, PriceTier, SeasonDay, Ops…, BookingStatus)
    features/<area>/api.ts   query/mutation hooks per API area (settings, users, ops)
    components/
      ui/                    shadcn primitives (regenerate with `pnpm dlx shadcn@latest add <name> -o`)
      form/                  TextField, NumberField, MoneyField, TextareaField, SelectField,
                             RadioField, SwitchField, CheckboxField, DateField, MonthDayField,
                             WeekdayToggleField, FieldRow, FormError, useZodForm, applyApiErrors
      data-table/            DataTable, DataTableColumnHeader, DataTablePagination, DataTableViewOptions
      layout/                app-sidebar, app-header (breadcrumbs + search), user-menu, page-header
      brand/Logo.tsx
      section.tsx, key-value.tsx, empty-state.tsx, status-badge.tsx, confirm-dialog.tsx,
      save-bar.tsx, copy-button.tsx, theme-toggle.tsx, not-built-yet.tsx, page-skeleton.tsx
    pages/
      auth/        LoginPage, ChangePasswordPage                       (done)
      settings/    SettingsPage + SeasonTab, PricingTab, DocumentsTab,
                   RemindersTab, EmailTab, FormTab, shared.tsx         (done)
      users/       UsersPage                                           (done)
      ops/         OpsPage                                             (done)
      errors/      NotFoundPage, ForbiddenPage                         (done)
      queue/       QueuePage.tsx                                       (stub)
      calendar/    CalendarPage.tsx, DayPage.tsx                       (stub)
      bookings/    BookingsPage.tsx, BookingDetailPage.tsx             (stub)
      inbox/       InboxPage.tsx  (handles /inbox and /inbox/:messageId) (stub)
      payments/    PaymentsPage.tsx                                    (stub)
      public/      RequestPage.tsx, RequestSentPage.tsx                (stub)
```

Replace a stub by overwriting the file; keep the default export. The route,
breadcrumb and role rules already exist.

## Design tokens (`src/styles/tokens.css`)

Two layers. **Primitives**: `--ink-950…--ink-100`, `--paper-50`, `--paper-0`
(warm neutrals, hue ≈ 75°), `--oak-300…800` (the single accent, deep oak
green around `oklch(0.45 0.09 150)`), `--amber-*`, `--red-*`, `--blue-*`.
**Semantic** (what components use), each defined for light on `:root` and
dark on `.dark`:

| Token | Tailwind utility | Use |
| --- | --- | --- |
| `--background` / `--foreground` | `bg-background`, `text-foreground` | app canvas (warm off-white / warm charcoal) and ink |
| `--card`, `--popover` (+ `-foreground`) | `bg-card`, `bg-popover` | surfaces; cards sit one step lighter than the canvas |
| `--primary` (+ `-foreground`, `--primary-hover`) | `bg-primary`, `text-primary` | the oak accent: primary buttons, active states, "confirmed" |
| `--secondary`, `--muted`, `--accent` | `bg-muted`, `text-muted-foreground` | quiet fills and secondary text (AA on the canvas) |
| `--destructive` | `bg-destructive`, `text-destructive` | danger |
| `--success`, `--warning`, `--info` (+ `-foreground`) | `text-success`, `bg-warning/10`, `text-info` | semantic hues: green = done/confirmed, amber = pending/tentative, blue = informational only |
| `--border`, `--border-strong`, `--input`, `--ring` | `border-border`, `ring-ring` | hairlines and focus rings |
| `--sidebar-*` | `bg-sidebar`, `text-sidebar-foreground` … | the navigation rail (a notch deeper than the canvas) |
| `--status-{neutral,amber,green,green-muted,red,red-muted,blue}-{bg,fg}` | `bg-status-amber-bg text-status-amber-fg` | booking-status pills (use `<StatusBadge>` rather than these directly) |
| `--heat-0…5` | `bg-heat-3` | calendar heat ramp, single hue; text on 1–3 is `foreground`, on 4–5 `primary-foreground` |
| `--chart-1…5` | `bg-chart-1` | chart series (accent, amber, blue, grey, red) |
| `--radius` (8px) | `rounded-lg` = 8px, `rounded-md` = 6px, `rounded-xl` = 12px | one radius family |
| `--shadow-overlay`, `--shadow-raised` | `shadow-md`/`shadow-lg` = overlay, `shadow-sm` = raised | the only two elevations; prefer `ring-1 ring-foreground/10` for cards |
| `--ink-*`, `--paper-*` | `bg-ink-950`, `text-ink-200` | raw ramp, for rare cases like the log viewer |

Type: Inter Variable; scale `text-xs` 12 · `text-sm` 13 · `text-base` 14 ·
`text-lg` 16 · `text-xl` 20 · `text-2xl` 24 · `text-3xl` 30 (`index.css`).
Tables and anything with `.tabular` / `[data-numeric]` get tabular digits;
use the `tabular` utility on any number or money cell. Spacing is Tailwind's
4px grid. `prefers-reduced-motion` collapses all transitions globally.

Theme: `ThemeProvider` (`src/lib/theme.tsx`) stores `light | dark | system`
in `localStorage["fy.theme"]`, toggles `.dark` on `<html>` and sets
`color-scheme`. `index.html` applies it before paint. `<ThemeToggle/>`
(segmented) and `<ThemeMenuItems/>` (for menus) are in
`components/theme-toggle.tsx`.

## API client and auth

```ts
import { api, ApiError, isApiError, errorMessage, apiUrl } from "@/lib/api";
const page = await api.get<Paginated<Booking>>("/bookings", { params: { status, q, page } });
await api.post("/bookings/42/status", { status: "confirmed", reason });
```

- Same-origin cookies; JSON in/out; `204` → `undefined`.
- Every non-GET request carries `X-CSRF-Token` from the in-memory auth store
  (`src/lib/auth-store.ts`, set when the session loads). A `403 csrf` refreshes
  the session once and retries.
- Errors throw `ApiError { status, code, message, fields }`. `fields` maps
  field name → message for `validation_error`; `applyApiErrors(form, err)`
  (in `components/form`) copies them onto react-hook-form and returns the
  summary message (or null if everything landed on a field).
- `401` clears the session cache → `RequireAuth` redirects to
  `/login?next=<path>`. `403 password_change_required` flips
  `must_change_password` in the cache → redirect to `/change-password?next=`.
- `useAuth()` (`src/lib/auth.tsx`): `user`, `isAdmin`, `isManager`,
  `hasRole(...)`, `login`, `logout`, `changePassword`, `refresh`.
- Role rules live in `src/lib/nav.ts`: `navForRole`, `homeFor` (admin `/`,
  manager `/calendar`), `MANAGER_PATHS` (`/calendar`, `/day/:date`). A manager
  hitting anything else lands on `/calendar`. `safeNext` only accepts
  same-origin relative paths for post-login redirects.

## Query keys and mutations

`src/lib/query.ts` sets `staleTime: 30 s`, `retry: 1` (never on 4xx), no
refetch on window focus, and a `MutationCache` that toasts every mutation
error unless `meta: { silent: true }` (use that when the form shows the
error inline). `meta: { successMessage: "Saved" }` toasts on success.

Key conventions (keep to these so invalidation stays predictable):

```
["auth", "session"]
["settings"]
["users"]
["ops", "status"] / ["ops", "logs", lines]
["bookings", "list", params] / ["bookings", id] / ["bookings", id, "events"] / ["bookings", id, "emails"]
["calendar", from, to] / ["day", date]
["inbox", view, page, q] / ["inbox", "message", id] / ["inbox", "thread", thrid]
["payments", "transactions", params] / ["payments", "transaction", id] / ["payments", "summary"]
["queue"]
```

Pattern for a feature module (`src/features/<area>/api.ts`):

```ts
export function useBooking(id: number) {
  return useQuery({ queryKey: ["bookings", id], queryFn: () => api.get<Booking>(`/bookings/${id}`) });
}
export function useSetStatus(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { status: BookingStatus; reason?: string }) => api.post<Booking>(`/bookings/${id}/status`, input),
    meta: { successMessage: "Status updated" },
    onSuccess: (booking) => {
      qc.setQueryData(["bookings", id], booking);
      void qc.invalidateQueries({ queryKey: ["bookings", "list"] });
      void qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });
}
```

Optimistic update where it matters (toggles, dismissals): `onMutate` →
`setQueryData`, `onError` → restore from context, `onSettled` → invalidate.

## Components

**PageHeader** — every page starts with one.
```tsx
<PageHeader title="Bookings" description="Search and filter every group booking."
  eyebrow="FY1703" actions={<Button>New booking</Button>}>
  {/* optional: tabs / filter bar */}
</PageHeader>
```

**Section** — card with title row; `flush` removes padding for tables;
`footer` for a summary line; `actions` for header buttons.

**KeyValue** — `items={[{ label, value, numeric?, wide? }]}`, `layout="list"`
(label above value, `columns={2|3}`) or `"table"` (side by side).

**StatusBadge** — `<StatusBadge status="proforma_sent" />` maps booking
statuses to tones (enquiry neutral, proforma_sent amber, confirmed green,
completed green-muted, cancelled red, lapsed/no_show red-muted). Any other
string works with an explicit `tone` and `label`. `BOOKING_STATUS_META` is
exported for legends and filters. `<BooleanBadge value />` for yes/no.

**DataTable** (`@/components/data-table`)
```tsx
const columns: ColumnDef<Booking>[] = [
  { accessorKey: "reference", header: ({ column }) => <DataTableColumnHeader column={column} title="Ref" />,
    cell: ({ row }) => <Link to={`/bookings/${row.original.id}`} className="font-medium">{row.original.reference}</Link> },
  { accessorKey: "visit_date", header: "Visit", cell: ({ row }) => formatDate(row.original.visit_date) },
  { accessorKey: "people_booked", header: "People", meta: { align: "right", numeric: true } },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
];
<DataTable columns={columns} data={items} isLoading={isPending} getRowId={(b) => String(b.id)}
  onRowClick={(b) => navigate(`/bookings/${b.id}`)}
  manualPagination rowCount={total} paginationState={pagination} onPaginationChange={setPagination}
  emptyState={<EmptyState icon={BookOpenText} title="No bookings match" compact />} />
```
Client-side sorting/pagination by default; pass `manual*` for server lists.
`meta.align` right-aligns and sets tabular digits. Rows with `onRowClick` are
focusable and respond to Enter/Space but stay table rows; give the primary
cell a real `<Link>` too. `DataTableViewOptions` needs the table instance, so
build with `useReactTable` yourself when you want column toggles in a toolbar.

**ConfirmDialog** — for every send/delete/state change.
```tsx
const [open, setOpen] = useState(false);
<ConfirmDialog open={open} onOpenChange={setOpen} title="Send the proforma?"
  description="Emails FY1703 with the PDF attached." confirmLabel="Send"
  onConfirm={() => send.mutateAsync()} />   // stays open with a spinner until the promise settles
```
`useConfirm(props)` returns `{ dialog, confirm }` for one-liners. For
"act on this row" dialogs use `useSubjectDialog<T>()` (`hooks/`): it keeps
the subject after closing so the dialog does not flash empty while it
animates out — `const reset = useSubjectDialog<User>(); reset.show(user);
<ConfirmDialog open={reset.open} onOpenChange={reset.onOpenChange} … />`.

**SaveBar** — sticky bottom bar for dirty forms; render inside the `<form>`.
`dirty`, `saving`, `disabled`, `onReset`, `message`. Pair it with
`useUnsavedChanges(form.formState.isDirty)` to block navigation. The settings
tabs use `SettingsForm` in `pages/settings/shared.tsx` which bundles both,
plus `dirtyKeys`/`pick` to PUT only the changed keys of a section.

**Forms** — `useZodForm({ schema, defaultValues })` + the field helpers.
```tsx
const schema = z.object({ contact_email: z.string().email("Enter a valid email"), people: z.number({ error: "Enter a number" }).int().min(1) });
const form = useZodForm({ schema, defaultValues: { contact_email: "", people: 40 } });
<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
    <FormError message={error} />
    <FieldRow>
      <TextField control={form.control} name="contact_email" label="Email" type="email" required />
      <NumberField control={form.control} name="people" label="People" suffix="people" integer min={1} />
    </FieldRow>
    <MoneyField control={form.control} name="price" label="Price per person" />
    <DateField control={form.control} name="visit_date" label="Visit date" min={todayIso()} />
    <SelectField control={form.control} name="group_type" label="Group type" options={[{ value: "school", label: "School" }]} />
    <SwitchField control={form.control} name="deposit_waived" label="Waive deposit" description="Needs a reason." />
    <TextareaField control={form.control} name="internal_notes" label="Internal notes" rows={3} />
  </form>
</Form>
```
Number fields keep numbers in state (empty → `NaN`, so `z.number({ error })`
reports it). Dates are `"YYYY-MM-DD"` strings, the API's shape. Width is
set on the item (`className="sm:max-w-xs"`), not the input. All helpers put
`FormControl` on the actual `<input>` so labels, `aria-describedby` and
`aria-invalid` land on the control.

**EmptyState**, **NotBuiltYet**, **PageSkeleton / TableSkeleton / AppLoading**,
**CopyButton** (`value`, optional `label`; falls back to a selection copy and
toasts on failure), **Logo / LogoMark**.

## Formatting (`src/lib/format.ts`)

All dates render in Africa/Johannesburg. Date-only strings are treated as
calendar days (never shifted by the browser zone).

| Helper | Example |
| --- | --- |
| `formatMoney(3800)` / `{ compact: true }` / `{ bare: true }` | `R 3 800.00` · `R 3 800` · `3 800.00` (thin-space thousands, U+2212 minus) |
| `formatNumber(12345)`, `formatPercent(15)` | `12 345`, `15%` |
| `formatDate`, `formatDateLong`, `formatDateShort`, `formatDayMonth` | `25 Dec 2026`, `Friday, 25 December 2026`, `Fri 25 Dec`, `25 Dec` |
| `formatDateTime`, `formatTime`, `formatWeekday`, `formatMonthYear` | `25 Dec 2026, 14:05`, `14:05`, `Friday`, `December 2026` |
| `formatRelativeDay`, `formatDateTimeRelative` | `Today`, `In 3 days`, `4 days ago` |
| `toIsoDate(date)`, `todayIso()`, `parseDate(iso)` | `2026-12-25` |
| `formatPhone("27814614246")`, `toE164Digits("081 461 4246")` | `081 461 4246`, `27814614246` |
| `pluralise(3, "person", "people")`, `initials`, `truncate`, `humanise`, `formatDuration` | `3 people`, `LC`, `…`, `Proforma sent`, `1.2 s` |
| `WEEKDAYS`, `MONTHS`, `formatMonthDay("12-13")` | Python weekday numbering (0 = Monday); `13 December` |

## Adding a page

1. Create `src/pages/<area>/<Name>Page.tsx` with a default export; call
   `useDocumentTitle("Title")` and start with `<PageHeader>`.
2. Add the route in `src/app/router.tsx` under the right guard branch with
   `lazy: page(() => import("@/pages/<area>/<Name>Page"))` and
   `handle: { crumb: "Title" }` (a function `(data, params) => string` for
   dynamic crumbs, `crumbTo` to link elsewhere).
3. Add a nav item in `src/lib/nav.ts` if it belongs in the sidebar
   (`roles` controls visibility; `also` highlights for related paths).
4. Put API hooks in `src/features/<area>/api.ts` and types in `src/types/api.ts`.
5. Route-level loading is handled by the layout's `Suspense` (`PageSkeleton`);
   in-page loading should use `TableSkeleton`/`Skeleton`, never a spinner on
   a whole page.

The global search box in the header submits to `/bookings?q=…`; the
bookings list should read `q` from the URL.

## Accessibility checklist (what the shell already does; keep it that way)

- Every control has a label (`hideLabel` keeps it for screen readers).
  Icon-only buttons carry `aria-label`; decorative icons `aria-hidden`.
- Focus is always visible (`focus-visible:ring-*` on every interactive
  primitive, including table rows and the log viewer).
- Keyboard: sidebar collapses with Ctrl/Cmd+B, `/` focuses search, Escape
  closes overlays, Enter/Space activates rows, Radix handles menus/dialogs.
- Skip link to `#main-content`; landmarks (`header`, `nav aria-label="Main"`,
  `main`, `footer`); breadcrumb with `aria-current`.
- Colour is never the only signal: badges carry text, errors have `role="alert"`.
- Contrast: body and muted text are AA on both canvases; status pills use
  deep text on soft fills.
- `prefers-reduced-motion` disables transitions; the SaveBar and dialogs
  degrade to instant.
- Dark mode is a full token set, not an inversion; check both before shipping.
- Responsive: sidebar becomes a sheet below 768px; the header swaps the
  search field for an icon; wide tables scroll inside their section with
  sticky headers; forms stack to one column.

## What remains for the other frontend agents

| Page | Route(s) | Notes |
| --- | --- | --- |
| Queue | `/` | `GET /queue` sections → one card per section with counts and item rows; dismiss reminders (`POST /reminders/:id/dismiss`). |
| Calendar + Day | `/calendar`, `/day/:date` | `GET /calendar?from&to` with the heat ramp tokens (`--heat-*`), closed/avoid/peak flags; `GET /days/:date` for arrivals and gate payments. Both must work for managers (they already pass the guard). |
| Bookings list + detail | `/bookings`, `/bookings/:id` | list reads `status`, `q`, `from`, `to`, `page` from the URL; detail = status actions, finance, documents, payments, emails, events. |
| Inbox | `/inbox`, `/inbox/:messageId` | `InboxPage` handles both (list + reading pane); views `review|all|unmatched`. |
| Payments | `/payments` | bank transactions with match/unmatch/ignore. |
| Public form | `/request`, `/request/sent` | under `PublicLayout` (no session); `GET /public/form-config`, `POST /public/booking-request`. |

The `shadcn` CLI is available for more primitives:
`pnpm dlx shadcn@latest add <name> -o` (the `-o` overwrites; re-apply our
edits only to `form.tsx`, `sonner.tsx` and `use-mobile.ts` if you regenerate
those).

## Known gaps / notes for the lead

- `web/static/app/` (the build output) is currently untracked and **not**
  gitignored. Decide whether to commit builds or build inside the Docker
  image (recommended: add `web/static/app/` to `.gitignore` and run
  `pnpm build` in the Dockerfile).
- The Vite dev proxy does not forward `/static/brand`; the app bundles its
  own copies of the logo under `src/assets/brand/`.
- `GET /ops/status` is richer than §6 described; `src/types/api.ts` mirrors
  the real shape from `web/api/ops.py`. Job names are the snake_case
  `RUNNABLE` keys. There is no `backup_db` job in the API, so none is offered.
- The public layout's footer contact details are constants in
  `src/lib/brand.ts`; once `GET /public/form-config` exists the public pages
  can read them from there instead.
