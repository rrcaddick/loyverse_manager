#!/usr/bin/env node
// Builds a one-page calibration sheet: three surface ladders (A = Material
// defaults as shipped, B = stronger, C = strongest) in light and dark, drawn
// with real components and measured gaps, so the owner can pick by eye.
import { writeFileSync } from "node:fs";
import { Hct, SchemeTonalSpot, TonalPalette, argbFromHex, hexFromArgb } from "@material/material-color-utilities";

const seed = "#4f55d9"; // Indigo, the theme in the owner's screenshot
const scheme = (dark) => new SchemeTonalSpot(Hct.fromInt(argbFromHex(seed)), dark, 0);
const N = scheme(false).neutralPalette;
const NV = scheme(false).neutralVariantPalette;
const P = scheme(false).primaryPalette;
const hue = Hct.fromInt(argbFromHex(seed)).hue;
const PV = TonalPalette.fromHueAndChroma(hue, 84); // vivid primary for B/C
const AMBER = TonalPalette.fromHueAndChroma(72, 64);
const GREEN = TonalPalette.fromHueAndChroma(145, 48);
const t = (pal, tone) => hexFromArgb(pal.tone(tone));

const LADDERS = {
  light: {
    A: { name: "A · as shipped (Material default)", canvas: t(N, 94), sidebar: t(N, 90), card: t(N, 100), zebra: t(N, 96), head: t(N, 92), border: t(NV, 80), text: t(N, 10), muted: t(NV, 30), btn: t(P, 40), onBtn: "#ffffff", selected: t(P, 90) },
    B: { name: "B · stronger", canvas: t(N, 92), sidebar: t(N, 86), card: t(N, 100), zebra: t(N, 95), head: t(N, 90), border: t(NV, 70), text: t(N, 10), muted: t(NV, 30), btn: t(PV, 40), onBtn: "#ffffff", selected: t(P, 88) },
    C: { name: "C · strongest", canvas: t(N, 89), sidebar: t(N, 82), card: t(N, 100), zebra: t(N, 94), head: t(N, 87), border: t(NV, 60), text: t(N, 10), muted: t(NV, 30), btn: t(PV, 35), onBtn: "#ffffff", selected: t(P, 85) },
    D: { name: "D · banded (10 tones apart)", canvas: t(N, 90), sidebar: t(N, 22), sidebarText: t(N, 92), sidebarMuted: t(NV, 80), card: t(N, 100), zebra: t(N, 94), head: t(N, 80), headText: t(NV, 20), border: t(NV, 70), text: t(N, 10), muted: t(NV, 30), btn: t(PV, 35), onBtn: "#ffffff", selected: t(P, 85), navActive: t(P, 40), navActiveText: "#ffffff" },
  },
  dark: {
    A: { name: "A · as shipped (Material default)", canvas: t(N, 6), sidebar: t(N, 10), card: t(N, 12), zebra: t(N, 17), head: t(N, 22), border: t(NV, 30), text: t(N, 90), muted: t(NV, 80), btn: t(P, 80), onBtn: t(P, 20), selected: t(P, 30) },
    B: { name: "B · stronger", canvas: t(N, 4), sidebar: t(N, 12), card: t(N, 18), zebra: t(N, 24), head: t(N, 32), border: t(NV, 42), text: t(N, 95), muted: t(NV, 80), btn: t(PV, 47), onBtn: "#ffffff", selected: t(P, 35) },
    C: { name: "C · strongest", canvas: "#0b0b0e", sidebar: t(N, 14), card: t(N, 22), zebra: t(N, 28), head: t(N, 36), border: t(NV, 50), text: t(N, 98), muted: t(NV, 85), btn: t(PV, 44), onBtn: "#ffffff", selected: t(P, 40) },
    D: { name: "D · banded (10 tones apart)", canvas: t(N, 8), sidebar: t(P, 20), sidebarText: t(P, 90), sidebarMuted: t(P, 70), card: t(N, 22), zebra: t(N, 27), head: t(N, 32), headText: t(NV, 85), border: t(NV, 45), text: t(N, 95), muted: t(NV, 80), btn: t(PV, 44), onBtn: "#ffffff", selected: t(P, 40), navActive: t(P, 40), navActiveText: "#ffffff" },
  },
};

