/**
 * /today and /today/:date — PLACEHOLDER for the Today + Work + Gate agent.
 *
 * Spec: docs/redesign-spec.md §3 (Today) and §5 (day view). Until the new
 * screen lands this renders the first build's day view, which already has the
 * tiles and per-group rows and reads the same `:date` param (today when it
 * is absent). Replace this file; keep the default export and the route.
 *
 * Foundation pieces to use: BigNumber (tiles), SectionHeader, NextStepStrip,
 * DataTable (44 px rows), StatusPill, EmptyState, toastWithUndo.
 */

import DayPage from "@/pages/calendar/DayPage";

export default function TodayPage() {
  return <DayPage />;
}
