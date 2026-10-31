# 08 · Contrast, elevation and data tables

Why: the owner's first-use note on both builds was that "everything blends
together unless you squint". This note fixes the rules; the tokens in
`frontend/src/styles/tokens.css` and the DataTable implement them.

## Separation: three surfaces, one border, one shadow

Interfaces read as layers when there are exactly three surface levels and
every boundary is drawn twice, by a border and by a small shadow (Material 3
elevation; Apple HIG "Materials"; Refactoring UI, "Use shadows to convey
elevation"):

| Level | Use | Light | Dark |
| --- | --- | --- | --- |
| Canvas | the page | L 0.975 (was 0.985) | L 0.19 |
| Card | panels, tables | white, 1 px border L 0.82 (was 0.86), shadow 0 1px 2px 7% + 0 2px 6px 8% | L 0.25, border 18% (was 14%), shadow 0 1px 2px 35% |
| Nested | table head, striped rows, insets | L 0.955 | L 0.28 |

Rules: a card never sits directly on another card without the nested
surface between; the sidebar is darker than the canvas; borders never
disappear in dark mode (18% white minimum); the shadow is always the same
two-layer pair, so elevation is uniform.

## Text contrast

Body text at L 0.21 on white gives 14:1; secondary text was L 0.47 (5.4:1),
now L 0.42 (6.5:1) so "muted" is still legible at 14 px (WCAG AA for small
text is 4.5:1; AAA is 7:1). Faint text (placeholders, disabled) stays at
L 0.62 and is never used for data.

## Data tables (not walls of text)

From the Carbon, Ant and Atlassian table guidelines and Refactoring UI:

- **Zebra rows** at a 50 % nested tint, plus a stronger hover; a selected row
  uses the accent-tinted row colour.
- **Header on the nested surface**, 12 px uppercase labels, sticky.
- **One primary cell per row** (the reference) in 15 px semibold foreground;
  everything else 14–15 px regular; secondary lines 13 px muted.
- **Numbers right-aligned in tabular figures**, money with a thin space
  thousand separator; text left-aligned; never centre data.
- **Row height 48 px for two-line rows**, 44 px single; density toggle for
  compact 36 px.
- **Status as a pill, action as text**: a pill carries meaning by colour; the
  latest action is plain text with its date under it in muted.
- **No horizontal squash**: the table uses the page width; the page has a
  24 px gutter and no maximum width on list screens.
- **At most nine columns**; a bucket may add one contextual column.

## Applied here

Tokens: `--background`, `--card`, `--surface-nested`, `--border`,
`--border-strong`, `--muted-foreground`, `--shadow-card`. Components: Card
gets the card shadow; DataTable gets `striped`, the nested header and the
hover; the layout drops the 1600 px cap.
