#!/usr/bin/env node
/**
 * Contrast check for src/styles/tokens.css.
 *
 * Parses the token file, resolves every token for each theme × mode the way
 * the browser would (later blocks and higher specificity win, var() and
 * calc() substituted, out-of-gamut oklch chroma-mapped into sRGB), then
 * measures WCAG 2 contrast for the pairs that matter: text on surfaces,
 * status text on status fills, white on solids, accent pairs, the heat
 * ramp and the borders.
 *
 *   node scripts/check-contrast.mjs            # table + pass/fail, exit 1 on failure
 *   node scripts/check-contrast.mjs --md       # markdown table for the handoff
 *   node scripts/check-contrast.mjs graphite   # one theme only
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "../src/styles/tokens.css"), "utf8");

const THEMES = ["graphite", "fynbos", "indigo", "lagoon", "cocoa", "contrast"];
const MODES = ["light", "dark"];

// ----------------------------------------------------------------- parsing

function parseBlocks(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const selector = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    if (selector.startsWith("@")) {
      // @media etc.: ignore nested blocks for this check
      i = j;
      continue;
    }
    const decls = new Map();
    for (const line of body.split(";")) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const name = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (name.startsWith("--")) decls.set(name, value);
    }
    blocks.push({ selectors: selector.split(",").map((s) => s.trim()), decls, order: blocks.length });
    i = j;
  }
  return blocks;
}

function specificity(selector) {
  return (selector.match(/\[[^\]]*\]|\.[\w-]+|:root/g) ?? []).length;
}

function matches(selector, theme, mode) {
  const dark = mode === "dark";
  const s = selector.replace(/\s+/g, "");
  if (s === ":root" || s === "html" || s === "[data-theme]") return true;
  if (s === ".dark" || s === "[data-theme].dark" || s === ".dark[data-theme]") return dark;
  if (s === `[data-theme="${theme}"]`) return true;
  if (s === `[data-theme="${theme}"].dark` || s === `.dark[data-theme="${theme}"]`) return dark;
  return false;
}

function resolveTokens(blocks, theme, mode) {
  const applicable = [];
  for (const block of blocks) {
    const hits = block.selectors.filter((s) => matches(s, theme, mode));
    if (hits.length) applicable.push({ ...block, spec: Math.max(...hits.map(specificity)) });
  }
  applicable.sort((a, b) => a.spec - b.spec || a.order - b.order);
  const tokens = new Map();
  for (const block of applicable) for (const [k, v] of block.decls) tokens.set(k, v);
  return tokens;
}

// --------------------------------------------------------------- evaluate

function substitute(value, tokens, depth = 0) {
  if (depth > 20) throw new Error(`var() recursion too deep in ${value}`);
  return value.replace(/var\((--[\w-]+)(?:,\s*([^)]*))?\)/g, (_, name, fallback) => {
    const found = tokens.get(name);
    if (found === undefined) {
      if (fallback !== undefined) return substitute(fallback, tokens, depth + 1);
      throw new Error(`Unknown token ${name}`);
    }
    return substitute(found, tokens, depth + 1);
  });
}

function evalCalc(expr) {
  // numbers, + - * / ( ) and min/max/clamp; percentages become fractions
  const safe = expr
    .replace(/calc/g, "")
    .replace(/(\d+(?:\.\d+)?)%/g, "($1/100)")
    .replace(/\b(min|max|clamp)\b/g, "Math.$1");
  if (!/^[\d\s+\-*/().,Mathminaxclp]*$/.test(safe)) throw new Error(`Unsafe calc: ${expr}`);
  return Function(`"use strict"; return (${safe});`)();
}

function num(token) {
  const t = token.trim();
  if (/^calc\(/.test(t) || /^(min|max|clamp)\(/.test(t)) return evalCalc(t);
  if (t.endsWith("%")) return parseFloat(t) / 100;
  if (t.endsWith("deg")) return parseFloat(t);
  return parseFloat(t);
}

/** Split "L C H / A" style arguments at top-level whitespace and "/". */
function splitArgs(inner) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && (ch === " " || ch === "/")) {
      if (cur.trim()) parts.push(cur.trim());
      if (ch === "/") parts.push("/");
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// ----------------------------------------------------------------- colour

function oklchToLinearSrgb(L, C, h) {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(rgb) {
  return rgb.every((c) => c >= -0.0005 && c <= 1.0005);
}

/** CSS Color 4 style: keep L and H, reduce C until the colour fits sRGB. */
function gamutMap(L, C, h) {
  if (L >= 1) return { rgb: [1, 1, 1], clipped: false };
  if (L <= 0) return { rgb: [0, 0, 0], clipped: false };
  let rgb = oklchToLinearSrgb(L, C, h);
  if (inGamut(rgb)) return { rgb: rgb.map((c) => Math.min(1, Math.max(0, c))), clipped: false };
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    rgb = oklchToLinearSrgb(L, mid, h);
    if (inGamut(rgb)) lo = mid;
    else hi = mid;
  }
  rgb = oklchToLinearSrgb(L, lo, h).map((c) => Math.min(1, Math.max(0, c)));
  // Only report a real reduction; tiny trims near white/black are rounding.
  return { rgb, clipped: C - lo > 0.01, chroma: lo, requested: C };
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToLinear(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  const alpha = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255)), alpha };
}

