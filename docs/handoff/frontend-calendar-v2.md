# Calendar v2 — handoff

Owner: calendar agent. Scope: `frontend/src/pages/calendar/CalendarPage.tsx`,
`frontend/src/features/calendar/**`. Spec: `docs/redesign-spec.md` §5;
evidence: `docs/research/02-calendar-day-view.md` ("Recommendation for
ours"); tokens, components and shell: `docs/handoff/frontend-foundation-v2.md`.
The day view (`pages/calendar/DayPage.tsx`, `/today/:date`) is another
agent's; this page links to it and still exports what it imports
(`useDay`, `DayFlags`, `monthKey`, `shiftDay`, `day-booking-card.tsx`).

## Running and verifying

```bash
cd frontend && VITE_API_TARGET=http://127.0.0.1:5100 pnpm dev --port 5312
pnpm typecheck && pnpm lint && pnpm build
.venv/bin/python <shoot-calendar.py>      # the script at the end of this note → data/screenshots/v2/p2-*.png
```

The screenshot script logs in, switches theme through the Appearance page,
shoots 1440×900 and 1920×1080 in Graphite light and Fynbos dark, and asserts
`document.documentElement.scrollHeight === clientHeight` on every calendar
screenshot (all 18 pass; `scrollWidth` is 15 px under `clientWidth` because
`html` has `scrollbar-gutter: stable`).

## 1. Component map (`src/features/calendar/`)

| File | What |
| --- | --- |
| `month.ts` | Date maths: `buildWindow(from, rows)` (Monday-first, N weeks), `normaliseFrom`, `mondayOnOrBefore`, `monthStartWindow`, `windowWithInRowTwo`, `anchorMonth` (month of the first row's Sunday), `shiftWindowMonth`, `windowTitle`, `weekMonthKey`, `dayNumberLabel` ("1 Dec"), `relativeDayLabel`, `sameDayInMonth`; plus the exports other pages use (`monthKey`, `shiftDay`, `daysBetween`, `shiftMonth`, `todayMonth`, `isMonthKey`) |
| `heat.ts` | `heatLevel(total, capacity)` → 0–5, `heatThresholds`, `heatLegendLabels`, `DEFAULT_CAPACITY = 1000` |
| `use-viewport-rows.ts` | 7 rows at ≥ 1080 px tall, 6 at ≥ 840, else 5 (matchMedia) |
| `calendar.css` | `--fy-week-col` 128 → 144 px, `--fy-panel` 400 → 440 px, `--fy-interest` 30 → 36 px, `--fy-week-interest` 24 → 28 px at `min-width: 1920px`; the legend hatch swatch |
| `api.ts` | unchanged: `useCalendar(from, to)` (`["calendar", from, to]`, keepPreviousData), `usePrefetchCalendar`, `useDay(date)` |
| `components/calendar-toolbar.tsx` | `Today` · ‹ › · title (month/year picker popover) · ▲ ▼ · visible-weeks totals |
| `components/calendar-grid.tsx` | `role="grid"`: weekday header row + N `display: contents` rows of 7 `DayCell` + `WeekCell`; roving tabindex, keys, wheel |
| `components/day-cell.tsx` | the cell (anatomy below); `@container` for its own narrow mode |
| `components/week-cell.tsx` | week summary, no heat, background alternates by the week's month (its Thursday) |
| `components/split-caption.tsx` | `550 confirmed · 250 pending` / `550 · 250` with swatches; `mode="auto"` is a container query |
| `components/calendar-legend.tsx` | 28 px legend; its own `@container`, drops Today < 1020 px, Peak/Avoid < 900, the bar < 760 |
| `components/day-panel.tsx` | the non-modal side panel; also exports `DayFlags` (used by DayPage) |
| `pages/calendar/CalendarPage.tsx` | URL state, data, focus/window logic, shortcuts, the Add booking dialog |

Removed: `month-grid.tsx`, `month-nav.tsx` (only the old page used them).
Reused unchanged: `BookingFormDialog` (Bookings agent's; prefilled with the
date, navigates to the new booking), `CapacityBar` (`caption="none"`, the
caption is `SplitCaption` so it can be full ink), `StatusPill`/`StatusDot`,
`EmptyState`, `useShortcut`, `useSidebarCollapsed`.

## 2. Layout and sizing maths

The page is positioned under the header on its own
(`absolute inset-x-0 top-header bottom-0`, relative to `SidebarInset`), so
it fits the viewport without the route handle (see §7); flex column:
toolbar `h-11` (44) · weekday headers `h-6` (24) · grid (`flex-1`, 12 px
side padding, 6 px bottom) · legend `h-7` (28). Beside it the panel
(`w-(--fy-panel)`). Rows: `repeat(N, minmax(104px, 1fr))`, columns
`repeat(7, minmax(0, 1fr)) var(--fy-week-col)`, 6 px gaps. Structural
widths are px; type and the chrome heights are rem, so with the default
"Large" text size (root 17 px) the chrome is 1.0625× the numbers below.

| Viewport (root 17 px) | Rows | Day cell | With panel | Interest |
| --- | --- | --- | --- | --- |
| 1440×900, icon rail | 6 | 167 × 117 | 110 × 117 (narrow mode) | 31.9 px |
| 1920×1080, icon rail | 7 | 233 × 125 | 170 × 125 | 38.3 px |

Vertical budget (root 17): header 59.5 + toolbar 46.75 + headers 25.5 +
legend 29.75 + grid padding 6.4 + (N − 1) × 6.4 gaps + N × row. 7 rows need
≥ 1 040 px (so 1080), 6 rows ≥ 833 (so 840), 5 rows otherwise; the grid
itself scrolls (`overflow-y-auto`) rather than the page if a viewport is
shorter than that. Cell content (root 17): row 1 23.4 + number 31.9 + 4.25
+ bar 6 + 4.25 + caption 17 + padding 17 = 104 — exactly the minimum row.

**Narrow mode** (`@max-[125px]` of cell content = the panel open at 1440):
the group count stacks under a 24 px number (26 + 17 + bar block 31.5 +
row 1 23.4 + padding 17 = 115 ≤ 117) and a first-of-month cell drops its tag
("1 Dec" + "CLOSED" needs 100 px; the hatch, rule or dashes still carry the
day type). On a 5-row screen with the panel open (rows 104–116) the bottom
caption's descenders clip by a few px; the number, groups and bar stay.

**Caption words** (`SplitCaption` auto): `550 confirmed · 250 pending` from
200 px of content ("1 000 confirmed · 1 000 pending" at 12.75 px), i.e. the
233 px cells at 1920; 1440's 167 px cells show `550 · 250` with 6 px
swatches. The note's 168 px threshold assumed 12 px text and did not fit.

## 3. Cell anatomy (as built)

- Row 1 (22 px): day number 14/600 tabular; today = 22 px `bg-primary`
  disc with `text-primary-foreground`; "1 Dec" on the 1st. Right: one tag
  at most, priority OVER › CLOSED › PEAK › AVOID › holiday label: `OVER` is
  a 12 px pill `bg-red-solid text-on-solid` with a 3 px red top rule;
  CLOSED/PEAK/AVOID 12/500 uppercase tracked ink (muted on an empty cell);
  the holiday label 12/500 truncated with a `title`. Closed = `hatched`,
  peak = 2 px amber top rule (`before:`), avoid = dashed `border-strong`.
- Row 2: interest = `total_people` (confirmed + tentative) at
  `--fy-interest` /700 tabular, "9 grps" 12/500 on its baseline.
- Row 3: `CapacityBar` 6 px, no capacity → denominator = interest, always
  full; `SplitCaption` beneath.
- Empty open days: day number only. 0 people with a booking (bad data,
  3 Dec) shows "0 · 1 grp" honestly.
- Fill `bg-heat-N`, every text `text-heat-text` (full ink); captions differ
  by size and weight only. Selected = `border-primary ring-2
  ring-selection-ring`; focus = `outline-solid outline-2 outline-offset-2
  outline-ring` (Tailwind v4: `outline-hidden` sets
  `--tw-outline-style: none`, so a focus outline must also set
  `outline-solid`, or it computes to `none` — the first build's ring was
  invisible for this reason).
- No names anywhere in the grid.

## 4. Heat ramp (dataviz skill applied)

Five fixed bands of the capacity setting C (`GET /settings` →
`capacity.daily_warning_people`, 1 000 today): 1–9 % → 1, 10–24 % → 2,
25–49 % → 3, 50–74 % → 4, ≥ 75 % → 5; never month-relative. Managers cannot
read settings and get `DEFAULT_CAPACITY = 1000` (see §7). Legend: six
swatches `0 · <100 · 100 · 250 · 500 · 750+` scaled from C, then the bar,
Closed, Peak, Avoid, `Over 1 000`, Today.

Sequential-ramp validation (one hue, monotonic lightness, OKLab ΔL 0.06
per step, ink ≥ 4.5:1 on every step; the categorical CVD validator is not
the right check for a ramp, per the skill), gamut-mapped sRGB:

| Theme | Mode | heat-1 … heat-5 | ink contrast 1…5 |
| --- | --- | --- | --- |
| Graphite | light | `#f5ede6 #e7d7cb #d3bcab #b99f8b #9b806b` | 15.3 / 12.7 / 9.8 / 7.1 / 4.8 |
| Graphite | dark | `#302720 #42352b #554437 #685342 #7b6451` | 12.7 / 10.2 / 8.0 / 6.2 / 4.8 |
| Fynbos | light | `#f3eaff #e5d0ff #d0b1f5 #b691e1 #9970c4` | 15.2 / 12.5 / 9.5 / 6.9 / 4.6 |
| Fynbos | dark | `#2f223d #402e55 #533a6e #674689 #7955a0` | 12.8 / 10.4 / 8.3 / 6.5 / 5.0 |
| Indigo / Lagoon / Cocoa | both | pass | min 4.5 (Lagoon dark heat-5 4.55) |

## 5. Navigation, URL state, keys

- `?from=<Monday>` (absent = today's week in row 2, i.e.
  `mondayOf(today) − 7`; a non-Monday is snapped back); `?day=YYYY-MM-DD`
  opens the panel. Both `replace` the history entry.
- `‹ ›` → `monthStartWindow(anchorMonth ± 1)` (the Monday on or before the
  1st); `▲ ▼` and the wheel over the grid (50 px of deltaY, 180 ms lock)
  move one week; `Today` puts today's week in row 2 and focuses today.
  Title: the anchor month when the window starts a month ("December
  2026"), else the months with a full week in view ("Nov – Dec 2026",
  "Dec 2026 – Jan 2027"); click = month + year picker.
- Keys on a cell: ← → day, ↑ ↓ week, Home/End, PageUp/PageDown month,
  Enter/Space open; a target outside the window shifts it a week (or a
  month) and focus follows once the cell exists. Outside the grid
  (`useShortcut`): `T` today, PageUp/PageDown month, ← → month, ↑ ↓ week,
  Esc closes the panel (Radix dialogs/popovers consume their own Esc
  first). Out-of-month days are never dimmed.
- Totals (toolbar right): people, confirmed, groups over the visible weeks.
- Data: `GET /calendar?from&to` for the window; prefetch of `from ± 7` and
  the adjacent month windows; `keepPreviousData` so a week step keeps five
  rows and fills one.

## 6. Side panel and roles

400 / 440 px `aside`, no scrim, grid live beside it, clicking another day
swaps it (`key={date}`), Esc / × close. Date 18/600, relative day ("In 30
days"), `DayFlags` pills; interest 32/700 + "people" + "6 groups", 8 px
bar, `167 confirmed · 246 pending`; one 56 px row per group (`StatusDot`,
name 14/600, `arrives 10:00 · School · FY3713`, people 16/600 right,
admin-only `R 4 275 due` in `text-red-text` or "paid" from `GET
/days/:date`), sorted by arrival time then size; admin rows link to the
booking. Footer: Open day view (`/today/:date`), Add booking (admin, 44 px
buttons). Managers: same cells, panel without money and without the
booking links, no Add booking, `GET /days` not fetched.

## 7. Shared changes requested (not made — outside this agent's files)

1. **Router**: add `handle: { layout: "full" }` to `/calendar` as the
   foundation note anticipated; then `CalendarPage` can drop `absolute
   inset-x-0 top-header bottom-0` for `h-full` (it works either way).
2. **Calendar payload**: carry `capacity` (the warning threshold) in
   `GET /calendar` so managers get the real bands instead of
   `DEFAULT_CAPACITY`; the page reads
   `settings.capacity.daily_warning_people` when admin.
3. **CapacityBar**: a way to render its caption in full ink
   (`captionClassName` or an `ink` prop); the calendar wraps its own
   `SplitCaption` meanwhile. The `--color-red-500` alias can go.
4. **`text-label` + a colour through `cn()`**: tailwind-merge treats
   `text-label` as a colour and drops it next to `text-muted-foreground`
   (the tag rendered at 15 px until spelled out as `text-xs font-medium
   tracking-[0.04em]`). Worth a `twMerge` config (`extend: { classGroups:
   { "font-size": ["text-label", "text-display", …] } }`) in `lib/utils.ts`.
5. **Cheat sheet**: `KEYBOARD_MAP` already lists the calendar keys; add
   PageUp/PageDown (month) and Home/End if wanted. The page cannot pass
   `extra` because the sheet is mounted by the layout.
6. **Screenshot script**: adopt the script below as
   `frontend/scripts/shoot-calendar.py` next to `shoot-foundation.py`.

## 8. Screenshots (`data/screenshots/v2/p2-*.png`)

`p2-calendar-nov-{graphite-light,fynbos-dark}-{1440,1920}.png` (window from
26 Oct: 7 Nov 6 groups / 413 after the P5 test booking, 21 Nov 890, 5 Dec
OVER), `p2-calendar-dec-graphite-light-*` (December, peak days),
`p2-calendar-two-month-graphite-light-*` ("Nov – Dec 2026" from 16 Nov),
`p2-calendar-panel-7nov-{graphite-light,fynbos-dark}-*` (panel; 1440 shows
narrow mode), `p2-calendar-focus-graphite-light-*` (keyboard ring on 15
Nov), `p2-calendar-add-booking-graphite-light-*` (dialog prefilled),
`p2-calendar-month-picker-graphite-light-*`,
`p2-calendar-add-booking-{filled,created,after}-1440.png` (the end-to-end
creation of **TEST P2 calendar add booking**, booking 2272 / FY3715, 19 Nov,
12 people — left in place for the lead to delete).

## 9. Gaps and notes

- No manager screenshot: only the scratch admin was permitted; the manager
  path was verified by reading (`isAdmin` gates money, links, Add booking,
  the `/days` fetch and the settings read).
- Toolbar buttons are the standard 36 px (`size="icon"`, default); the
  44 px targets are the cells and the panel's rows and footer buttons.
- Typecheck/lint: zero findings in calendar files; at handoff `tsc` fails
  only in the Bookings and Public agents' in-progress files.
- The scratch admin `test-p2@example.com` was deleted after the run.

<details>
<summary>shoot-calendar.py</summary>

```python
"""Screenshot and measure the v2 calendar: p2-*.png into data/screenshots/v2."""
from __future__ import annotations
import argparse, sys
from pathlib import Path
from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "screenshots" / "v2"
EMAIL, PASSWORD = "research@example.com", "research-viewer-pw-1"   # any admin
VIEWPORTS = {"1440": (1440, 900), "1920": (1920, 1080)}
MEASURE = """() => { const de = document.documentElement;
  return { scrollHeight: de.scrollHeight, clientHeight: de.clientHeight, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth }; }"""

def login(page: Page, base: str) -> None:
    page.goto(f"{base}/login", wait_until="networkidle")
    page.fill("input[name=email]", EMAIL); page.fill("input[name=password]", PASSWORD)
    page.click("button[type=submit]"); page.wait_for_url("**/today**"); page.wait_for_load_state("networkidle")

def set_appearance(page: Page, base: str, theme: str, mode: str, text_size: str = "Large") -> None:
    page.goto(f"{base}/settings/appearance", wait_until="networkidle")
    page.click(f'button[role=radio][aria-label^="{theme}"]')
    page.locator("[role=radiogroup][aria-label=Mode] button[role=radio]", has_text=mode).first.click()
    page.locator('[role=radiogroup][aria-label="Text size"] button[role=radio]', has_text=text_size).first.click()
    page.wait_for_timeout(700)

def shot(page: Page, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(OUT / f"p2-{name}.png"))
    m = page.evaluate(MEASURE)
    ok = m["scrollHeight"] == m["clientHeight"] and m["scrollWidth"] <= m["clientWidth"]
    print("OK " if ok else "SCROLL", name, m)

def calendar(page: Page, base: str, query: str) -> None:
    page.goto(f"{base}/calendar?{query}", wait_until="networkidle")
    page.wait_for_selector("[role=gridcell][data-date]"); page.wait_for_timeout(500)

def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--base", default="http://127.0.0.1:5312")
    base = parser.parse_args().base.rstrip("/")
    themes = {"graphite-light": ("Graphite", "Light"), "fynbos-dark": ("Fynbos", "Dark")}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for label, (w, h) in VIEWPORTS.items():
            context = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            page = context.new_page(); page.set_default_timeout(20000); login(page, base)
            for slug, (theme, mode) in themes.items():
                set_appearance(page, base, theme, mode)
                calendar(page, base, "from=2026-10-26"); shot(page, f"calendar-nov-{slug}-{label}")
                if slug == "graphite-light":
                    calendar(page, base, "from=2026-11-30"); shot(page, f"calendar-dec-{slug}-{label}")
                    calendar(page, base, "from=2026-11-16"); shot(page, f"calendar-two-month-{slug}-{label}")
                calendar(page, base, "from=2026-10-26&day=2026-11-07"); page.wait_for_timeout(600)
                shot(page, f"calendar-panel-7nov-{slug}-{label}")
                if slug == "graphite-light":
                    page.focus('[role=gridcell][data-date="2026-11-07"]')
                    page.keyboard.press("ArrowRight"); page.keyboard.press("ArrowDown"); page.wait_for_timeout(300)
                    shot(page, f"calendar-focus-{slug}-{label}")
                    page.keyboard.press("Enter"); page.wait_for_timeout(500)
                    page.get_by_role("button", name="Add booking").click(); page.wait_for_selector("[role=dialog]"); page.wait_for_timeout(500)
                    shot(page, f"calendar-add-booking-{slug}-{label}"); page.keyboard.press("Escape"); page.wait_for_timeout(300)
                    calendar(page, base, "from=2026-10-26")
                    page.get_by_role("button", name="Choose a month").click(); page.wait_for_timeout(300)
                    shot(page, f"calendar-month-picker-{slug}-{label}"); page.keyboard.press("Escape")
            set_appearance(page, base, "Graphite", "Match system", "Large"); context.close()
        browser.close()
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

</details>
