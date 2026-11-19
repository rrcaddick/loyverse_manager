/**
 * How many week rows fit the viewport without a page scrollbar.
 *
 * Budget (root 16–18 px): header 56–63 + toolbar 44 + weekday headers 24 +
 * legend 28 + grid padding 12 + (N − 1) × 6 gaps + N × 104 px minimum rows.
 *   7 rows need ≥ 928 px → used from 1080 (rows 124 px at 1920×1080)
 *   6 rows need ≥ 818 px → used from 840 (rows 116 px at 1440×900)
 *   5 rows otherwise (rows 104 px at 720)
 */

import { useEffect, useState } from "react";

const BREAKS: [string, number][] = [
  ["(min-height: 1080px)", 7],
  ["(min-height: 840px)", 6],
];

function compute(): number {
  if (typeof window === "undefined") return 6;
  for (const [query, rows] of BREAKS) if (window.matchMedia(query).matches) return rows;
  return 5;
}

export function useViewportRows(): number {
  const [rows, setRows] = useState(compute);
  useEffect(() => {
    const lists = BREAKS.map(([query]) => window.matchMedia(query));
    const update = () => setRows(compute());
    for (const list of lists) list.addEventListener("change", update);
    return () => {
      for (const list of lists) list.removeEventListener("change", update);
    };
  }, []);
  return rows;
}
