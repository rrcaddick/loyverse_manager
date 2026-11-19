/**
 * Change group: put this booking in another group (a search over names,
 * aliases, references and contacts) or give it a group of its own. Used when
 * the matcher linked wrongly or never suggested the right group (2 Nov 2026).
 */

import { Search, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api";
import { formatDateShort, pluralise } from "@/lib/format";

import { useGroupSearch, useSetGroup } from "../../api";
import { useGroupTypeLabel } from "../../lib";
import type { BookingDetail } from "../../types";

export function GroupPickerDialog({ booking, open, onOpenChange }: { booking: BookingDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-section">Change group</DialogTitle>
          <DialogDescription>The group is the thing that comes back; its other bookings are this record's history.</DialogDescription>
        </DialogHeader>
        {open ? <Body booking={booking} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({ booking, onDone }: { booking: BookingDetail; onDone: () => void }) {
  const [q, setQ] = useState("");
  const search = useGroupSearch(q.trim());
  const setGroup = useSetGroup(booking.id);
  const groupType = useGroupTypeLabel();
  const rows = (search.data?.items ?? []).filter((g) => g.id !== booking.group?.id);
  const ownOnly = !!booking.group && booking.group.bookings <= 1;

  async function choose(input: { group_id: number } | { new: true }) {
    try {
      await setGroup.mutateAsync(input);
      toast.success("new" in input ? "Now a group of its own" : "Group changed");
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Group, reference or contact" aria-label="Search groups" className="pl-9" />
      </div>
      <ul className="max-h-80 overflow-y-auto rounded-lg ring-1 ring-border scrollbar-thin" aria-busy={search.isFetching}>
        {search.isPending ? (
          <li className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
            <Spinner /> Looking…
          </li>
        ) : rows.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted-foreground">No other group matches.</li>
        ) : (
          rows.map((g) => (
            <li key={g.id} className="border-b border-border last:border-b-0">
              <button type="button" disabled={setGroup.isPending} onClick={() => choose({ group_id: g.id })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-nested focus-visible:bg-nested focus-visible:outline-none disabled:opacity-60">
                <Users aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-foreground">{g.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {[g.area, g.group_type ? groupType(g.group_type) : null, pluralise(g.bookings, "booking")].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {g.last_reference ? (
                  <span className="shrink-0 text-right text-sm text-muted-foreground">
                    <span className="block font-mono">{g.last_reference}</span>
                    {g.last_visit_date ? <span className="block">{formatDateShort(g.last_visit_date)} {g.last_visit_date.slice(0, 4)}</span> : null}
                  </span>
                ) : null}
              </button>
            </li>
          ))
        )}
      </ul>
      <DialogFooter className="sm:justify-between">
        <Button variant="outline" disabled={setGroup.isPending || ownOnly} title={ownOnly ? "This booking is already the only one in its group" : undefined} onClick={() => choose({ new: true })}>
          A group of its own
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Close
        </Button>
      </DialogFooter>
    </div>
  );
}
