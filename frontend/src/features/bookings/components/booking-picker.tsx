/**
 * Find a booking by reference or group name and pick it: the shared piece
 * behind "Move to another booking" and "Attach to booking".
 */

import { Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/format";
import type { Paginated } from "@/types/api";

import { useBookings } from "../api";
import type { BookingListItem } from "../types";

export interface BookingPickerProps {
  /** Bookings never offered (the one we are on). */
  excludeIds?: number[];
  actionLabel: string;
  busy?: boolean;
  onPick: (booking: BookingListItem) => void | Promise<void>;
  /** Shown above the search box. */
  intro?: string;
}

export function BookingPicker({ excludeIds = [], actionLabel, busy = false, onPick, intro }: BookingPickerProps) {
  const [q, setQ] = useState("");
  const results = useBookings({ q: q.trim(), page: 1, page_size: 8, status: "active" }, q.trim().length >= 2);
  const items = ((results.data as Paginated<BookingListItem> | undefined)?.items ?? []).filter((b) => !excludeIds.includes(b.id));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {intro ? <p className="text-sm text-muted-foreground">{intro}</p> : null}
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference or group name" className="pl-9" aria-label="Find a booking" />
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-lg ring-1 ring-border scrollbar-thin">
        {q.trim().length < 2 ? (
          <li className="p-3 text-sm text-muted-foreground">Type a reference or a group name.</li>
        ) : results.isPending ? (
          <li className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <Spinner /> Searching…
          </li>
        ) : items.length === 0 ? (
          <li className="p-3 text-sm text-muted-foreground">No booking matches.</li>
        ) : (
          items.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-20 shrink-0 font-semibold tabular text-foreground">{b.reference}</span>
              <span className="min-w-0 flex-1 truncate text-body text-foreground">{b.group_name}</span>
              <span className="text-sm tabular text-muted-foreground">{formatDate(b.visit_date)}</span>
              <Button size="sm" disabled={busy} onClick={() => void onPick(b)}>
                {actionLabel}
              </Button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
