/**
 * The capacity ramp: five fixed bands of the day's capacity C (Settings ›
 * Capacity, 1 500 by default).
 *
 *   1–9 % → 1, 10–24 % → 2, 25–49 % → 3, 50–74 % → 4, ≥ 75 % → 5
 *   (C = 1 500: 1–149, 150–374, 375–749, 750–1 124, 1 125+)
 *
 * The fill is `--heat-N` (tokens.css): five shades of one blue, light →
 * dark, ink text on every step. Never relative to the month, so a colour
 * means the same headcount in March as in December.
 */

/** Until the calendar response has loaded (it carries the setting). */
export const DEFAULT_CAPACITY = 1500;

export type HeatLevel = 0 | 1 | 2 | 3 | 4 | 5;

/** Where bands 2…5 start, as a fraction of capacity. */
export const HEAT_FRACTIONS = [0.1, 0.25, 0.5, 0.75] as const;

/** Lower bounds of bands 1…5 for a capacity: [1, 150, 375, 750, 1125]. */
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

/** Legend labels for the six swatches: ["0", "<150", "150", "375", "750", "1 125+"]. */
export function heatLegendLabels(capacity: number, formatNumber: (n: number) => string): string[] {
  const [, b2, b3, b4, b5] = heatThresholds(capacity);
  return ["0", `<${formatNumber(b2!)}`, formatNumber(b2!), formatNumber(b3!), formatNumber(b4!), `${formatNumber(b5!)}+`];
}
