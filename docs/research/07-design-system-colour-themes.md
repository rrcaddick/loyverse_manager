# 07 — Design system: colour as meaning, curated themes, type and density

## Who and what for

One operator, in the app all day, on a 1440- or 1920-wide monitor at arm's
length; not a software person, will not read a guide. The screen must say
what state things are in, what is money in versus owed, and what to do
next, without her leaning in. The owner wants a serious business tool. The
monochrome logo is a gift: no brand colour to protect, so every hue can be
spent on meaning and the "feel" left to a theme the operator picks.

## What the best products do

**Linear** offers light/dark, presets, and a custom theme built from a few
inputs — "background, text and accent colors, which we then use to generate
complimentary shades for borders and elevated boxes" — shared as a one-line
string; linear.style hosts 70+. It lives under Account › Preferences ›
"Interface and theme", beside a font-size setting. ([changelog](https://linear.app/changelog/2020-12-04-themes),
[preferences](https://linear.app/docs/account-preferences)) A theme is three
decisions, not thirty.

**GitHub / Primer** ships nine curated themes (light, light high contrast,
colourblind, tritanopia; dark, dark dimmed, dark high contrast…), chosen
under Settings › Appearance as a single theme or a system-synced day/night
pair. High-contrast themes target 7:1 and add borders. Roles are `accent`, `success`, `attention`, `danger`,
`open/closed/done`. ([docs](https://docs.github.com/en/get-started/accessibility/managing-your-theme-settings),
[Primer](https://primer.style/foundations/color/overview))

**The named-list pattern** is everywhere: Todoist has eight named themes
with a "Sync Theme" toggle and auto dark ([help](https://todoist.com/help/articles/205169851));
Bear has three free and 30-odd Pro themes borrowed from editor palettes
([faq](https://bear.app/faq/about-free-and-pro-themes-in-bear/)); Things is
Light/Dark/Black with one blue accent ([blog](https://culturedcode.com/things/blog/2018/12/dark-mode-for-ios/));
Notion is Light/Dark/System per account ([help](https://www.notion.com/help/appearance-settings));
Microsoft 365 is Colorful/Dark Gray/Black/White/System ([support](https://support.microsoft.com/en-us/office/change-the-look-and-feel-of-microsoft-365-63e65e1c-08d4-4dea-820e-335f54672310));
Obsidian adds an accent picker and a font-size slider ([help](https://obsidian.md/help/appearance));
Slack has six presets plus colour-vision themes and a per-element picker
([help](https://slack.com/help/articles/205166337-Change-your-Slack-theme)).
The named list with previews is the product; a free picker is an escape
hatch.

**Shopify Polaris** gives colour roles hard rules: success "to tell
merchants that everything is OK", warning "for elements that require
merchant intervention", critical "when the UI calls for immediate action",
caution for "stalled or not started", info for tips only; brand must not be
"applied to several elements in one area". Fills go on "smaller surface
areas", never whole backgrounds. ([roles](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/design/colors/palettes-and-roles.mdx),
[using colour](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/design/colors/using-color.mdx))
**Stripe** badges: neutral / info / positive / negative / warning ("needs
immediate action, optional") / urgent ("strong requirement to resolve").
([badge](https://docs.stripe.com/stripe-apps/components/badge))
**Atlassian** lozenges: default, inprogress, moved ("changed and require
attention"), new, removed ("critical"), success, each bold or subtle.
([lozenge](https://developer.atlassian.com/platform/forge/ui-kit/components/lozenge/))
**Material 3** maps roles to tones: primary 40 light / 80 dark, primary
container 90/30, surface 98/6, five surface-container tiers 96→90, and an
outline-variant for edges that need no 3:1. ([tones](https://github.com/material-components/material-components-android/blob/master/docs/theming/Color.md),
[roles](https://api.flutter.dev/flutter/material/ColorScheme-class.html))

**Type and density.** Carbon's productive set is a 14 px base (body-01
14/20, label-01 12/16, heading-04 28/36, display 54+), table rows
24/32/40/48/64 px, spacing 2-4-8-12-16-24-32-40-48.
([type](https://carbondesignsystem.com/guidelines/typography/type-sets/),
[table](https://carbondesignsystem.com/components/data-table/style/),
[spacing](https://carbondesignsystem.com/guidelines/spacing/overview/))
Apple's macOS body is 13 pt, minimum 10, "avoid light font weights"
([HIG](https://developer.apple.com/design/human-interface-guidelines/typography));
Material body-medium 14/20, label-small 11/16, display-small 36/44
([TextTheme](https://api.flutter.dev/flutter/material/TextTheme-class.html));
Atlassian's smallest token is 12 px, "avoided except for fine print"
([typography](https://atlassian.design/foundations/typography-beta)).
Butterick: 45–90 characters a line ([line length](https://practicaltypography.com/line-length.html)).

**Palette construction.** Radix scales have 12 steps with fixed jobs (1–2
backgrounds, 3–5 component states, 6–8 borders, 9–10 solids, 11–12 text;
11/12 guaranteed APCA Lc 60/90 on step 2). ([Radix](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale))
WCAG 2.2: 4.5:1 text, 3:1 large text (24 px / 18.7 px bold) and 3:1 for UI
boundaries and states. ([1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
[1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html))
APCA: Lc 90 body, 75 minimum for columns, 60 other content, 30
placeholders, 15 dividers; WCAG 2 "overstates contrast for dark colors". ([APCA](https://github.com/Myndex/SAPC-APCA/blob/master/documentation/APCA_in_a_Nutshell.md))
OKLCH makes multi-theme palettes feasible: fixed L gives the same perceived
lightness at any hue, so swap H and keep contrast — then check with APCA. ([Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl))
Tailwind v4 is oklch-native; custom colours are `--color-*` in `@theme`.
([Tailwind](https://tailwindcss.com/docs/colors))

## Principles that transfer

1. **Hue means one thing.** Green = done/paid, amber = waiting on someone,
   red = wrong/overdue, blue = information, grey = not started. The accent
   means "interactive/selected" and nothing else; no theme may put the
   accent on a semantic hue.
2. **Themes change feel, never meaning.** Semantic colours are identical in
   every theme; only accent and surface tint move.
3. **Fills on small things** — pills, dots, left bars, counters — never a
   tinted card behind a paragraph.
4. **Same L, same contrast.** Build each theme by substituting H at fixed
   L/C, verify with APCA; dark is its own tone mapping (40/80, 90/30), not an
   inversion.
5. **One base size, one knob.** Everything in rem; a text-size setting scales
   all of it (Linear, Obsidian).
6. **Curated list, previews, day/night pair.** No free picker.
7. **Numbers are a type style**: tabular (`font-variant-numeric:
   tabular-nums`, [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric)),
   big, labelled.

## Critique of our current design

Screenshots: `data/screenshots/research/ds-{queue,calendar,bookings,settings}-{light,dark}.png`.

- **Contrast.** Text passes (ink-600 on paper 6.4:1; amber pill 6.5:1,
  green 7.8:1). The *structure* does not: card vs canvas 1.06:1, sidebar vs
  canvas 1.06:1, dark card vs canvas 1.09:1, hairline border 1.29:1 — all
  below APCA Lc 15, so the eye has no edges (`ds-queue-light.png`,
  `ds-settings-dark.png`). `--heat-4` with white text is 3.4:1, below AA for
  the 13 px calendar text.
- **Hierarchy.** In `ds-queue-light.png` the KPI tiles, section header,
  booking rows and quoted email are the same ink on the same paper: "15" is
  20 px, the email preview 13 px. Section headers are bold text with no
  rule, icon or colour.
- **Size.** Base 14 px, secondary 13, labels 12, in a frame that is 60 %
  empty (`ds-settings-light.png`: 13 px fields in a 1024 px column). Page
  title 24 px, hero number 20 px: Apple's 13-pt minimum used for everything.
- **Use of colour.** Two hues in the queue: amber pills and one green
  button. "Needs a reply", the most urgent section, has none; "waiting 86
  days" is the same amber as "Proforma sent". In `ds-bookings-light.png`
  paid deposits go green, but balances owed and "Hold expires in 1 day" are
  plain ink. The oak accent shares hue 150 with success, so "Add booking"
  and "Confirmed" read as one signal (`ds-calendar-light.png`).
- **Density.** The bookings table is well judged (53 px rows, two-line
  cells, tabular money). The calendar is not: "Closed" thirty times at 12 px
  grey carries nothing. The queue nests section › booking › email in one
  surface with uniform gaps.

## Recommendation for ours

### (a) Semantic colour model

Fixed in every theme; only L/C shift for dark. Light values are nearest
sRGB hex from oklch; ratios measured on paper `#fbfaf7`.

| Meaning | Hue | Text / soft fill / solid (light) | Rule |
| --- | --- | --- | --- |
| Done, paid, confirmed, matched | green 150 | `#115629` / `#d1f2d7` / `#1d6835` (7.3:1) | Only a state that needs nothing from anyone. |
| Waiting on the customer: proforma sent, deposit due soon, hold expiring, unmatched credit | amber 70–85 | `#6f4100` / `#ffe8b6` / `#9d6300` (7.2:1) | Needs someone's action, not now; never "new". |
| Wrong or overdue: cancelled, no-show, hold expired, balance overdue, errors, destructive | red 25 | `#901114` / `#ffe2de` / `#c22826` (7.5:1) | Always with an icon or word; red alone is never the message. |
| Information: incoming email, note, "today" | blue 245 | `#005184` / `#d9eeff` / `#0068a7` (7.0:1) | Never actionable; never a button. |
| Not started: enquiry, lapsed, ignored, closed days | grey | `#423c37` / `#eae7e3` / `#5f5a54` (8.9:1) | Default for "no state". |
| Interactive, selected, nav, links, primary button, focus | **theme accent** | per theme | The only hue that changes. |

Status map: enquiry grey · proforma_sent amber · confirmed green ·
completed green-subtle (tick, no fill) · cancelled red · lapsed / no_show
grey with red text. Money: credits in = green `+`; deposit owed = ink;
overdue = red + clock icon; refunds = ink `−`; never colour a whole column.
Direction: incoming email = blue dot + "From"; outgoing = grey arrow;
unanswered > 2 days = amber bar on the row's left edge. Selection: 2 px
accent ring, accent-tinted row at L 0.93. Calendar: closed days hatched and
empty; the capacity ramp uses the *accent* at tones 95/90/80/60/40, text
white at 60 and below.

Dark (all ≥ 7.9:1 on their fills): green `#9ee1ab`/`#1a3520`, amber
`#fcd176`/`#442e09`, red `#febab4`/`#551f1d`, blue `#a8d3f9`/`#193348`, grey
`#d4d0cb`/`#332f2c`.

### (b) Six curated themes

Theme = accent hue+chroma, surface hue+chroma, contrast level. Neutral L
values are shared (paper 0.985 / card 0.995 / sidebar 0.955; dark 0.20 /
0.235 / 0.17), so one semantic set passes everywhere. Measured: every
accent ≥ 6.2:1 with white text in light, ≥ 7.8:1 with dark text in dark.

| Theme | Character | Accent light / dark | Surface tint |
| --- | --- | --- | --- |
| **Graphite** (default) | The logo: ink buttons, warm paper, all colour is meaning. Most "enterprise". | `oklch(0.25 0.012 60)` `#26201c` / `oklch(0.92 0.008 80)` `#e7e4df` | warm, hue 85 (`#fbfaf7`) |
| **Fynbos** | Heather purple on lilac greys; closest to Linear. | `oklch(0.48 0.17 305)` `#753ba8` / `oklch(0.76 0.13 305)` `#c49bf3` | lilac, hue 300 (`#faf9fc`) |
| **Indigo** | Classic blue admin (Atlassian/Stripe), slate greys. | `oklch(0.47 0.17 265)` `#2a51b8` / `oklch(0.74 0.13 265)` `#82a8fd` | slate, hue 250 (`#f8fafd`) |
| **Lagoon** | Teal on clean neutral greys; calm, modern. | `oklch(0.47 0.09 195)` `#006a6a` / `oklch(0.76 0.10 195)` `#57c5c5` | neutral (`#fafafa`) |
| **Cocoa** | Farm brown on cream; warmest, lowest chroma. | `oklch(0.40 0.07 55)` `#643d20` / `oklch(0.78 0.07 60)` `#d9ad8a` | warm, hue 85 |
| **High contrast** | Pure white/black, ink accent, borders at L 0.75, text ≥ 7:1, pills outlined (GitHub model). | `#030303` / `#ffffff` | none |

Excluded on purpose: green accents (collide with "confirmed"), orange
(amber), and magenta at 350 (6.4:1 but only 37° from red; a later "Protea"
if asked). Teal sits 45° from green and 50° from blue at lower chroma.

### (c) Theme selector UX

Settings › **Appearance** (personal section, also in the user menu). Three
rows: *Theme* — six 160×100 preview tiles each showing sidebar, a card, a
green and an amber pill and the primary button in that theme, the chosen
tile outlined in its accent; *Mode* — Light / Dark / Match system (day and
night pair when "system"); *Text size* — Default / Large / Extra large.
Persist per user on the server (`users.preferences` JSON `{theme, mode,
text_size}`), mirrored to `localStorage["fy.theme"]` for the pre-paint apply
in `index.html`. Apply as `data-theme="fynbos"` plus `.dark` on `<html>`;
`tokens.css` gains one block per theme overriding only `--accent-*` and the
surface hue. Default: Graphite, Match system, Large.

### (d) Type scale and spacing

Root 16 px; sizes in rem so the text-size setting (16 → 17 → 18 px root)
scales everything. Inter at 400/500/600 only; `tnum` on all numbers.

| Role | Size / line | Weight | Use |
| --- | --- | --- | --- |
| Display number | 36 / 40 px | 600, tabular | KPI tiles, week totals, balance on a booking |
| Page title | 28 / 34 | 600 | one per page |
| Section title | 18 / 26 | 600 | card headers, with icon |
| Body / cells | **15 / 22** | 400 | tables, forms, previews (Carbon productive is 14; one step up for the craning problem) |
| Secondary | 14 / 20 | 400, muted | second line in a cell, help text |
| Label / caption | 12 / 16 | 500, +0.04 em | column headers, eyebrows; never below 12 |
| Button | 15 / 20 | 500 | |

Measure: prose and emails capped at 68 ch (`max-width: 42rem`); page
content capped at 1600 px on 1920 displays. Spacing 4-8-12-16-24-32-48-64:
card padding 20, card gap 24, page gutter 32, field gap 16. Tables: 44 px
rows (48 two-line), 12 px cell padding, 40 px sticky header with 12 px
labels, right-aligned tabular numbers, a Compact toggle at 36 px. Queue
lists: 56 px rows, primary action as a button, excerpts two lines max.

### (e) Iconography and visual distinctness

- **Three visible surface tiers**: canvas L 0.985; card L 0.995 with a 1 px
  border at L 0.86 (not 0.89); nested panels at L 0.965; sidebar L 0.94.
  Dark: 0.20 / 0.245 / 0.27, borders at 14 % white.
- **Section headers** get a 20 px lucide icon in the section's semantic
  colour, a count pill and a 1 px rule; urgent sections ("Needs a reply")
  get a 3 px amber bar on the card's left edge.
- **Badges**: dot + text, 13 px, 22 px tall, 1 px ring so they survive on
  any surface; bold (solid fill, white text) only for red/urgent.
- **Rows needing attention** carry a left edge bar, never a tinted fill.
- **Money** always tabular `R 3 800` with sign; colour only when the state
  deviates (paid green, overdue red).
- **Icons** 16 px inline, 20 px in nav and headers, always with text; one
  icon per concept.
- **Calendar**: closed days hatched and empty; open days show the number
  only; booked days show the accent capacity bar and a 15 px tabular count.

### (f) Settings page structure

Replace the tab strip with a **left rail inside Settings** (GitHub, Linear),
grouped: *Park* — Season, Pricing & deposits; *Documents & mail* —
Documents, Email, Reminders; *Public* — Booking form; *Personal* —
Appearance, Password; *Admin* — Users, Ops. Each page uses Polaris's
two-column layout: heading and one-sentence explanation left (max 40 ch),
the card of fields right; help text under the field, never in placeholders;
live computed examples. Save is explicit: the sticky SaveBar reading
"Unsaved changes · Discard · Save" (Shopify's contextual save bar; Stripe's
SettingsView likewise renders its own Save and a "Saved" status).
Appearance saves on click with no bar: the change is its own preview.

## Sources

Linear: [themes changelog](https://linear.app/changelog/2020-12-04-themes), [account preferences](https://linear.app/docs/account-preferences), [settings redesign](https://linear.app/changelog/2024-12-18-personalized-sidebar), [linear.style](https://linear.style/) ·
GitHub: [theme settings](https://docs.github.com/en/get-started/accessibility/managing-your-theme-settings), [Primer colour](https://primer.style/foundations/color/overview) ·
Todoist: [colour themes](https://todoist.com/help/articles/205169851) · Bear: [themes](https://bear.app/faq/about-free-and-pro-themes-in-bear/) · Things: [dark mode](https://culturedcode.com/things/blog/2018/12/dark-mode-for-ios/) · Notion: [appearance](https://www.notion.com/help/appearance-settings) · Microsoft 365: [Office theme](https://support.microsoft.com/en-us/office/change-the-look-and-feel-of-microsoft-365-63e65e1c-08d4-4dea-820e-335f54672310) · Obsidian: [appearance](https://obsidian.md/help/appearance) · Slack: [themes](https://slack.com/help/articles/205166337-Change-your-Slack-theme) ·
Polaris: [palettes and roles](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/design/colors/palettes-and-roles.mdx), [using colour](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/design/colors/using-color.mdx), [contextual save bar](https://shopify.dev/docs/api/app-bridge/previous-versions/actions/contextualsavebar) ·
Stripe: [badge](https://docs.stripe.com/stripe-apps/components/badge), [SettingsView](https://docs.stripe.com/stripe-apps/components/settingsview), [dashboard settings](https://docs.stripe.com/dashboard) ·
Atlassian: [lozenge](https://developer.atlassian.com/platform/forge/ui-kit/components/lozenge/), [typography](https://atlassian.design/foundations/typography-beta) ·
Material 3: [colour tones](https://github.com/material-components/material-components-android/blob/master/docs/theming/Color.md), [ColorScheme](https://api.flutter.dev/flutter/material/ColorScheme-class.html), [TextTheme](https://api.flutter.dev/flutter/material/TextTheme-class.html) ·
Carbon: [type sets](https://carbondesignsystem.com/guidelines/typography/type-sets/), [data table](https://carbondesignsystem.com/components/data-table/style/), [spacing](https://carbondesignsystem.com/guidelines/spacing/overview/) ·
Apple: [HIG typography](https://developer.apple.com/design/human-interface-guidelines/typography) ·
Accessibility: [WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [1.4.8](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html), [APCA](https://github.com/Myndex/SAPC-APCA/blob/master/documentation/APCA_in_a_Nutshell.md), [Radix scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) ·
Colour maths: [OKLCH in CSS](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl), [Tailwind colours](https://tailwindcss.com/docs/colors), [font-variant-numeric](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric), [line length](https://practicaltypography.com/line-length.html).

Contrast figures were computed from the oklch values with a WCAG 2 script;
a few soft fills sit a hair outside sRGB and will be gamut-mapped — confirm
in a picker before committing to `tokens.css`.
