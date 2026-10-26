/**
 * Material Design 2 colour system (the 2014 palette and its 2018 dark theme),
 * as a pure module shared by the app (runtime theming), the token generator
 * (static defaults) and the palette checker.
 *
 *   tokensFor({ primary: "indigo", accent: "pink" }, "light")  → { background: "#fafafa", primary: "#3f51b5", … }
 *
 * A theme is two swatches from the nineteen Material colours, exactly like
 * materialpalette.com: the primary (500 for app bar, buttons and active
 * states; 700 as its dark variant; 100 as its light variant) and an accent
 * from a different swatch (A200, for badges, dots and the FAB). Text is
 * #212121 / #757575 / #9e9e9e, dividers 12 % black, cards white on Grey 50,
 * elevation by the dp shadows. Dark: #121212 with white overlays per dp,
 * the primary's 200 shade, the accent's A200, error #cf6679.
 */

export const SWATCHES = [
  { id: "red", name: "Red", s: { 50: "#ffebee", 100: "#ffcdd2", 200: "#ef9a9a", 300: "#e57373", 400: "#ef5350", 500: "#f44336", 600: "#e53935", 700: "#d32f2f", 800: "#c62828", 900: "#b71c1c", A100: "#ff8a80", A200: "#ff5252", A400: "#ff1744", A700: "#d50000" } },
  { id: "pink", name: "Pink", s: { 50: "#fce4ec", 100: "#f8bbd0", 200: "#f48fb1", 300: "#f06292", 400: "#ec407a", 500: "#e91e63", 600: "#d81b60", 700: "#c2185b", 800: "#ad1457", 900: "#880e4f", A100: "#ff80ab", A200: "#ff4081", A400: "#f50057", A700: "#c51162" } },
  { id: "purple", name: "Purple", s: { 50: "#f3e5f5", 100: "#e1bee7", 200: "#ce93d8", 300: "#ba68c8", 400: "#ab47bc", 500: "#9c27b0", 600: "#8e24aa", 700: "#7b1fa2", 800: "#6a1b9a", 900: "#4a148c", A100: "#ea80fc", A200: "#e040fb", A400: "#d500f9", A700: "#aa00ff" } },
  { id: "deep-purple", name: "Deep Purple", s: { 50: "#ede7f6", 100: "#d1c4e9", 200: "#b39ddb", 300: "#9575cd", 400: "#7e57c2", 500: "#673ab7", 600: "#5e35b1", 700: "#512da8", 800: "#4527a0", 900: "#311b92", A100: "#b388ff", A200: "#7c4dff", A400: "#651fff", A700: "#6200ea" } },
  { id: "indigo", name: "Indigo", s: { 50: "#e8eaf6", 100: "#c5cae9", 200: "#9fa8da", 300: "#7986cb", 400: "#5c6bc0", 500: "#3f51b5", 600: "#3949ab", 700: "#303f9f", 800: "#283593", 900: "#1a237e", A100: "#8c9eff", A200: "#536dfe", A400: "#3d5afe", A700: "#304ffe" } },
  { id: "blue", name: "Blue", s: { 50: "#e3f2fd", 100: "#bbdefb", 200: "#90caf9", 300: "#64b5f6", 400: "#42a5f5", 500: "#2196f3", 600: "#1e88e5", 700: "#1976d2", 800: "#1565c0", 900: "#0d47a1", A100: "#82b1ff", A200: "#448aff", A400: "#2979ff", A700: "#2962ff" } },
  { id: "light-blue", name: "Light Blue", s: { 50: "#e1f5fe", 100: "#b3e5fc", 200: "#81d4fa", 300: "#4fc3f7", 400: "#29b6f6", 500: "#03a9f4", 600: "#039be5", 700: "#0288d1", 800: "#0277bd", 900: "#01579b", A100: "#80d8ff", A200: "#40c4ff", A400: "#00b0ff", A700: "#0091ea" } },
  { id: "cyan", name: "Cyan", s: { 50: "#e0f7fa", 100: "#b2ebf2", 200: "#80deea", 300: "#4dd0e1", 400: "#26c6da", 500: "#00bcd4", 600: "#00acc1", 700: "#0097a7", 800: "#00838f", 900: "#006064", A100: "#84ffff", A200: "#18ffff", A400: "#00e5ff", A700: "#00b8d4" } },
  { id: "teal", name: "Teal", s: { 50: "#e0f2f1", 100: "#b2dfdb", 200: "#80cbc4", 300: "#4db6ac", 400: "#26a69a", 500: "#009688", 600: "#00897b", 700: "#00796b", 800: "#00695c", 900: "#004d40", A100: "#a7ffeb", A200: "#64ffda", A400: "#1de9b6", A700: "#00bfa5" } },
  { id: "green", name: "Green", s: { 50: "#e8f5e9", 100: "#c8e6c9", 200: "#a5d6a7", 300: "#81c784", 400: "#66bb6a", 500: "#4caf50", 600: "#43a047", 700: "#388e3c", 800: "#2e7d32", 900: "#1b5e20", A100: "#b9f6ca", A200: "#69f0ae", A400: "#00e676", A700: "#00c853" } },
  { id: "light-green", name: "Light Green", s: { 50: "#f1f8e9", 100: "#dcedc8", 200: "#c5e1a5", 300: "#aed581", 400: "#9ccc65", 500: "#8bc34a", 600: "#7cb342", 700: "#689f38", 800: "#558b2f", 900: "#33691e", A100: "#ccff90", A200: "#b2ff59", A400: "#76ff03", A700: "#64dd17" } },
  { id: "lime", name: "Lime", s: { 50: "#f9fbe7", 100: "#f0f4c3", 200: "#e6ee9c", 300: "#dce775", 400: "#d4e157", 500: "#cddc39", 600: "#c0ca33", 700: "#afb42b", 800: "#9e9d24", 900: "#827717", A100: "#f4ff81", A200: "#eeff41", A400: "#c6ff00", A700: "#aeea00" } },
  { id: "yellow", name: "Yellow", s: { 50: "#fffde7", 100: "#fff9c4", 200: "#fff59d", 300: "#fff176", 400: "#ffee58", 500: "#ffeb3b", 600: "#fdd835", 700: "#fbc02d", 800: "#f9a825", 900: "#f57f17", A100: "#ffff8d", A200: "#ffff00", A400: "#ffea00", A700: "#ffd600" } },
  { id: "amber", name: "Amber", s: { 50: "#fff8e1", 100: "#ffecb3", 200: "#ffe082", 300: "#ffd54f", 400: "#ffca28", 500: "#ffc107", 600: "#ffb300", 700: "#ffa000", 800: "#ff8f00", 900: "#ff6f00", A100: "#ffe57f", A200: "#ffd740", A400: "#ffc400", A700: "#ffab00" } },
  { id: "orange", name: "Orange", s: { 50: "#fff3e0", 100: "#ffe0b2", 200: "#ffcc80", 300: "#ffb74d", 400: "#ffa726", 500: "#ff9800", 600: "#fb8c00", 700: "#f57c00", 800: "#ef6c00", 900: "#e65100", A100: "#ffd180", A200: "#ffab40", A400: "#ff9100", A700: "#ff6d00" } },
  { id: "deep-orange", name: "Deep Orange", s: { 50: "#fbe9e7", 100: "#ffccbc", 200: "#ffab91", 300: "#ff8a65", 400: "#ff7043", 500: "#ff5722", 600: "#f4511e", 700: "#e64a19", 800: "#d84315", 900: "#bf360c", A100: "#ff9e80", A200: "#ff6e40", A400: "#ff3d00", A700: "#dd2c00" } },
  { id: "brown", name: "Brown", s: { 50: "#efebe9", 100: "#d7ccc8", 200: "#bcaaa4", 300: "#a1887f", 400: "#8d6e63", 500: "#795548", 600: "#6d4c41", 700: "#5d4037", 800: "#4e342e", 900: "#3e2723" } },
  { id: "grey", name: "Grey", s: { 50: "#fafafa", 100: "#f5f5f5", 200: "#eeeeee", 300: "#e0e0e0", 400: "#bdbdbd", 500: "#9e9e9e", 600: "#757575", 700: "#616161", 800: "#424242", 900: "#212121" } },
  { id: "blue-grey", name: "Blue Grey", s: { 50: "#eceff1", 100: "#cfd8dc", 200: "#b0bec5", 300: "#90a4ae", 400: "#78909c", 500: "#607d8b", 600: "#546e7a", 700: "#455a64", 800: "#37474f", 900: "#263238" } },
];

