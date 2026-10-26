#!/usr/bin/env node
/**
 * Material 2 palette check: every primary × accent pair, light and dark.
 * Text on its surfaces, button and badge text on their fills, pill text on
 * pill fills, and the visibility of hover and selection. Exit 1 on failure.
 *
 *   node scripts/check-palette.mjs            # summary, failures listed
 *   node scripts/check-palette.mjs --all      # every row
 */
import { SWATCH_IDS, canBeAccent, contrast, tokensFor } from "../src/styles/m2.mjs";

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function okL(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

// Material's own bars: body text 4.5:1; button and badge text 3:1 (bold on fills);
// hover / selected visible against the card.
const TEXT = [
  ["text on card", "foreground", "card", 4.5],
  ["text on canvas", "foreground", "background", 4.5],
  ["secondary text on card", "muted-foreground", "card", 4.5],
  ["button text", "primary-foreground", "primary", 3],
  ["app bar text", "app-bar-foreground", "app-bar", 3],
  ["link text on card", "primary-text", "card", 4.5],
  ["badge text", "highlight-foreground", "highlight", 3],
  ["drawer text", "sidebar-foreground", "sidebar", 4.5],
  ["drawer active text", "sidebar-primary-foreground", "sidebar-primary", 4.5],
  ["pill neutral", "status-neutral-fg", "status-neutral-bg", 4.5],
  ["pill amber", "status-amber-fg", "status-amber-bg", 4.5],
  ["pill green", "status-green-fg", "status-green-bg", 4.5],
  ["pill red", "status-red-fg", "status-red-bg", 3],
  ["pill blue", "status-blue-fg", "status-blue-bg", 4.5],
  ["heat text on heat-5", "heat-text", "heat-5", 4.5],
  ["table head text", "table-head-foreground", "table-head", 4.5],
];
const GAPS = [
  ["card ↔ hover", "card", "surface-hover", 0.03],
  ["card ↔ selected", "card", "selection-row", 0.02],
  ["canvas ↔ card", "background", "card", 0.014],
];

const all = process.argv.includes("--all");
let checks = 0, failures = 0;
const rows = [];
for (const primary of SWATCH_IDS) {
  for (const accent of SWATCH_IDS) {
    if (!canBeAccent(accent) || accent === primary) continue;
    for (const mode of ["light", "dark"]) {
      const t = tokensFor({ primary, accent }, mode);
      for (const [label, fg, bg, min] of TEXT) {
        const ratio = contrast(t[fg], t[bg]);
        checks++;
        const ok = ratio >= min;
        if (!ok) failures++;
        if (all || !ok) rows.push(`${primary}+${accent} ${mode} · ${label}: ${ratio.toFixed(2)}:1 (min ${min}) ${ok ? "" : "LOW"}`);
      }
      for (const [label, a, b, min] of GAPS) {
        const gap = Math.abs(okL(t[a]) - okL(t[b]));
        checks++;
        const ok = gap >= min;
        if (!ok) failures++;
        if (all || !ok) rows.push(`${primary}+${accent} ${mode} · ${label}: ΔL ${gap.toFixed(3)} (min ${min}) ${ok ? "" : "LOW"}`);
      }
    }
  }
}
const byLabel = {};
for (const r of rows) { const key = r.split(" · ")[1]?.split(":")[0] ?? r; byLabel[key] = (byLabel[key] || 0) + 1; }
if (!all) { for (const [k, n] of Object.entries(byLabel).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${k}`); console.log("---"); }
for (const r of rows.slice(0, all ? rows.length : 12)) console.log(r);
console.log(`\n${checks} checks across ${SWATCH_IDS.length} primaries × accents × 2 modes, ${failures} below minimum.`);
process.exit(failures ? 1 : 0);
