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
  // Graphite is the ink-and-paper theme: its "vivid" accent is ink, not a forced hue.
  { id: "graphite", seed: "#605b53", scheme: SchemeNeutral, contrast: 0.0, isDefault: true, ink: true },
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
  green: TonalPalette.fromHueAndChroma(145, 60),
  amber: TonalPalette.fromHueAndChroma(72, 72),
  red: TonalPalette.fromHueAndChroma(25, 84),
  blue: TonalPalette.fromHueAndChroma(250, 60),
};
const HEAT = TonalPalette.fromHueAndChroma(72, 64);

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
  // Depth: buttons, active items and selections use a vivid palette on the
  // seed's hue (chroma 84) rather than the scheme's tempered primary.
  const PV = (tn) => hexFromArgb(TonalPalette.fromHueAndChroma(r.primaryHue, hc || theme.ink ? (theme.ink ? 10 : 0) : 84).tone(tn));
  const ink = !!theme.ink || hc;

  // Semantic hues: richer fills than Material's tone-90 pastels (owner, 26 Oct).
  const sem = {};
  for (const [name, pal] of Object.entries(SEMANTIC)) {
    sem[`${name}-text`] = tone(pal, L ? (hc ? 15 : 20) : hc ? 95 : 92);
    sem[`${name}-soft`] = tone(pal, L ? 82 : 32);
    sem[`${name}-solid`] = tone(pal, L ? (hc ? 30 : 38) : 42);
  }
  const grey = {
    "grey-text": NV(L ? 20 : 92),
    "grey-soft": NV(L ? 84 : 34),
    "grey-solid": NV(45),
  };

  // The banded surface ladder (calibration sheet, ladder D): every region
  // that is seen at once sits ten or more tones from the others.
  //   light  sidebar 22 (dark column) · canvas 90 · table head 80 · zebra 94 · card 100
  //   dark   sidebar primary 20       · canvas 8  · card 22 · zebra 27 · table head 32
  const canvas = N(L ? 90 : 8);
  const card = N(L ? 100 : 22);
  const nested = N(L ? 94 : 27);
  const head = N(L ? 80 : 32);
  const highest = N(L ? 76 : 36);
  const sidebar = L ? N(22) : P(23);
  const sidebarText = L ? N(92) : P(94);
  const sidebarMuted = L ? NV(80) : P(78);
  const sidebarHover = L ? N(30) : P(30);
  const sidebarBorder = L ? N(32) : P(33);
  const popover = N(L ? 100 : 32);
  const border = L ? (hc ? NV(40) : NV(70)) : hc ? NV(70) : NV(45);
  const borderStrong = L ? NV(50) : NV(60);
  const text = N(L ? 10 : 95);
  const muted = NV(L ? 30 : 80);
  const faint = NV(L ? 50 : 60);
  // Ink themes: a near-black button in light, a near-white one in dark.
  const primary = ink ? PV(L ? 22 : 88) : PV(L ? 35 : 44);
  const primaryHover = ink ? PV(L ? 30 : 80) : PV(L ? 28 : 38);
  const onPrimary = ink && !L ? N(12) : "#ffffff";
  const primaryContainer = PV(L ? 88 : 30);
  const onPrimaryContainer = PV(L ? 10 : 95);
  // Selected is tinted so it differs from hover by hue as well as by tone.
  const selected = ink ? N(L ? 80 : 44) : PV(L ? 86 : 34);
  const secondaryContainer = NV(L ? 84 : 34);
  const onSecondaryContainer = NV(L ? 15 : 95);

  // Elevation at desktop scale (owner, 26 Oct): Material's phone-scale
  // shadows vanish on a monitor. Light: large, dark shadows on the grey
  // canvas. Dark: a black shadow alone has nothing darker to fall onto, so a
  // raised object is a lighter fill with a 1 px light edge on top, and the
  // shadow only separates it underneath.
  const shadowLevel = (n) =>
    L
      ? {
          1: "0 1px 2px rgb(0 0 0 / 0.12), 0 4px 12px -2px rgb(0 0 0 / 0.18)",
          2: "0 2px 4px rgb(0 0 0 / 0.14), 0 8px 20px -6px rgb(0 0 0 / 0.24)",
          3: "0 8px 16px -4px rgb(0 0 0 / 0.22), 0 20px 48px -12px rgb(0 0 0 / 0.32)",
        }[n]
      : {
          1: "inset 0 1px 0 rgb(255 255 255 / 0.10), 0 1px 2px rgb(0 0 0 / 0.55), 0 4px 12px -2px rgb(0 0 0 / 0.50)",
          2: "inset 0 1px 0 rgb(255 255 255 / 0.14), 0 2px 4px rgb(0 0 0 / 0.55), 0 8px 20px -6px rgb(0 0 0 / 0.60)",
          3: "inset 0 1px 0 rgb(255 255 255 / 0.18), 0 8px 16px -4px rgb(0 0 0 / 0.60), 0 20px 48px -12px rgb(0 0 0 / 0.75)",
        }[n];
  // Raised controls (inputs, selects, tab strips, chips): their own surface,
  // lighter than the canvas in both modes, with a firm border.
  const control = N(L ? 100 : 30);
  const controlHover = N(L ? 96 : 35);
  const controlBorder = NV(L ? 60 : 55);
  const t = {
    ...sem,
    ...grey,
    "on-solid": "#ffffff",

    background: canvas,
    "surface-canvas": canvas,
    card: card,
    "surface-nested": nested,
    "surface-lowest": N(L ? 100 : 18),
    "surface-low": N(L ? 94 : 27),
    "surface-container": N(L ? 90 : 22),
    "surface-high": head,
    "surface-highest": highest,
    "surface-dim": N(L ? 84 : 6),
    "surface-bright": N(L ? 100 : 36),
    sidebar: sidebar,
    border: border,
    "border-strong": borderStrong,
    input: controlBorder,
    control: control,
    "control-hover": controlHover,
    "control-border": controlBorder,
    foreground: text,
    "muted-foreground": muted,
    "faint-foreground": faint,
    "inverse-surface": N(L ? 20 : 92),
    "inverse-foreground": N(L ? 95 : 15),

    primary: primary,
    "primary-foreground": onPrimary,
    // The primary as *text or an icon* on a surface (links, active icons): deep in
    // light, light in dark. Fills keep using --primary.
    "primary-text": ink ? PV(L ? 22 : 90) : PV(L ? 35 : 80),
    "primary-hover": primaryHover,
    "primary-soft": primaryContainer,
    "primary-container": primaryContainer,
    "on-primary-container": onPrimaryContainer,
    "secondary-container": secondaryContainer,
    "on-secondary-container": onSecondaryContainer,
    tertiary: r.tertiary,
    "on-tertiary": r.onTertiary,
    "tertiary-container": r.tertiaryContainer,
    "on-tertiary-container": r.onTertiaryContainer,
    ring: primary,
    "selection-ring": primary,
    "selection-row": selected,
    "state-hover": `color-mix(in srgb, ${text} 8%, transparent)`,
    "state-focus": `color-mix(in srgb, ${text} 12%, transparent)`,
    // Hover must read against BOTH row colours (card 100/22, zebra 94/27), so it
    // is a fixed step beyond the zebra row, not a thin state layer over the card.
    "surface-hover": N(L ? 85 : 35),
    "direction-in": sem["blue-solid"],
    "direction-out": grey["grey-solid"],

    "card-foreground": text,
    popover: popover,
    "popover-foreground": text,
    secondary: secondaryContainer,
    "secondary-foreground": onSecondaryContainer,
    muted: nested,
    accent: head,
    "accent-foreground": text,
    destructive: sem["red-solid"],
    "destructive-foreground": "#ffffff",
    success: sem["green-solid"],
    "success-foreground": "#ffffff",
    warning: sem["amber-solid"],
    "warning-foreground": "#ffffff",
    info: sem["blue-solid"],
    "info-foreground": "#ffffff",

    "sidebar-foreground": sidebarText,
    "sidebar-muted": sidebarMuted,
    "sidebar-primary": ink ? PV(L ? 45 : 88) : PV(L ? 40 : 44),
    "sidebar-primary-foreground": ink && !L ? N(12) : "#ffffff",
    "sidebar-accent": sidebarHover,
    "sidebar-accent-foreground": sidebarText,
    "sidebar-border": sidebarBorder,
    "sidebar-ring": PV(70),

    "pill-ring": hc ? "currentColor" : `color-mix(in srgb, ${text} 10%, transparent)`,
    "status-neutral-bg": hc ? "transparent" : secondaryContainer,
    "status-neutral-fg": hc ? text : onSecondaryContainer,
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

    "heat-0": "transparent",
    "heat-1": tone(HEAT, L ? 92 : 20),
    "heat-2": tone(HEAT, L ? 84 : 26),
    "heat-3": tone(HEAT, L ? 75 : 32),
    "heat-4": tone(HEAT, L ? 66 : 38),
    "heat-5": tone(HEAT, L ? 57 : 43),
    "heat-text": L ? N(10) : N(98),

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