export const SWATCH_IDS = SWATCHES.map((s) => s.id);
export const DEFAULT_PAIR = { primary: "indigo", accent: "pink" };

const GREY = SWATCHES.find((s) => s.id === "grey").s;
const AMBER = SWATCHES.find((s) => s.id === "amber").s;
const GREEN = SWATCHES.find((s) => s.id === "green").s;
const RED = SWATCHES.find((s) => s.id === "red").s;
const BLUE = SWATCHES.find((s) => s.id === "blue").s;

export function swatch(id) {
  return SWATCHES.find((s) => s.id === id) || null;
}

/** A swatch can be an accent when it has A-shades (Brown, Grey and Blue Grey cannot). */
export function canBeAccent(id) {
  const s = swatch(id);
  return !!(s && s.s.A200);
}

/** Resolve a stored pair; invalid or missing parts fall back to the default. */
export function normalisePair(input) {
  const obj = input && typeof input === "object" ? input : {};
  let primary = SWATCH_IDS.includes(obj.primary) ? obj.primary : DEFAULT_PAIR.primary;
  let accent = canBeAccent(obj.accent) ? obj.accent : DEFAULT_PAIR.accent;
  if (accent === primary) accent = primary === "pink" ? "indigo" : canBeAccent("pink") ? "pink" : "indigo";
  return { primary, accent };
}

