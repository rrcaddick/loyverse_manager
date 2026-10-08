/**
 * /mail and /mail/:thrid — PLACEHOLDER for the Mail + Bank agent.
 *
 * Spec: docs/redesign-spec.md §7: queues over conversations (Needs reply,
 * Unmatched, Waiting on customer, Done, All mail), the Conversation and
 * Composer components, the context panel. Until then this renders the first
 * build's inbox list so the route keeps working; the reading pane returns
 * with the new page because it keyed on /inbox/:messageId. Replace this
 * file; keep the default export.
 *
 * Foundation pieces to use: KindRail, SegmentedTabs, EdgeBar, StatusPill,
 * EmptyState, toastWithUndo, useShortcut ("j", "k", "e", "mod+enter").
 */

import InboxPage from "@/pages/inbox/InboxPage";

export default function MailPage() {
  return <InboxPage />;
}
