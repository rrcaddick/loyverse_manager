/**
 * The capacity ramp: five fixed bands of the daily capacity setting C.
 *
 *   1–9 % → 1, 10–24 % → 2, 25–49 % → 3, 50–74 % → 4, ≥ 75 % → 5
 *   (C = 1 000: 1–99, 100–249, 250–499, 500–749, 750+)
 *
 * The fill is `--heat-N` (tokens.css): one hue, light → dark, ink text on
 * every step. Never relative to the month, so a colour means the same
 * headcount in March as in December.
 */

/** Managers cannot read GET /settings; the calendar falls back to this. */
export const DEFAULT_CAPACITY = 1000;

export type HeatLevel = 0 | 1 | 2 | 3 | 4 | 5;

/** Where bands 2…5 start, as a fraction of capacity. */
export const HEAT_FRACTIONS = [0.1, 0.25, 0.5, 0.75] as const;

/** Lower bounds of bands 1…5 for a capacity: [1, 100, 250, 500, 750]. */
export function heatThresholds(capacity: number): number[] {
  const c = capacity > 0 ? capacity : DEFAULT_CAPACITY;
  return [1, ...HEAT_FRACTIONS.map((f) => Math.round(c * f))];
}

export function heatLevel(totalPeople: number, capacity: number): HeatLevel {
  if (totalPeople <= 0) return 0;
  const [, b2, b3, b4, b5] = heatThresholds(capacity);
  if (totalPeople >= b5!) return 5;
  if (totalPeople >= b4!) return 4;
  if (totalPeople >= b3!) return 3;
  if (totalPeople >= b2!) return 2;
  return 1;
}

/** Legend labels for the six swatches: ["0", "<100", "100", "250", "500", "750+"]. */
export function heatLegendLabels(capacity: number, formatNumber: (n: number) => string): string[] {
  const [, b2, b3, b4, b5] = heatThresholds(capacity);
  return ["0", `<${formatNumber(b2!)}`, formatNumber(b2!), formatNumber(b3!), formatNumber(b4!), `${formatNumber(b5!)}+`];
}