/** "indigo_pink" ↔ {primary, accent}; legacy theme ids map to a pair. */
const LEGACY = {
  graphite: { primary: "blue-grey", accent: "deep-orange" },
  fynbos: { primary: "deep-purple", accent: "amber" },
  indigo: { primary: "indigo", accent: "pink" },
  lagoon: { primary: "cyan", accent: "indigo" },
  cocoa: { primary: "brown", accent: "cyan" },
  contrast: { primary: "grey", accent: "pink" },
};
export function pairFromSlug(slug) {
  if (!slug || typeof slug !== "string") return { ...DEFAULT_PAIR };
  if (LEGACY[slug]) return { ...LEGACY[slug] };
  const [primary, accent] = slug.split("_");
  return normalisePair({ primary, accent });
}
export function slugFromPair(pair) {
  const p = normalisePair(pair);
  return `${p.primary}_${p.accent}`;
}

// ------------------------------------------------------------------ maths

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}
/** `top` at `alpha` over `bottom`, flattened to hex (what the eye sees). */
export function over(top, alpha, bottom) {
  const t = hexToRgb(top), b = hexToRgb(bottom);
  return rgbToHex(t.map((v, i) => v * alpha + b[i] * (1 - alpha)));
}
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Material's rule for text on a colour: white or 87 % black, whichever reads better. */
export function onColor(hex) {
  const white = "#ffffff";
  const ink = over("#000000", 0.87, hex);
  return contrast(white, hex) >= contrast(ink, hex) ? white : ink;
}
/** The primary as text on a light surface: the first of 500, 700, 800, 900
 * that reads at 4.5:1; light primaries (Yellow, Amber, Orange) fall back to ink. */
function readableOnLight(s, surface = "#ffffff") {
  for (const k of [500, 700, 800, 900]) if (contrast(s[k], surface) >= 4.5) return s[k];
  return over("#000000", 0.87, surface);
}
/** The primary as text on a dark surface: 200, else 100, else 50. */
function readableOnDark(s, surface) {
  for (const k of [200, 100, 50]) if (contrast(s[k], surface) >= 4.5) return s[k];
  return s[50];
}

// ----------------------------------------------------------------- shadows (dp)