/** Returns { rgb: linear sRGB [0..1], alpha, clipped } for a resolved colour string. */
function parseColour(value) {
  const v = value.trim();
  if (v === "transparent") return { rgb: [0, 0, 0], alpha: 0, clipped: false };
  if (v === "white" || v === "#fff" || v === "#ffffff") return { rgb: [1, 1, 1], alpha: 1, clipped: false };
  if (v === "black" || v === "#000" || v === "#000000") return { rgb: [0, 0, 0], alpha: 1, clipped: false };
  if (v.startsWith("#")) return { ...hexToLinear(v), clipped: false };
  const m = v.match(/^oklch\((.*)\)$/s);
  if (m) {
    const parts = splitArgs(m[1]);
    const L = num(parts[0]);
    const C = num(parts[1]);
    const H = parts[2] === undefined || parts[2] === "none" ? 0 : num(parts[2]);
    const slash = parts.indexOf("/");
    const alpha = slash >= 0 ? num(parts[slash + 1]) : 1;
    const mapped = gamutMap(L, C, H);
    return { ...mapped, alpha, L, C, H };
  }
  throw new Error(`Cannot parse colour: ${value}`);
}

/** Quantise to 8-bit like a real framebuffer so ratios match a picker. */
function quantise(rgb) {
  return rgb.map((c) => srgbToLinear(Math.round(linearToSrgb(c) * 255) / 255));
}

function over(fg, bg) {
  if (fg.alpha >= 1) return fg.rgb;
  return fg.rgb.map((c, i) => c * fg.alpha + bg[i] * (1 - fg.alpha));
}

