import { StatusBadge } from "@/components/status-badge";

import { MATCH_STATUS_META, type MatchStatus } from "./types";

export function MatchStatusBadge({ status, className }: { status: MatchStatus; className?: string }) {
  const meta = MATCH_STATUS_META[status];
  return <StatusBadge status={status} label={meta.label} tone={meta.tone} className={className} />;
}