export const SHADOWS = {
  1: "0 1px 1px 0 rgba(0,0,0,.14), 0 2px 1px -1px rgba(0,0,0,.12), 0 1px 3px 0 rgba(0,0,0,.20)",
  2: "0 2px 2px 0 rgba(0,0,0,.14), 0 3px 1px -2px rgba(0,0,0,.12), 0 1px 5px 0 rgba(0,0,0,.20)",
  4: "0 4px 5px 0 rgba(0,0,0,.14), 0 1px 10px 0 rgba(0,0,0,.12), 0 2px 4px -1px rgba(0,0,0,.20)",
  8: "0 8px 10px 1px rgba(0,0,0,.14), 0 3px 14px 2px rgba(0,0,0,.12), 0 5px 5px -3px rgba(0,0,0,.20)",
  16: "0 16px 24px 2px rgba(0,0,0,.14), 0 6px 30px 5px rgba(0,0,0,.12), 0 8px 10px -5px rgba(0,0,0,.20)",
  24: "0 24px 38px 3px rgba(0,0,0,.14), 0 9px 46px 8px rgba(0,0,0,.12), 0 11px 15px -7px rgba(0,0,0,.20)",
};

/** Dark theme surfaces: #121212 lightened by the white overlay for the dp level. */
const DARK_BASE = "#121212";
const OVERLAY = { 0: 0, 1: 0.05, 2: 0.07, 3: 0.08, 4: 0.09, 6: 0.11, 8: 0.12, 12: 0.14, 16: 0.15, 24: 0.16 };
export function darkSurface(dp) {
  return over("#ffffff", OVERLAY[dp] ?? 0, DARK_BASE);
}

// ------------------------------------------------------------------ tokens

/**
 * Every token the app uses, for a swatch pair and a mode. Values are flat hex
 * (translucent Material values are composited onto the surface they sit on)
 * except the shadows and the state layers.
 */
