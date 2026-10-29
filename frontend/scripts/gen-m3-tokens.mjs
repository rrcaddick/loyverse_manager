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
 *   canvas            surface-container (light 94) / surface (dark 6)
 *   card              surface-container-lowest (100) / surface-container (12)   + level-1 shadow + outline-variant border
 *   nested / zebra    surface-container-low (96) / surface-container-high (17)
 *   table head, menus surface-container-high (92) / -highest (22)
 *   sidebar           surface-container-highest (90) / surface-container-low (10)
 *   popover           surface-container-lowest + level-3 shadow / surface-container-highest
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
  Hct,
  MaterialDynamicColors,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeTonalSpot,
  TonalPalette,
  argbFromHex,
  hexFromArgb,
} from "@material/material-color-utilities";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "../src/styles/tokens.css");

const THEMES = [
  { id: "graphite", seed: "#605b53", scheme: SchemeNeutral, contrast: 0.0, isDefault: true },
  { id: "fynbos", seed: "#8a3fa6", scheme: SchemeTonalSpot, contrast: 0.0 },
  { id: "indigo", seed: "#4f55d9", scheme: SchemeTonalSpot, contrast: 0.0 },
  { id: "lagoon", seed: "#15808f", scheme: SchemeTonalSpot, contrast: 0.0 },
  { id: "cocoa", seed: "#7d5536", scheme: SchemeTonalSpot, contrast: 0.0 },
  { id: "contrast", seed: "#303030", scheme: SchemeMonochrome, contrast: 1.0, highContrast: true },
];

const ROLES = [
  "surface", "surfaceDim", "surfaceBright", "surfaceContainerLowest", "surfaceContainerLow", "surfaceContainer",
  "surfaceContainerHigh", "surfaceContainerHighest", "onSurface", "onSurfaceVariant", "outline", "outlineVariant",
  "primary", "onPrimary", "primaryContainer", "onPrimaryContainer", "secondary", "onSecondary", "secondaryContainer",
  "onSecondaryContainer", "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer", "error", "onError",
  "errorContainer", "onErrorContainer", "inverseSurface", "inverseOnSurface", "surfaceTint",
];

const SEMANTIC = {
  green: TonalPalette.fromHueAndChroma(145, 48),
  amber: TonalPalette.fromHueAndChroma(72, 64),
  red: TonalPalette.fromHueAndChroma(25, 84),
  blue: TonalPalette.fromHueAndChroma(250, 48),
};
const HEAT = TonalPalette.fromHueAndChroma(72, 56);

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
  out.neutralTone = (t) => hexFromArgb(scheme.neutralPalette.tone(t));
  out.neutralVariantTone = (t) => hexFromArgb(scheme.neutralVariantPalette.tone(t));
  return out;
}

const tone = (palette, t) => hexFromArgb(palette.tone(t));