// ---- maths for the measurement line
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const [x, y] = [lum(hexToRgb(a)), lum(hexToRgb(b))].sort((p, q) => q - p); return ((x + 0.05) / (y + 0.05)).toFixed(1); };
const okL = (h) => { const [r, g, b] = hexToRgb(h).map(lin); const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b); return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s; };
const gap = (a, b) => Math.abs(okL(a) - okL(b)).toFixed(2);
const mix = (fg, bg, p) => { const f = hexToRgb(fg), g = hexToRgb(bg); return "#" + f.map((v, i) => Math.round((v * p + g[i] * (1 - p)) * 255).toString(16).padStart(2, "0")).join(""); };

function tile(mode, key, L) {
  const hover = mix(L.text, L.card, 0.08);
  const amberBg = mode === "light" ? t(AMBER, 90) : t(AMBER, 30), amberFg = mode === "light" ? t(AMBER, 30) : t(AMBER, 85);
  const greenBg = mode === "light" ? t(GREEN, 90) : t(GREEN, 30), greenFg = mode === "light" ? t(GREEN, 30) : t(GREEN, 85);
  const rows = [
    ["FY1698", "Harbour of Hope Ministries", "Sat 7 Nov", "R 11 400", `<span class="pill" style="background:${amberBg};color:${amberFg}">Customer reply</span>`, ""],
    ["FY1724", "Goodwood United soccer", "Sat 7 Nov", "R 4 100", `<span class="pill" style="background:${greenBg};color:${greenFg}">Response sent</span>`, "zebra"],
    ["FY1730", "Old Apostolic Simondium", "Sat 7 Nov", "R 3 800", `<span class="pill" style="background:${greenBg};color:${greenFg}">Response sent</span>`, "hover"],
    ["FY1703", "Little Shining Stars", "Tue 10 Nov", "R 5 390", `<span class="pill" style="background:${greenBg};color:${greenFg}">Response sent</span>`, "selected"],
  ];
  const rowBg = (k) => (k === "zebra" ? L.zebra : k === "hover" ? hover : k === "selected" ? L.selected : L.card);
  const sideText = L.sidebarText || L.muted, sideActiveBg = L.navActive || L.selected, sideActiveText = L.navActiveText || L.text;
  const headText = L.headText || L.muted;
  return `
  <article class="tile" data-ladder="${key}" style="--canvas:${L.canvas};--sidebar:${L.sidebar};--card:${L.card};--zebra:${L.zebra};--head:${L.head};--head-text:${headText};--border:${L.border};--text:${L.text};--muted:${L.muted};--btn:${L.btn};--on-btn:${L.onBtn};--side-text:${L.sidebarMuted || L.muted};--side-strong:${sideText}">
    <h3>${L.name}</h3>
    <div class="frame">
      <aside class="side">
        <div class="brand"></div>
        <div class="nav">Today</div><div class="nav active" style="background:${sideActiveBg};color:${sideActiveText}">Bookings</div><div class="nav">Enquiries</div>
      </aside>
      <main class="page">
        <div class="bar"><strong>Bookings</strong><button class="btn" type="button">+ New booking</button></div>
        <div class="tablecard">
          <table>
            <thead><tr><th>Ref</th><th>Group</th><th>Visit</th><th class="num">Balance</th><th>Last action</th></tr></thead>
            <tbody>${rows.map(([a, b, c, d, e, k]) => `<tr data-k="${k}" style="background:${rowBg(k)}"><td><strong>${a}</strong></td><td>${b}</td><td>${c}</td><td class="num">${d}</td><td>${e}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </main>
    </div>
    <dl class="measure">
      <div><dt>canvas → card</dt><dd>ΔL ${gap(L.canvas, L.card)}</dd></div>
      <div><dt>card → zebra</dt><dd>ΔL ${gap(L.card, L.zebra)}</dd></div>
      <div><dt>card → hover</dt><dd>ΔL ${gap(L.card, hover)}</dd></div>
      <div><dt>canvas → sidebar</dt><dd>ΔL ${gap(L.canvas, L.sidebar)}</dd></div>
      <div><dt>canvas → table head</dt><dd>ΔL ${gap(L.canvas, L.head)}</dd></div>
      <div><dt>button on canvas</dt><dd>${contrast(L.btn, L.canvas)}:1</dd></div>
      <div><dt>text on card</dt><dd>${contrast(L.text, L.card)}:1</dd></div>
    </dl>
  </article>`;
}

const html = `<title>Palette Calibration</title>
<style>
  /* Layout: two bands (light, dark), three ladders each, real components, numbers under each. */
  :root { --bg: #f6f6f8; --fg: #1b1b1f; --fg-2: #4b4b55; --rule: #d9d9e0; --font: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #141418; --fg: #e8e8ee; --fg-2: #a9a9b4; --rule: #33333c; color-scheme: dark; } }
  :root[data-theme="dark"] { --bg: #141418; --fg: #e8e8ee; --fg-2: #a9a9b4; --rule: #33333c; color-scheme: dark; }
  body { background: var(--bg); color: var(--fg); font-family: var(--font); margin: 0; padding-block: 32px; padding-inline: 20px; line-height: 1.4; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.01em; text-wrap: balance; }
  p.lead { margin: 0 0 28px; color: var(--fg-2); max-width: 62ch; }
  h2 { font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg-2); margin: 28px 0 12px; }
  .band { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 18px; }
  .tile { min-width: 0; border: 1px solid var(--rule); border-radius: 12px; padding: 12px; background: color-mix(in srgb, var(--bg) 85%, var(--fg) 15% / 0.04); }
  .tile h3 { font-size: 14px; margin: 0 0 10px; font-weight: 600; }
  .frame { display: grid; grid-template-columns: 92px minmax(0, 1fr); background: var(--canvas); color: var(--text); border-radius: 8px; overflow: hidden; font-size: 12px; min-height: 230px; }
  .side { background: var(--sidebar); padding: 10px 8px; display: grid; gap: 4px; align-content: start; border-right: 1px solid var(--border); }
  .brand { height: 10px; width: 56px; border-radius: 3px; background: var(--muted); opacity: .5; margin-bottom: 8px; }
  .nav { padding: 6px 8px; border-radius: 6px; color: var(--side-text); }
  .nav.active { font-weight: 600; }
  .page { padding: 12px; min-width: 0; }
  .bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .bar strong { font-size: 15px; }
  .btn { background: var(--btn); color: var(--on-btn); border: 0; border-radius: 7px; padding: 7px 11px; font: inherit; font-weight: 600; font-size: 12px; box-shadow: 0 1px 2px rgb(0 0 0 / .3), 0 1px 3px 1px rgb(0 0 0 / .15); }
  .tablecard { background: var(--card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; box-shadow: 0 1px 2px rgb(0 0 0 / .3), 0 1px 3px 1px rgb(0 0 0 / .15); }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; color: inherit; }
  th { background: var(--head); color: var(--head-text); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); }
  td { padding: 7px 8px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  .num { text-align: right; }
  .pill { display: inline-block; border-radius: 5px; padding: 2px 6px; font-size: 10.5px; font-weight: 600; }
  tr[data-k="hover"] td:nth-child(2)::after { content: " · hovered"; color: var(--muted); }
  tr[data-k="selected"] td:nth-child(2)::after { content: " · selected"; color: var(--muted); }
  .measure { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 10px; margin: 10px 0 0; font-size: 11.5px; }
  .measure div { display: flex; justify-content: space-between; gap: 6px; border-top: 1px solid var(--rule); padding-top: 5px; }
  .measure dt { color: var(--fg-2); } .measure dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 600; }
  @media (max-width: 420px) { .frame { grid-template-columns: 72px minmax(0, 1fr); } .measure { grid-template-columns: 1fr 1fr; } }
</style>
<h1>Palette Calibration</h1>
<p class="lead">Four surface ladders drawn with the real parts of the Bookings screen: sidebar, canvas, table card, zebra row, hovered row, selected row, the primary button and the two Last action pills. Indigo seed throughout. ΔL is the lightness gap (0 to 1); the shipped build is A; D is the banded proposal (every region at least ten tones from the others, a dark navigation column in light mode). Say which letter for light and which for dark, or ask for a point between two.</p>
<h2>Light</h2>
<section class="band">${["A", "B", "C", "D"].map((k) => tile("light", k, LADDERS.light[k])).join("")}</section>
<h2>Dark</h2>
<section class="band">${["A", "B", "C", "D"].map((k) => tile("dark", k, LADDERS.dark[k])).join("")}</section>
`;
const out = process.argv[2] || "/home/ray/.claude/jobs/d8b38ba5/tmp/palette-calibration.html";
writeFileSync(out, html);
console.log("wrote", out, html.length, "bytes");
for (const mode of ["light", "dark"]) for (const k of ["A", "B", "C", "D"]) { const L = LADDERS[mode][k]; console.log(mode, k, "canvas→card", gap(L.canvas, L.card), "card→zebra", gap(L.card, L.zebra), "sidebar", gap(L.canvas, L.sidebar), "btn", contrast(L.btn, L.canvas) + ":1", "onBtn", contrast(L.onBtn, L.btn) + ":1"); }
