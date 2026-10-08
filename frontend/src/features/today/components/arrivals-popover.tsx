/**
 * The inline "Enter" for arrivals (spec §5 day view): a small popover with a
 * number input and Save (POST /bookings/:id/arrivals, source "manual"), plus
 * "Fetch from Loyverse" (GET …/arrivals, which only reports) — the fetched
 * count fills the input and saving it records the source as "loyverse".
 */

import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { ArrivalSource } from "@/features/bookings/types";
import { errorMessage } from "@/lib/api";
import { formatNumber, pluralise } from "@/lib/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { useFetchArrivalsFor, useRecordArrivalsFor } from "../api";
import type { DayGroupRow } from "../types";

interface ArrivalsPopoverProps {
  row: DayGroupRow;
  open: boolean;
  /** Fetch from Loyverse as soon as the popover opens (the ⋯ menu's "Fetch from Loyverse"). */
  autoFetch: boolean;
  onOpenChange: (open: boolean) => void;
  /** The cell content the popover anchors to. */
  anchor: ReactNode;
}

export function ArrivalsPopover({ row, open, autoFetch, onOpenChange, anchor }: ArrivalsPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverContent align="start" className="w-80 p-3" onClick={(event) => event.stopPropagation()}>
        {open ? <ArrivalsForm key={row.id} row={row} autoFetch={autoFetch} onClose={() => onOpenChange(false)} /> : null}
      </PopoverContent>
    </Popover>
  );
}

function ArrivalsForm({ row, autoFetch, onClose }: { row: DayGroupRow; autoFetch: boolean; onClose: () => void }) {
  const record = useRecordArrivalsFor(row.id);
  const fetchArrivals = useFetchArrivalsFor(row.id);
  const [value, setValue] = useState(String(row.arrived_count ?? row.people_booked));
  const [fetched, setFetched] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function fromLoyverse() {
    setError(null);
    try {
      const result = await fetchArrivals.mutateAsync();
      setFetched(result.count);
      setValue(String(result.count));
    } catch (err) {
      setError(errorMessage(err, "Loyverse could not be reached"));
    }
  }

  useEffect(() => {
    if (autoFetch && !started.current) {
      started.current = true;
      void fromLoyverse();
    }
    // Runs once on open; fromLoyverse only reads the row's id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]);

  const count = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(count) && count >= 0;
  const source: ArrivalSource = fetched !== null && count === fetched ? "loyverse" : "manual";

  async function save() {
    if (!valid) return;
    setError(null);
    try {
      const detail = await record.mutateAsync({ count, source });
      toast.success(`${formatNumber(count)} arrivals recorded for ${row.reference}`, {
        description: detail.status === "completed" && row.status !== "completed" ? `${row.group_name} is now completed.` : row.group_name,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div>
        <div className="text-body font-medium text-foreground">Arrivals · {row.reference}</div>
        <div className="text-sm text-muted-foreground tabular">
          {row.group_name} · {pluralise(row.people_booked, "person", "people")} booked
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg bg-nested px-3 py-2">
        <span className="text-sm tabular" aria-live="polite">
          {fetchArrivals.isPending ? "Asking Loyverse…" : fetched !== null ? <>Loyverse counted <span className="font-semibold">{formatNumber(fetched)}</span></> : "From the tills"}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => void fromLoyverse()} disabled={fetchArrivals.isPending}>
          {fetchArrivals.isPending ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
          Fetch from Loyverse
        </Button>
      </div>

      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-label text-muted-foreground uppercase">People arrived</span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="tabular"
            autoFocus
            aria-invalid={!valid}
          />
        </label>
        <Button type="submit" disabled={!valid || record.isPending}>
          {record.isPending ? <Spinner data-icon="inline-start" /> : null}
          Save
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-red-text" role="alert">
          {error}
        </p>
      ) : null}
      <p className={cn("text-xs text-muted-foreground", source === "loyverse" && "text-green-text")}>
        {source === "loyverse" ? "Recorded as counted by Loyverse." : "Recorded as a manual count."}
        {row.status === "confirmed" ? " A count above zero completes the booking." : ""}
      </p>
    </form>
  );
}