function tokens(theme, isDark) {
  const r = roles(theme, isDark);
  const hc = !!theme.highContrast;
  const L = !isDark;
  const sem = {};
  for (const [name, pal] of Object.entries(SEMANTIC)) {
    sem[`${name}-text`] = tone(pal, L ? (hc ? 25 : 30) : hc ? 85 : 80);
    sem[`${name}-soft`] = tone(pal, L ? 90 : 30);
    sem[`${name}-solid`] = tone(pal, L ? (hc ? 35 : 40) : 40);
  }
  const grey = {
    "grey-text": r.neutralVariantTone(L ? 30 : 80),
    "grey-soft": r.neutralVariantTone(L ? 90 : 30),
    "grey-solid": r.neutralVariantTone(45),  // white text at 5:1 in both modes
  };
  // Light: canvas 94, card 100, zebra 96, head 92, sidebar 90.
  // Dark climbs instead of dropping: canvas 6, sidebar 10, card 12, zebra 17, head 22.
  const canvas = L ? r.surfaceContainer : r.surface;
  const card = L ? r.surfaceContainerLowest : r.surfaceContainer;
  const nested = L ? r.surfaceContainerLow : r.surfaceContainerHigh;
  const high = L ? r.surfaceContainerHigh : r.surfaceContainerHighest;
  const highest = r.surfaceContainerHighest;
  const sidebar = L ? r.surfaceContainerHighest : r.surfaceContainerLow;
  const popover = L ? r.surfaceContainerLowest : r.surfaceContainerHighest;
  const shadowLevel = (n) =>
    ({
      1: "0 1px 2px 0 rgb(0 0 0 / 0.30), 0 1px 3px 1px rgb(0 0 0 / 0.15)",
      2: "0 1px 2px 0 rgb(0 0 0 / 0.30), 0 2px 6px 2px rgb(0 0 0 / 0.15)",
      3: "0 1px 3px 0 rgb(0 0 0 / 0.30), 0 4px 8px 3px rgb(0 0 0 / 0.15)",
    })[n];
  const t = {
    ...sem,
    ...grey,
    "on-solid": "#ffffff",

    // neutral tiers (old names) + the Material tiers (new names)
    background: canvas,
    "surface-canvas": canvas,
    card: card,
    "surface-nested": nested,
    "surface-lowest": r.surfaceContainerLowest,
    "surface-low": r.surfaceContainerLow,
    "surface-container": r.surfaceContainer,
    "surface-high": high,
    "surface-highest": highest,
    "surface-dim": r.surfaceDim,
    "surface-bright": r.surfaceBright,
    sidebar: sidebar,
    border: hc ? r.outline : r.outlineVariant,
    "border-strong": r.outline,
    input: r.outline,
    foreground: r.onSurface,
    "muted-foreground": r.onSurfaceVariant,
    "faint-foreground": r.outline,
    "inverse-surface": r.inverseSurface,
    "inverse-foreground": r.inverseOnSurface,

    // accent roles
    primary: r.primary,
    "primary-foreground": r.onPrimary,
    "primary-hover": r.primaryTone(L ? 30 : 85),
    "primary-soft": r.primaryContainer,
    "primary-container": r.primaryContainer,
    "on-primary-container": r.onPrimaryContainer,
    "secondary-container": r.secondaryContainer,
    "on-secondary-container": r.onSecondaryContainer,
    tertiary: r.tertiary,
    "on-tertiary": r.onTertiary,
    "tertiary-container": r.tertiaryContainer,
    "on-tertiary-container": r.onTertiaryContainer,
    ring: r.primary,
    "selection-ring": r.primary,
    "selection-row": hc ? r.neutralTone(L ? 90 : 25) : r.secondaryContainer,
    "state-hover": `color-mix(in srgb, ${r.onSurface} 8%, transparent)`,
    "state-focus": `color-mix(in srgb, ${r.onSurface} 12%, transparent)`,
    "surface-hover": `color-mix(in srgb, ${r.onSurface} 8%, ${card})`,
    "direction-in": sem["blue-solid"],
    "direction-out": grey["grey-solid"],

    // shadcn roles
    "card-foreground": r.onSurface,
    popover: popover,
    "popover-foreground": r.onSurface,
    secondary: hc ? r.neutralTone(L ? 90 : 25) : r.secondaryContainer,
    "secondary-foreground": hc ? r.onSurface : r.onSecondaryContainer,
    muted: nested,
    accent: high,
    "accent-foreground": r.onSurface,
    destructive: r.error,
    "destructive-foreground": r.onError,
    success: sem["green-solid"],
    "success-foreground": "#ffffff",
    warning: sem["amber-solid"],
    "warning-foreground": "#ffffff",
    info: sem["blue-solid"],
    "info-foreground": "#ffffff",

    "sidebar-foreground": r.onSurface,
    "sidebar-primary": r.primary,
    "sidebar-primary-foreground": r.onPrimary,
    "sidebar-accent": hc ? r.neutralTone(L ? 90 : 25) : r.secondaryContainer,
    "sidebar-accent-foreground": hc ? r.onSurface : r.onSecondaryContainer,
    "sidebar-border": hc ? r.outline : r.outlineVariant,
    "sidebar-ring": r.primary,

    // pills
    "pill-ring": hc ? "currentColor" : `color-mix(in srgb, ${r.onSurface} 12%, transparent)`,
    "status-neutral-bg": hc ? "transparent" : r.secondaryContainer,
    "status-neutral-fg": hc ? r.onSurface : r.onSecondaryContainer,
    "status-amber-bg": hc ? "transparent" : sem["amber-soft"],
    "status-amber-fg": sem["amber-text"],
    "status-green-bg": hc ? "transparent" : sem["green-soft"],
    "status-green-fg": sem["green-text"],
    "status-green-muted-bg": "transparent",
    "status-green-muted-fg": sem["green-text"],
    "status-red-bg": sem["red-solid"],
    "status-red-fg": "#ffffff",
    "status-red-muted-bg": hc ? "transparent" : grey["grey-soft"],
    "status-red-muted-fg": sem["red-text"],
    "status-blue-bg": hc ? "transparent" : sem["blue-soft"],
    "status-blue-fg": sem["blue-text"],

    // heat ramp (calendar): one warm ramp in every theme, ink text on all
    "heat-0": "transparent",
    "heat-1": tone(HEAT, L ? 95 : 20),
    "heat-2": tone(HEAT, L ? 90 : 25),
    "heat-3": tone(HEAT, L ? 80 : 30),
    "heat-4": tone(HEAT, L ? 70 : 35),
    "heat-5": tone(HEAT, L ? 60 : 40),
    "heat-text": r.onSurface,

    "chart-1": r.primary,
    "chart-2": sem["amber-solid"],
    "chart-3": sem["blue-solid"],
    "chart-4": grey["grey-solid"],
    "chart-5": sem["red-solid"],

    // legacy ink ramp
    "ink-950": r.neutralTone(L ? 10 : 98),
    "ink-900": r.neutralTone(L ? 15 : 95),
    "ink-800": r.neutralTone(L ? 20 : 90),
    "ink-700": r.neutralTone(L ? 30 : 80),
    "ink-600": r.neutralTone(L ? 40 : 70),
    "ink-500": r.neutralTone(L ? 50 : 60),
    "ink-400": r.neutralTone(L ? 60 : 50),
    "ink-300": r.neutralTone(L ? 70 : 40),
    "ink-200": r.neutralTone(L ? 80 : 30),
    "ink-100": r.neutralTone(L ? 90 : 25),
    "paper-50": canvas,
    "paper-0": card,

    radius: "0.5rem",
    "shadow-card": shadowLevel(1),
    "shadow-raised": shadowLevel(2),
    "shadow-overlay": shadowLevel(3),
    "color-scheme": isDark ? "dark" : "light",
  };
  // ---- The owner's palette (materialpalette.com, 27 Oct 2026) ----------
  const PRIMARY = "#009688", PRIMARY_DARK = "#00796b";
  const PRIMARY_TINT = "#80cbc4"; // the primary at 50 % over white (Teal 200)
  const ACCENT = "#ff4081";
  const TEXT = "#212121", TEXT_2 = "#757575", DIVIDER = "#bdbdbd", TEXT_3 = "#9e9e9e";
  Object.assign(t, {
    primary: PRIMARY, "primary-foreground": "#ffffff", "primary-hover": PRIMARY_DARK, "primary-text": PRIMARY_DARK,
    "primary-soft": PRIMARY_TINT, "primary-container": PRIMARY_TINT, "on-primary-container": TEXT,
    ring: PRIMARY, "selection-ring": PRIMARY, "selection-row": "#80cbc4",
    "table-head": PRIMARY, "table-head-foreground": "#ffffff",
    "sidebar-primary": PRIMARY, "sidebar-primary-foreground": "#ffffff", "sidebar-ring": PRIMARY,
    "surface-hover": "color-mix(in srgb, " + PRIMARY + " 25%, transparent)",
    highlight: ACCENT, "highlight-foreground": "#ffffff",
    ...(L
      ? { foreground: TEXT, "card-foreground": TEXT, "muted-foreground": TEXT_2, "faint-foreground": TEXT_3,
          border: DIVIDER, "border-strong": TEXT_3, input: TEXT_3, "popover-foreground": TEXT, "heat-text": TEXT }
      : {}),
  });
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
