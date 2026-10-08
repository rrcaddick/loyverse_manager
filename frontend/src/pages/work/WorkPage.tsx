/**
 * /work — PLACEHOLDER for the Today + Work + Gate agent.
 *
 * Spec: docs/redesign-spec.md §4. One list, kinds in a KindRail with counts
 * (hidden at zero), 56 px rows with one filled verb, keys 1/2, undo toasts,
 * detail beside the list. Until then this renders the first build's queue so
 * the route keeps working. Replace this file; keep the default export.
 *
 * Foundation pieces to use: KindRail, EdgeBar, StatusPill, NextStepStrip,
 * EmptyState, toastWithUndo, useShortcut, invalidateNavCounts.
 */

import QueuePage from "@/pages/queue/QueuePage";

export default function WorkPage() {
  return <QueuePage />;
}
