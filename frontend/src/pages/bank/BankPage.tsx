/**
 * /bank — PLACEHOLDER for the Mail + Bank agent.
 *
 * Spec: docs/redesign-spec.md §8: one summary line, tabs Needs attention /
 * Matched / All entries, Xero-style rows with the proposal card and a green
 * Match, no modals, undo toasts. Until then this renders the first build's
 * payments page (its `?tx=` drawer still works). Replace this file; keep the
 * default export.
 *
 * Foundation pieces to use: SegmentedTabs, MoneyLadder, StatusPill,
 * EmptyState, toastWithUndo, toastWithAction, invalidateNavCounts.
 */

import PaymentsPage from "@/pages/payments/PaymentsPage";

export default function BankPage() {
  return <PaymentsPage />;
}
