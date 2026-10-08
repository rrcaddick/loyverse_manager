/**
 * /request/visit — PLACEHOLDER for the Public form + Settings agent.
 *
 * Spec: docs/redesign-spec.md §11 and docs/research/06: three question
 * screens plus Check, answers in sessionStorage, "Step N of 3". Until the
 * stepped form lands every step renders the current single-page form so the
 * public route keeps working. Replace this file; keep the default export.
 */

import RequestPage from "@/pages/public/RequestPage";

export default function RequestVisitPage() {
  return <RequestPage />;
}
