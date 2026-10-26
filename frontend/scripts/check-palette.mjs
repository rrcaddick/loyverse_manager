#!/usr/bin/env node
/**
 * Palette separation check for the generated tokens (docs/research/09).
 *
 * For every theme × mode: the lightness gap (OKLab L, 0–1) between the
 * surfaces that must read as layers, and the WCAG contrast of the text roles
 * and pills. Exit 1 when anything is below its minimum.
 *
 *   node scripts/check-palette.mjs           # table, exit 1 on failure
 *   node scripts/check-palette.mjs --md      # markdown
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "../src/styles/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const THEMES = ["graphite", "fynbos", "indigo", "lagoon", "cocoa", "contrast"];

// ---- parse: blocks keyed by (theme, mode)
const blocks = {};
const re = /([^{}]+)\{([^{}]*)\}/g;
let m;
while ((m = re.exec(css))) {
  const selector = m[1].trim();
  const body = m[2];
  for (const theme of THEMES) {
    const isLight = selector.includes(`[data-theme="${theme}"]`) && !selector.includes(".dark");
    const isDark = selector.includes(`[data-theme="${theme}"].dark`);
    if (!isLight && !isDark) continue;
    const key = `${theme}:${isDark ? "dark" : "light"}`;
    blocks[key] = blocks[key] || {};
    for (const line of body.split(";")) {
      const [k, ...rest] = line.split(":");
      if (!k || !rest.length || !k.trim().startsWith("--")) continue;
      blocks[key][k.trim().slice(2)] = rest.join(":").trim();
    }
  }
}

// ---- colour maths
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}
function resolve(value, tokens, bg) {
  if (!value) return null;
  if (value === "transparent") return bg ?? null;
  if (value === "currentColor") return null;
  if (value.startsWith("#")) return hexToRgb(value);
  const mix = value.match(/color-mix\(in srgb, (#[0-9a-f]{6}) (\d+)%, (#[0-9a-f]{6}|transparent)\)/i);
  if (mix) {
    const a = hexToRgb(mix[1]);
    const p = Number(mix[2]) / 100;
    const b = mix[3] === "transparent" ? bg : hexToRgb(mix[3]);
    if (!b) return null;
    return a.map((v, i) => v * p + b[i] * (1 - p));
  }
  const v = value.match(/^var\(--([a-z0-9-]+)\)$/);
  if (v) return resolve(tokens[v[1]], tokens, bg);
  return null;
}
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance([r, g, b]) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
function oklabC([r, g, b]) {
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m2 = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const [l_, m_, s_] = [Math.cbrt(l), Math.cbrt(m2), Math.cbrt(s)];
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return Math.hypot(a, bb);
}
function oklabL([r, g, b]) {
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m2 = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const [l_, m_, s_] = [Math.cbrt(l), Math.cbrt(m2), Math.cbrt(s)];
  return 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
}

// ---- what must hold
// Ladder D minimums (calibration sheet, 26 Oct): roles seen together sit ≥ 10 tones apart.
const GAPS = [
  ["canvas ↔ card", "background", "card", 0.08],
  ["card ↔ zebra row", "card", "surface-nested", 0.08],
  ["zebra ↔ table head", "surface-nested", "surface-high", 0.04],
  ["canvas ↔ table head", "background", "surface-high", 0.08],
  ["canvas ↔ sidebar", "background", "sidebar", 0.10],
  ["card ↔ hover", "card", "surface-hover", 0.08, "tint"],
  ["zebra ↔ hover", "surface-nested", "surface-hover", 0.08, "tint"],
  ["canvas ↔ control", "background", "control", 0.06],
  ["card ↔ selected row", "card", "selection-row", 0.05],
  // A selected row is tinted: it may differ from its neighbours by hue instead of tone.
  ["zebra ↔ selected row", "surface-nested", "selection-row", 0.04, "tint"],
  ["hover ↔ selected row", "surface-hover", "selection-row", 0.03, "tint"],
];
const TEXT = [
  ["text on card", "foreground", "card", 7],
  ["text on canvas", "foreground", "background", 7],
  ["secondary text on card", "muted-foreground", "card", 4.5],
  ["secondary text on zebra", "muted-foreground", "surface-nested", 4.5],
  ["on primary", "primary-foreground", "primary", 4.5],
  ["active nav text", "sidebar-accent-foreground", "sidebar-accent", 4.5],
  ["sidebar text", "sidebar-foreground", "sidebar", 7],
  ["sidebar muted text", "sidebar-muted", "sidebar", 4.5],
  ["active nav (filled)", "sidebar-primary-foreground", "sidebar-primary", 4.5],
  ["table head text", "table-head-foreground", "table-head", 4.5],
  ["canvas ↔ table head (contrast)", "table-head", "background", 1.5],
  ["on primary container", "on-primary-container", "primary-container", 4.5],
  ["badge text", "highlight-foreground", "highlight", 4.5],
  ["badge text (dark surface form)", "highlight-on-dark-foreground", "highlight-on-dark", 4.5],
  ["badge text (on primary)", "highlight-on-primary-foreground", "highlight-on-primary", 4.5],
  ["badge on sidebar", "highlight-on-dark", "sidebar", 3],
  ["badge on card", "highlight", "card", 3],
  ["badge on primary (active tab)", "highlight-on-primary", "primary", 2.5],
  ["row separator on card", "table-rule", "card", 2.0],
  ["selected row text", "foreground", "selection-row", 4.5],
  ["hovered row text", "foreground", "surface-hover", 4.5],
  ["hovered row secondary text", "muted-foreground", "surface-hover", 3],
  ["pill neutral", "status-neutral-fg", "status-neutral-bg", 4.5],
  ["pill amber", "status-amber-fg", "status-amber-bg", 4.5],
  ["pill green", "status-green-fg", "status-green-bg", 4.5],
  ["pill red", "status-red-fg", "status-red-bg", 4.5],
  ["pill blue", "status-blue-fg", "status-blue-bg", 4.5],
  ["text on control", "foreground", "control", 7],
  ["control border on canvas", "control-border", "background", 1.4],
  ["border on card", "border", "card", 1.3],
  ["border on canvas", "border", "background", 1.25],
];

const md = process.argv.includes("--md");
let failures = 0;
const rows = [];
for (const theme of THEMES) {
  for (const mode of ["light", "dark"]) {
    const t = blocks[`${theme}:${mode}`];
    if (!t) continue;
    const card = resolve(t.card, t);
    for (const [label, a, b, min, kind] of GAPS) {
      const A = resolve(t[a], t, card);
      const B = resolve(t[b], t, card);
      if (!A || !B) continue;
      const gap = Math.abs(oklabL(A) - oklabL(B));
      const dc = Math.abs(oklabC(A) - oklabC(B));
      const ok = gap >= min || (kind === "tint" && dc >= 0.04);
      if (!ok) failures++;
      rows.push([theme, mode, label, `ΔL ${gap.toFixed(3)}${kind === "tint" ? ` ΔC ${dc.toFixed(3)}` : ""}`, `≥ ${min}`, ok ? "ok" : "LOW"]);
    }
    for (const [label, fg, bg, min] of TEXT) {
      const F = resolve(t[fg], t, card);
      const B = resolve(t[bg], t, card) ?? card;
      if (!F || !B) continue;
      const ratio = contrast(F, B);
      const ok = ratio >= min;
      if (!ok) failures++;
      rows.push([theme, mode, label, `${ratio.toFixed(2)}:1`, `≥ ${min}`, ok ? "ok" : "LOW"]);
    }
  }
}
if (md) {
  console.log("| theme | mode | pair | value | min | |\n| --- | --- | --- | --- | --- | --- |");
  for (const r of rows) console.log(`| ${r.join(" | ")} |`);
} else {
  const width = [10, 5, 26, 12, 8];
  for (const r of rows) console.log(r.map((c, i) => String(c).padEnd(width[i] ?? 4)).join(" "));
}
console.log(`\n${rows.length} checks, ${failures} below minimum.`);
process.exit(failures ? 1 : 0);
