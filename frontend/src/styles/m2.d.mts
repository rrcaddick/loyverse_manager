export interface Swatch { id: string; name: string; s: Record<string, string> }
export interface Pair { primary: string; accent: string }
export const SWATCHES: Swatch[];
export const SWATCH_IDS: string[];
export const DEFAULT_PAIR: Pair;
export const SHADOWS: Record<number, string>;
export function swatch(id: string): Swatch | null;
export function canBeAccent(id: string): boolean;
export function normalisePair(input: unknown): Pair;
export function pairFromSlug(slug: string | null | undefined): Pair;
export function slugFromPair(pair: Pair): string;
export function tokensFor(pair: Pair, mode: "light" | "dark"): Record<string, string>;
export function cssVars(tokens: Record<string, string>): Record<string, string>;
export function paletteSummary(pair: Pair): { label: string; hex: string; on: string }[];
export function onColor(hex: string): string;
export function contrast(a: string, b: string): number;
export function over(top: string, alpha: number, bottom: string): string;
export function darkSurface(dp: number): string;
