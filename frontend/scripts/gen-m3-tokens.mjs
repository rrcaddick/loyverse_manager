#!/usr/bin/env node
/**
 * Generate src/styles/tokens.css from Material 3 colour schemes.
 *
 *   node scripts/gen-m3-tokens.mjs            # writes the file
 *   node scripts/gen-m3-tokens.mjs --print    # prints instead
 *
 * One seed per theme → Google's dynamic-colour schemes (primary, secondary,
 * tertiary, error, neutral, neutral-variant) → the app's existing token
 * names, so no component has to change its class names. The mapping is the
 * Material 3 role system (docs/research/09-material-colour.md):
 *
 *   light   sidebar neutral 22 (dark column) · canvas 90 · table head 80 · zebra 94 · card 100
 *   dark    sidebar primary 20 · canvas 8 · card 22 · zebra 27 · table head 32
 *   (calibration sheet ladder D: every region seen at once is ≥ 10 tones from the others)
 *   text              on-surface (10 / 90); secondary on-surface-variant (30 / 80); faint outline (50 / 60)
 *   borders           outline-variant (80 / 30); strong outline (50 / 60)
 *   primary           primary / on-primary; soft = primary-container
 *   selected, active  secondary-container / on-secondary-container
 *   hover, focus      state layers: on-surface at 8 % / 12 %
 *   semantic hues     fixed tonal palettes (green 145, amber 75, red 25, blue 250, grey = neutral-variant)
 *   heat ramp         amber palette tones 95…60 (light) / 25…45 (dark), ink text
 *
 * The theme blocks are emitted per [data-theme] and [data-theme].dark with
 * literal values so an element carrying data-theme renders the whole set
 * (the Appearance page previews rely on that).
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  Blend,
  Hct,
  MaterialDynamicColors,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeVibrant,
  TonalPalette,
  argbFromHex,
  hexFromArgb,
} from "@material/material-color-utilities";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "../src/styles/tokens.css");

// Each theme is ONE seed: its primary colour. Secondary, tertiary (the accent),
// error, the neutrals and every container come from Material's own scheme for
// that seed. No hand-picked hues. Vibrant keeps the chroma the owner wants;
// Neutral is the ink-and-paper default; Monochrome at contrast 1.0 is the
// high-contrast theme.
const THEMES = [
  { id: "graphite", seed: "#605b53", scheme: SchemeNeutral, contrast: 0.0, isDefault: true },
  { id: "fynbos", seed: "#8a3fa6", scheme: SchemeVibrant, contrast: 0.0 },
  { id: "indigo", seed: "#4f55d9", scheme: SchemeVibrant, contrast: 0.0 },
  { id: "lagoon", seed: "#15808f", scheme: SchemeVibrant, contrast: 0.0 },
  { id: "cocoa", seed: "#7d5536", scheme: SchemeVibrant, contrast: 0.0 },
  { id: "contrast", seed: "#303030", scheme: SchemeMonochrome, contrast: 1.0, highContrast: true },
];

const ROLES = [
  "surface", "surfaceDim", "surfaceBright", "surfaceContainerLowest", "surfaceContainerLow", "surfaceContainer",
  "surfaceContainerHigh", "surfaceContainerHighest", "onSurface", "onSurfaceVariant", "outline", "outlineVariant",
  "primary", "onPrimary", "primaryContainer", "onPrimaryContainer", "secondary", "onSecondary", "secondaryContainer",
  "onSecondaryContainer", "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer", "error", "onError",
  "errorContainer", "onErrorContainer", "inverseSurface", "inverseOnSurface", "inversePrimary", "primaryFixedDim", "onPrimaryFixed", "surfaceTint",
];

// Custom colours (meaning): green, amber, blue, plus the heat ramp. Material's
// rule for a custom colour is to harmonise it toward the seed, then build its
// tonal palette; red is the scheme's own error role.
const SEMANTIC_SEEDS = { green: "#2e7d32", amber: "#e08a00", blue: "#1e63b5" };
const HEAT_SEED = "#e08a00";
function harmonised(hex, seedHex) {
  return TonalPalette.fromInt(Blend.harmonize(argbFromHex(hex), argbFromHex(seedHex)));
}

function roles(theme, isDark) {
  const scheme = new theme.scheme(Hct.fromInt(argbFromHex(theme.seed)), isDark, theme.contrast);
  const out = {};
  const missing = [];
  for (const role of ROLES) {
    const dc = MaterialDynamicColors[role];
    if (!dc) {
      missing.push(role);
      continue;
    }
    out[role] = hexFromArgb(dc.getArgb(scheme));
  }
  if (missing.length) throw new Error(`Missing Material roles: ${missing.join(", ")}`);
  out.primaryTone = (t) => hexFromArgb(scheme.primaryPalette.tone(t));
  out.tertiaryTone = (t) => hexFromArgb(scheme.tertiaryPalette.tone(t));
  out.errorTone = (t) => hexFromArgb(scheme.errorPalette.tone(t));
  out.primaryHue = scheme.primaryPalette.hue;
  out.neutralTone = (t) => hexFromArgb(scheme.neutralPalette.tone(t));
  out.neutralVariantTone = (t) => hexFromArgb(scheme.neutralVariantPalette.tone(t));
  return out;
}

const tone = (palette, t) => hexFromArgb(palette.tone(t));

function tokens(theme, isDark) {
  const r = roles(theme, isDark);
  const hc = !!theme.highContrast;
  const L = !isDark;
  const N = (tn) => r.neutralTone(tn);
  const NV = (tn) => r.neutralVariantTone(tn);
  const P = (tn) => r.primaryTone(tn);

  // Meaning colours: Material custom colours harmonised to this theme's seed.
  const sem = {};
  for (const [name, hex] of Object.entries(SEMANTIC_SEEDS)) {
    const pal = harmonised(hex, theme.seed);
    sem[`${name}-text`] = tone(pal, L ? 30 : 80);     // on-container role, used as text on surfaces
    sem[`${name}-soft`] = tone(pal, L ? 90 : 30);     // container
    sem[`${name}-solid`] = tone(pal, L ? 40 : 40);    // the colour itself (white text on it)
  }
  sem["red-text"] = r.errorTone(L ? 30 : 85);
  sem["red-soft"] = hc ? N(L ? 96 : 20) : r.errorContainer;
  sem["red-solid"] = r.errorTone(40);
  const grey = { "grey-text": NV(L ? 30 : 80), "grey-soft": NV(L ? 90 : 30), "grey-solid": NV(45) };
  const HEAT = harmonised(HEAT_SEED, theme.seed);

  // Surfaces: the owner's banded ladder (calibration sheet, D), drawn from the
  // scheme's neutral palette. Light: canvas 90, card 100, zebra 88, table
  // head = primary. Dark: canvas 8, card 22, zebra 32.
  const canvas = N(L ? 90 : 8);
  const card = N(L ? 100 : 22);
  const nested = N(L ? 88 : 32);
  const high = N(L ? 70 : 46);
  const highest = N(L ? 64 : 52);
  // Navigation: inverse surface in light (Material's role for a dark panel on a
  // light theme); the primary container in dark (a tinted panel).
  const sidebar = hc ? N(L ? 12 : 22) : L ? r.inverseSurface : r.primaryContainer;
  const sidebarText = hc ? N(L ? 100 : 98) : L ? r.inverseOnSurface : r.onPrimaryContainer;
  const sidebarMuted = hc ? N(L ? 85 : 85) : L ? N(80) : P(80);
  const sidebarHover = hc ? N(L ? 25 : 22) : L ? N(30) : P(35);
  const sidebarBorder = hc ? N(L ? 40 : 40) : L ? N(32) : P(40);
  const sidebarActive = hc ? N(L ? 100 : 95) : L ? r.inversePrimary : r.primary;
  const sidebarActiveText = hc ? N(L ? 0 : 5) : L ? P(20) : r.onPrimary;
  const popover = N(L ? 100 : 32);
  const border = hc ? r.outline : r.outlineVariant;
  const borderStrong = r.outline;
  const text = r.onSurface;
  const muted = r.onSurfaceVariant;
  const faint = r.outline;

  // Primary and its on-colour exactly as the scheme gives them.
  const primary = r.primary;
  const onPrimary = r.onPrimary;
  const primaryHover = P(L ? 30 : 85);
  // Selected rows: the primary container (an emphasised container role), which
  // keeps a visible tint next to the zebra row; chips keep secondary-container.
  // inverse-primary (tone 80 light / 40 dark) keeps a clear step from the zebra row.
  // Light: inverse-primary (tone 80). Dark: primary-fixed-dim (tone 80, a fixed
  // role) so the selected row is unmistakable against the tinted hover at ~40.
  // Light: inverse-primary (tone 80, dark text). Dark: the primary container
  // (tone 30); the row also carries a primary edge bar so it never relies on
  // the tint alone.
  const selected = hc ? N(L ? 80 : 42) : L ? r.inversePrimary : r.primaryContainer;

  const shadowLevel = (n) =>
    L
      ? {
          1: "0 1px 2px rgb(0 0 0 / 0.12), 0 4px 12px -2px rgb(0 0 0 / 0.18)",
          2: "0 2px 4px rgb(0 0 0 / 0.14), 0 8px 20px -6px rgb(0 0 0 / 0.24)",
          3: "0 8px 16px -4px rgb(0 0 0 / 0.22), 0 20px 48px -12px rgb(0 0 0 / 0.32)",
        }[n]
      : {
          1: "inset 0 1px 0 rgb(255 255 255 / 0.12), 0 0 0 1px rgb(255 255 255 / 0.05), 0 4px 12px rgb(255 255 255 / 0.05)",
          2: "inset 0 1px 0 rgb(255 255 255 / 0.14), 0 0 0 1px rgb(255 255 255 / 0.06), 0 6px 18px rgb(255 255 255 / 0.07)",
          3: "inset 0 1px 0 rgb(255 255 255 / 0.18), 0 0 0 1px rgb(255 255 255 / 0.08), 0 12px 32px rgb(255 255 255 / 0.10)",
        }[n];
  const control = L ? r.surfaceContainerLowest : N(30);
  const controlHover = L ? r.surfaceContainerLow : N(35);
  const controlBorder = r.outline;

  // Badges and dots: the tertiary role, Material's accent. On a light surface
  // the tertiary itself (40, white text); on a dark surface its container in
  // light mode (90, dark text) and the tertiary in dark mode (80, dark text).
  const badgeOnLight = hc ? { bg: N(10), fg: N(100) } : { bg: r.tertiaryTone(40), fg: r.tertiaryTone(100) };
  const badgeOnDark = hc ? { bg: N(100), fg: N(0) } : L ? { bg: r.tertiaryContainer, fg: r.onTertiaryContainer } : { bg: r.tertiary, fg: r.onTertiary };
  const highlight = L ? badgeOnLight : badgeOnDark;
  const primaryIsLight = !L; // Material's dark primary is tone 80
  const onPrimaryBadge = hc ? (L ? { bg: N(100), fg: N(0) } : { bg: N(0), fg: N(100) }) : primaryIsLight ? { bg: r.tertiaryTone(30), fg: r.tertiaryTone(100) } : { bg: r.tertiaryContainer, fg: r.onTertiaryContainer };

  const t = {
    ...sem,
    ...grey,
    "on-solid": "#ffffff",

    background: canvas,
    "surface-canvas": canvas,
    card: card,
    "surface-nested": nested,
    "surface-lowest": r.surfaceContainerLowest,
    "surface-low": nested,
    "surface-container": r.surfaceContainer,
    "surface-high": high,
    "surface-highest": highest,
    "surface-dim": r.surfaceDim,
    "surface-bright": r.surfaceBright,
    sidebar: sidebar,
    border: border,
    "border-strong": borderStrong,
    input: controlBorder,
    control: control,
    "control-hover": controlHover,
    "control-border": controlBorder,
    "table-rule": r.outline,
    foreground: text,
    "muted-foreground": muted,
    "faint-foreground": faint,
    "inverse-surface": r.inverseSurface,
    "inverse-foreground": r.inverseOnSurface,

    primary: primary,
    "primary-foreground": onPrimary,
    "primary-hover": primaryHover,
    "primary-text": L ? r.primary : r.primaryTone(80),
    "primary-soft": r.primaryContainer,
    "primary-container": r.primaryContainer,
    "on-primary-container": r.onPrimaryContainer,
    "secondary-container": r.secondaryContainer,
    "on-secondary-container": r.onSecondaryContainer,
    tertiary: r.tertiary,
    "on-tertiary": r.onTertiary,
    "tertiary-container": r.tertiaryContainer,
    "on-tertiary-container": r.onTertiaryContainer,
    "table-head": primary,
    "table-head-foreground": onPrimary,
    highlight: highlight.bg,
    "highlight-foreground": highlight.fg,
    "highlight-on-dark": badgeOnDark.bg,
    "highlight-on-dark-foreground": badgeOnDark.fg,
    "highlight-on-primary": onPrimaryBadge.bg,
    "highlight-on-primary-foreground": onPrimaryBadge.fg,
    "highlight-soft": r.tertiaryContainer,
    "on-highlight-soft": r.onTertiaryContainer,
    ring: primary,
    "selection-ring": primary,
    "selection-row": selected,
    "state-hover": `color-mix(in srgb, ${text} 8%, transparent)`,
    "state-focus": `color-mix(in srgb, ${text} 12%, transparent)`,
    "surface-hover": `color-mix(in srgb, ${primary} ${L ? 50 : 28}%, transparent)`,
    "direction-in": sem["blue-solid"],
    "direction-out": grey["grey-solid"],

    "card-foreground": text,
    popover: popover,
    "popover-foreground": text,
    secondary: r.secondaryContainer,
    "secondary-foreground": r.onSecondaryContainer,
    muted: nested,
    accent: high,
    "accent-foreground": text,
    destructive: r.error,
    "destructive-foreground": r.onError,
    success: sem["green-solid"],
    "success-foreground": "#ffffff",
    warning: sem["amber-solid"],
    "warning-foreground": "#ffffff",
    info: sem["blue-solid"],
    "info-foreground": "#ffffff",

    "sidebar-foreground": sidebarText,
    "sidebar-muted": sidebarMuted,
    "sidebar-primary": sidebarActive,
    "sidebar-primary-foreground": sidebarActiveText,
    "sidebar-accent": sidebarHover,
    "sidebar-accent-foreground": sidebarText,
    "sidebar-border": sidebarBorder,
    "sidebar-ring": L ? r.inversePrimary : r.primary,

    "pill-ring": hc ? "currentColor" : `color-mix(in srgb, ${text} 10%, transparent)`,
    "status-neutral-bg": hc ? "transparent" : r.secondaryContainer,
    "status-neutral-fg": hc ? text : r.onSecondaryContainer,
    "status-amber-bg": hc ? "transparent" : sem["amber-soft"],
    "status-amber-fg": sem["amber-text"],
    "status-green-bg": hc ? "transparent" : sem["green-soft"],
    "status-green-fg": sem["green-text"],
    "status-green-muted-bg": "transparent",
    "status-green-muted-fg": sem["green-text"],
    "status-red-bg": r.error,
    "status-red-fg": r.onError,
    "status-red-muted-bg": hc ? "transparent" : grey["grey-soft"],
    "status-red-muted-fg": sem["red-text"],
    "status-blue-bg": hc ? "transparent" : sem["blue-soft"],
    "status-blue-fg": sem["blue-text"],

    "heat-0": "transparent",
    "heat-1": tone(HEAT, L ? 92 : 20),
    "heat-2": tone(HEAT, L ? 84 : 26),
    "heat-3": tone(HEAT, L ? 75 : 32),
    "heat-4": tone(HEAT, L ? 66 : 38),
    "heat-5": tone(HEAT, L ? 60 : 40),
    "heat-text": r.onSurface,

    "chart-1": primary,
    "chart-2": sem["amber-solid"],
    "chart-3": sem["blue-solid"],
    "chart-4": grey["grey-solid"],
    "chart-5": sem["red-solid"],

    "ink-950": N(L ? 10 : 98),
    "ink-900": N(L ? 15 : 95),
    "ink-800": N(L ? 20 : 90),
    "ink-700": N(L ? 30 : 80),
    "ink-600": N(L ? 40 : 70),
    "ink-500": N(L ? 50 : 60),
    "ink-400": N(L ? 60 : 50),
    "ink-300": N(L ? 70 : 40),
    "ink-200": N(L ? 80 : 30),
    "ink-100": N(L ? 90 : 25),
    "paper-50": canvas,
    "paper-0": card,

    radius: "0.5rem",
    "shadow-card": shadowLevel(1),
    "shadow-raised": shadowLevel(2),
    "shadow-overlay": shadowLevel(3),
    "color-scheme": isDark ? "dark" : "light",
  };
  return t;
}

function block(selector, theme, isDark) {
  const t = tokens(theme, isDark);
  const lines = [`${selector} {`, `  --theme-name: "${theme.id}";`, `  --contrast-level: ${theme.highContrast ? "high" : "normal"};`];
  for (const [k, v] of Object.entries(t)) {
    if (k === "color-scheme") lines.push(`  color-scheme: ${v};`);
    else lines.push(`  --${k}: ${v};`);
  }
  lines.push("}");
  return lines.join("\n");
}

const header = `/*
 * Farmyard Bookings design tokens, v3 — GENERATED by scripts/gen-m3-tokens.mjs.
 * Do not edit by hand; change the seeds or the role mapping in the script.
 *
 * Material 3 colour roles (docs/research/09-material-colour.md): one seed per
 * theme → primary / secondary / tertiary / error / neutral palettes → the
 * app's token names. Surfaces are the five Material container tiers, hover
 * and focus are state layers, selected is secondary-container, elevation is
 * level 1 / 2 / 3 shadows. Semantic hues (green, amber, red, blue, grey) are
 * fixed tonal palettes so a meaning is the same colour in every theme.
 */
`;

const parts = [header];
for (const theme of THEMES) {
  const light = theme.isDefault ? `:root,\n[data-theme="${theme.id}"]` : `[data-theme="${theme.id}"]`;
  const dark = theme.isDefault ? `.dark,\n[data-theme="${theme.id}"].dark` : `[data-theme="${theme.id}"].dark`;
  parts.push(`/* ------------------------------------------------------------ ${theme.id} */`);
  parts.push(block(light, theme, false));
  parts.push(block(dark, theme, true));
}
parts.push(`/* ------------------------------------------------------------- text size
 * One knob: the root font size. Everything is in rem. The default
 * preference is "large" (17 px); "default" is 16 and "xlarge" 18. */

html {
  font-size: 17px;
}
html[data-text-size="default"] {
  font-size: 16px;
}
html[data-text-size="large"] {
  font-size: 17px;
}
html[data-text-size="xlarge"] {
  font-size: 18px;
}
`);

const css = parts.join("\n\n");
if (process.argv.includes("--print")) process.stdout.write(css);
else {
  writeFileSync(OUT, css);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${css.split("\n").length} lines, ${THEMES.length} themes)`);
}