export function tokensFor(pairInput, mode) {
  const pair = normalisePair(pairInput);
  const P = swatch(pair.primary).s;
  const A = swatch(pair.accent).s;
  const L = mode !== "dark";

  // Surfaces
  const background = L ? GREY[50] : darkSurface(0);
  const card = L ? "#ffffff" : darkSurface(1);
  const nested = L ? GREY[100] : darkSurface(2);
  const high = L ? GREY[200] : darkSurface(8);
  const highest = L ? GREY[300] : darkSurface(24);
  const popover = L ? "#ffffff" : darkSurface(8);
  const appBarSurface = L ? P[500] : darkSurface(4);
  const drawer = L ? "#ffffff" : darkSurface(16);

  // Text (Material: 87 / 60 / 38 %)
  const inkOn = (surface) => (L ? over("#000000", 0.87, surface) : over("#ffffff", 0.87, surface));
  const mutedOn = (surface) => (L ? over("#000000", 0.6, surface) : over("#ffffff", 0.6, surface));
  const faintOn = (surface) => (L ? over("#000000", 0.38, surface) : over("#ffffff", 0.38, surface));
  const text = inkOn(card);
  const muted = mutedOn(card);
  const faint = faintOn(card);
  const divider = L ? over("#000000", 0.12, card) : over("#ffffff", 0.12, card);
  const outline = L ? over("#000000", 0.38, card) : over("#ffffff", 0.38, card);

  // Primary (500 light / 200 dark), its variants and text
  const primary = L ? P[500] : P[200];
  const onPrimary = onColor(primary);
  const primaryHover = L ? P[600] : P[300];
  const primaryDark = P[700];
  const primaryLight = P[100];
  const primaryText = L ? readableOnLight(P) : readableOnDark(P, over(primary, 0.12, darkSurface(16)));
  const primaryTint = (surface, a) => over(primary, a, surface);

  // Accent (A200 both modes)
  const accent = A.A200;
  const onAccent = onColor(accent);

  // State layers on rows (Material data table: hover #eeeeee, selected #f5f5f5; dark overlays)
  const rowHover = L ? GREY[200] : over("#ffffff", 0.08, card);
  const rowSelected = L ? GREY[100] : over("#ffffff", 0.12, card);

  // Meaning colours: swatch 100 fill with ink text (light), the 200 shade on
  // a 20 % tint (dark). Solids (dots, success/warning fills) use the darkest
  // Material shade that still reads as that colour and carries white text at
  // 4.5:1: Green 800, Red 700, Blue 700; amber has no such shade, so its
  // solid is Orange 800 with ink text.
  const sem = (S, solid) =>
    L
      ? { text: inkOn(S[100]), soft: S[100], solid, dot: solid, onSolid: onColor(solid) }
      : { text: S[200], soft: over(S[200], 0.2, card), solid: S[200], dot: S[200], onSolid: onColor(S[200]) };
  const ORANGE = SWATCHES.find((s) => s.id === "orange").s;
  const green = sem(GREEN, GREEN[800]), amber = sem(AMBER, ORANGE[800]), red = sem(RED, RED[700]), blue = sem(BLUE, BLUE[700]);
  const grey = L ? { text: muted, soft: GREY[200], solid: GREY[600] } : { text: muted, soft: over("#ffffff", 0.12, card), solid: GREY[500] };
  const error = L ? "#b00020" : "#cf6679";

  const heat = L
    ? [AMBER[100], AMBER[200], AMBER[300], AMBER[400], AMBER[500]]
    : [AMBER[900], AMBER[800], AMBER[700], AMBER[600], AMBER[500]];

  return {
    // surfaces
    background, "surface-canvas": background, card, "surface-nested": nested, "surface-low": nested,
    "surface-container": high, "surface-high": high, "surface-highest": highest, "surface-lowest": card,
    "surface-dim": L ? GREY[200] : darkSurface(0), "surface-bright": L ? "#ffffff" : darkSurface(24),
    popover, "popover-foreground": text,
    sidebar: drawer, "app-bar": appBarSurface, "app-bar-foreground": L ? onColor(P[500]) : inkOn(appBarSurface),
    "inverse-surface": L ? GREY[900] : GREY[100], "inverse-foreground": L ? "#ffffff" : GREY[900],
    // text and lines
    foreground: text, "card-foreground": text, "muted-foreground": muted, "faint-foreground": faint,
    border: divider, "border-strong": outline, "table-rule": divider, input: outline,
    control: card, "control-hover": nested, "control-border": outline,
    // primary
    primary, "primary-foreground": onPrimary, "primary-hover": primaryHover, "primary-text": primaryText,
    "primary-dark": primaryDark, "primary-light": primaryLight,
    "primary-soft": L ? primaryLight : primaryTint(card, 0.24), "primary-container": L ? primaryLight : primaryTint(card, 0.24),
    "on-primary-container": L ? P[900] : primaryText,
    ring: primary, "selection-ring": primary, "selection-row": rowSelected, "surface-hover": rowHover,
    "state-hover": L ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.08)", "state-focus": L ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.12)",
    // secondary (chips) and accent
    secondary: L ? GREY[300] : over("#ffffff", 0.12, card), "secondary-foreground": text,
    "secondary-container": L ? primaryLight : primaryTint(card, 0.24), "on-secondary-container": L ? P[900] : primaryText,
    tertiary: accent, "on-tertiary": onAccent, "tertiary-container": A.A100, "on-tertiary-container": over("#000000", 0.87, A.A100),
    highlight: accent, "highlight-foreground": onAccent, "highlight-on-dark": accent, "highlight-on-dark-foreground": onAccent,
    "highlight-on-primary": accent, "highlight-on-primary-foreground": onAccent,
    "highlight-soft": A.A100, "on-highlight-soft": over("#000000", 0.87, A.A100),
    accent: nested, "accent-foreground": text, muted: nested,
    // table head: Material data tables have no fill; header text is secondary
    "table-head": card, "table-head-foreground": muted,
    // navigation drawer
    "sidebar-foreground": inkOn(drawer), "sidebar-muted": mutedOn(drawer),
    "sidebar-primary": primaryTint(drawer, 0.12),
    "sidebar-primary-foreground": L ? readableOnLight(P, primaryTint(drawer, 0.12)) : readableOnDark(P, primaryTint(drawer, 0.12)),
    "sidebar-accent": L ? over("#000000", 0.04, drawer) : over("#ffffff", 0.08, drawer), "sidebar-accent-foreground": inkOn(drawer),
    "sidebar-border": L ? over("#000000", 0.12, drawer) : over("#ffffff", 0.12, drawer), "sidebar-ring": primary,
    // meaning
    "green-text": green.text, "green-soft": green.soft, "green-solid": green.solid, "green-dot": green.dot, "green-on-solid": green.onSolid,
    "amber-text": amber.text, "amber-soft": amber.soft, "amber-solid": amber.solid, "amber-dot": amber.dot, "amber-on-solid": amber.onSolid,
    "red-text": red.text, "red-soft": red.soft, "red-solid": red.solid, "red-dot": red.dot, "red-on-solid": red.onSolid,
    "blue-text": blue.text, "blue-soft": blue.soft, "blue-solid": blue.solid, "blue-dot": blue.dot, "blue-on-solid": blue.onSolid,
    "grey-text": grey.text, "grey-soft": grey.soft, "grey-solid": grey.solid, "grey-on-solid": onColor(grey.solid),
    "on-solid": "#ffffff",
    destructive: error, "destructive-foreground": onColor(error),
    success: green.solid, "success-foreground": green.onSolid,
    warning: amber.solid, "warning-foreground": amber.onSolid,
    info: blue.solid, "info-foreground": blue.onSolid,
    "direction-in": blue.solid, "direction-out": grey.solid,
    "pill-ring": "transparent",
    "status-neutral-bg": grey.soft, "status-neutral-fg": text, "status-neutral-dot": grey.solid,
    "status-amber-bg": amber.soft, "status-amber-fg": amber.text, "status-amber-dot": amber.dot,
    "status-green-bg": green.soft, "status-green-fg": green.text, "status-green-dot": green.dot,
    "status-green-muted-bg": "transparent", "status-green-muted-fg": L ? GREEN[800] : GREEN[200], "status-green-muted-dot": green.dot,
    "status-red-bg": L ? RED[600] : RED[200], "status-red-fg": onColor(L ? RED[600] : RED[200]), "status-red-dot": onColor(L ? RED[600] : RED[200]),
    "status-red-muted-bg": grey.soft, "status-red-muted-fg": L ? RED[800] : RED[200], "status-red-muted-dot": red.dot,
    "status-blue-bg": blue.soft, "status-blue-fg": blue.text, "status-blue-dot": blue.dot,
    // heat
    "heat-0": "transparent", "heat-1": heat[0], "heat-2": heat[1], "heat-3": heat[2], "heat-4": heat[3], "heat-5": heat[4],
    "heat-text": over("#000000", 0.87, "#ffffff"),
    // charts
    "chart-1": primary, "chart-2": amber.solid, "chart-3": blue.solid, "chart-4": grey.solid, "chart-5": red.solid,
    // legacy ramp
    "ink-950": L ? GREY[900] : GREY[50], "ink-900": L ? GREY[900] : GREY[100], "ink-800": L ? GREY[800] : GREY[200],
    "ink-700": L ? GREY[700] : GREY[300], "ink-600": L ? GREY[600] : GREY[400], "ink-500": GREY[500],
    "ink-400": L ? GREY[400] : GREY[600], "ink-300": L ? GREY[300] : GREY[700], "ink-200": L ? GREY[200] : GREY[800],
    "ink-100": L ? GREY[100] : GREY[900], "paper-50": background, "paper-0": card,
    // shape and elevation (dp)
    radius: "4px",
    "shadow-1dp": SHADOWS[1], "shadow-2dp": SHADOWS[2], "shadow-4dp": SHADOWS[4], "shadow-8dp": SHADOWS[8], "shadow-16dp": SHADOWS[16], "shadow-24dp": SHADOWS[24],
    "shadow-card": SHADOWS[1], "shadow-raised": SHADOWS[2], "shadow-overlay": SHADOWS[8],
  };
}

/** Inline-style form: { "--background": "#fafafa", … }. */
export function cssVars(tokens) {
  const out = {};
  for (const [k, v] of Object.entries(tokens)) out[`--${k}`] = v;
  return out;
}

/** The materialpalette.com summary for a pair (light). */
export function paletteSummary(pairInput) {
  const pair = normalisePair(pairInput);
  const P = swatch(pair.primary).s, A = swatch(pair.accent).s;
  return [
    { label: "Dark primary color", hex: P[700], on: onColor(P[700]) },
    { label: "Light primary color", hex: P[100], on: onColor(P[100]) },
    { label: "Primary color", hex: P[500], on: onColor(P[500]) },
    { label: "Text / icons", hex: onColor(P[500]), on: P[500] },
    { label: "Accent color", hex: A.A200, on: onColor(A.A200) },
    { label: "Primary text", hex: "#212121", on: "#ffffff" },
    { label: "Secondary text", hex: "#757575", on: "#ffffff" },
    { label: "Divider color", hex: "#bdbdbd", on: "#212121" },
  ];
}