function luminance(rgb) {
  const [r, g, b] = quantise(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fgRgb, bgRgb) {
  const a = luminance(fgRgb);
  const b = luminance(bgRgb);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function toHex(rgb) {
  return (
    "#" +
    rgb
      .map((c) => Math.round(linearToSrgb(Math.min(1, Math.max(0, c))) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

// ------------------------------------------------------------------ pairs

const HUES = ["green", "amber", "red", "blue", "grey"];

/** [label, fgToken, bgToken, minimum, note]; bg may stack: "a|b" = a composited over b. */
function pairsFor(mode) {
  const pairs = [
    ["Body text on canvas", "--foreground", "--background", 4.5],
    ["Body text on card", "--foreground", "--card", 4.5],
    ["Body text on nested", "--foreground", "--surface-nested", 4.5],
    ["Secondary text on canvas", "--muted-foreground", "--background", 4.5],
    ["Secondary text on card", "--muted-foreground", "--card", 4.5],
    ["Secondary text on nested", "--muted-foreground", "--surface-nested", 4.5],
    ["Sidebar text on sidebar", "--sidebar-foreground", "--sidebar", 4.5],
    ["Sidebar active text on active fill", "--sidebar-accent-foreground", "--sidebar-accent|--sidebar", 4.5],
    ["Sidebar secondary on sidebar", "--muted-foreground", "--sidebar", 4.5],
    ["Button text on accent", "--primary-foreground", "--primary", 4.5],
    ["Accent as text on card", "--primary", "--card", 4.5],
    ["Selected row text", "--foreground", "--selection-row|--card", 4.5],
    ["Card border on card", "--border|--card", "--card", 1.3, "visibility, not WCAG"],
    ["Card vs canvas", "--card", "--background", 1.0, "informational"],
    ["Strong border on card", "--border-strong|--card", "--card", 1.5, "visibility"],
    ["Input border on card", "--input|--card", "--card", 1.5, "visibility"],
  ];
  for (const hue of HUES) {
    pairs.push([`${hue} text on ${hue} soft`, `--${hue}-text`, `--${hue}-soft|--card`, 4.5]);
    pairs.push([`${hue} text on card`, `--${hue}-text`, "--card", 4.5]);
    pairs.push([`${hue} text on canvas`, `--${hue}-text`, "--background", 4.5]);
    pairs.push([`white on ${hue} solid`, "--on-solid", `--${hue}-solid`, 4.5]);
    // Icons and dots: solids in light, the text tints in dark (solids are fills there).
    pairs.push([`${hue} icon on card`, mode === "dark" ? `--${hue}-text` : `--${hue}-solid`, "--card", 3, "icons/dots (3:1)"]);
  }
  for (const key of ["neutral", "amber", "green", "green-muted", "red", "red-muted", "blue"]) {
    pairs.push([`status ${key} pill`, `--status-${key}-fg`, `--status-${key}-bg|--card`, 4.5]);
  }
  for (let i = 1; i <= 5; i++) {
    pairs.push([`ink on heat-${i}`, "--heat-text", `--heat-${i}|--card`, 4.5, "all text on a heat cell is full ink"]);
  }
  return pairs;
}

/** "a|b" composites token a over token b (over white when the bottom layer has alpha). */
function colourOf(expr, tokens) {
  const stack = expr.split("|");
  let acc = null;
  let clipped = false;
  for (let i = stack.length - 1; i >= 0; i--) {
    const name = stack[i];
    const raw = tokens.get(name);
    if (raw === undefined) throw new Error(`Missing ${name}`);
    const col = parseColour(substitute(raw, tokens));
    if (col.clipped) clippedDetail.set(name, `${name}: chroma ${col.requested} → ${col.chroma.toFixed(3)} at L ${col.L} H ${col.H}`);
    clipped = clipped || !!col.clipped;
    acc = acc === null ? (col.alpha >= 1 ? col.rgb : over(col, [1, 1, 1])) : over(col, acc);
  }
  return { rgb: acc, clipped };
}

// ------------------------------------------------------------------- main

const args = process.argv.slice(2);
const markdown = args.includes("--md");
const only = args.filter((a) => !a.startsWith("--"));
const blocks = parseBlocks(css);

let failures = 0;
const rows = [];
const clippedTokens = new Set();
const clippedDetail = new Map();

for (const theme of THEMES) {
  if (only.length && !only.includes(theme)) continue;
  for (const mode of MODES) {
    const tokens = resolveTokens(blocks, theme, mode);
    for (const [label, fgExpr, bgExpr, min, note] of pairsFor(mode)) {
      let fg;
      let bg;
      try {
        fg = colourOf(fgExpr, tokens);
        bg = colourOf(bgExpr, tokens);
      } catch (error) {
        rows.push({ theme, mode, label, ratio: NaN, min, ok: false, note: String(error.message) });
        failures++;
        continue;
      }
      if (fg.clipped || bg.clipped) for (const [, d] of clippedDetail) clippedTokens.add(`${theme}/${mode} ${d}`);
      clippedDetail.clear();
      const ratio = contrast(fg.rgb, bg.rgb);
      const ok = ratio >= min - 0.005;
      if (!ok) failures++;
      rows.push({ theme, mode, label, ratio, min, ok, fg: toHex(fg.rgb), bg: toHex(bg.rgb), note });
    }
  }
}

if (markdown) {
  console.log("| Theme | Mode | Pair | Colours | Ratio | Min | Result |");
  console.log("| --- | --- | --- | --- | ---: | ---: | --- |");
  for (const r of rows) {
    console.log(
      `| ${r.theme} | ${r.mode} | ${r.label} | \`${r.fg}\` on \`${r.bg}\` | ${Number.isFinite(r.ratio) ? r.ratio.toFixed(2) : "—"} | ${r.min} | ${r.ok ? "pass" : "FAIL"}${r.note ? ` (${r.note})` : ""} |`,
    );
  }
} else {
  let current = "";
  for (const r of rows) {
    const key = `${r.theme} ${r.mode}`;
    if (key !== current) {
      current = key;
      console.log(`\n== ${key} ==`);
    }
    const ratio = Number.isFinite(r.ratio) ? r.ratio.toFixed(2).padStart(6) : "   n/a";
    console.log(`${r.ok ? "  ok " : " FAIL"} ${ratio}  (min ${String(r.min).padEnd(4)}) ${r.label.padEnd(40)} ${r.fg ?? ""} on ${r.bg ?? ""}${r.note ? `  · ${r.note}` : ""}`);
  }
  if (clippedTokens.size) {
    console.log("\nGamut-mapped (chroma reduced to fit sRGB):");
    for (const t of clippedTokens) console.log("  " + t);
  }
  console.log(`\n${rows.length} pairs checked, ${failures} below minimum.`);
}
process.exit(failures ? 1 : 0);
