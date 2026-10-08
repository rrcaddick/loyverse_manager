/**
 * Search-and-pick a booking (for matching a credit, attaching an email…).
 * Built on cmdk so arrow keys and Enter work; the server does the filtering.
 *
 *   const [booking, setBooking] = useState<BookingListItem | null>(null);
 *   <BookingPicker value={booking} onChange={setBooking} renderMeta={(b) => <FinanceLine b={b} />} />
 */

import { Check, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api";
import { formatMoney, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useBookingSearch, visitDateLabel, type BookingListItem } from "./bookings";

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface BookingPickerProps {
  value: BookingListItem | null;
  onChange: (booking: BookingListItem | null) => void;
  /** Second line under each result (finance for payments, contact for mail). */
  renderMeta?: (booking: BookingListItem) => ReactNode;
  /** Status filter passed to GET /bookings (e.g. "active"). */
  status?: string;
  placeholder?: string;
  initialQuery?: string;
  autoFocus?: boolean;
  /** Ids to leave out (e.g. the booking a message is already attached to). */
  excludeIds?: number[];
  className?: string;
}

export function BookingPicker({
  value,
  onChange,
  renderMeta,
  status,
  placeholder = "Search by reference, group or contact",
  initialQuery = "",
  autoFocus = true,
  excludeIds = [],
  className,
}: BookingPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const debounced = useDebounced(query);
  const search = useBookingSearch(debounced, { status });
  const results = (search.data?.items ?? []).filter((b) => !excludeIds.includes(b.id));
  const searching = debounced.trim().length > 0 && (search.isPending || search.isFetching);

  if (value) {
    return (
      <div className={cn("flex items-start justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5", className)}>
        <div className="min-w-0">
          <ResultLine booking={value} />
          {renderMeta ? <div className="mt-1 text-xs text-muted-foreground">{renderMeta(value)}</div> : null}
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Choose a different booking" onClick={() => onChange(null)}>
          <X />
        </Button>
      </div>
    );
  }

  return (
    <Command shouldFilter={false} loop className={cn("rounded-lg! border border-border bg-transparent p-0", className)}>
      <CommandInput value={query} onValueChange={setQuery} placeholder={placeholder} autoFocus={autoFocus} aria-label="Search bookings" />
      <CommandList className="max-h-64">
        {debounced.trim() === "" ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">Type a reference like FY1710, a group name or a contact.</div>
        ) : search.isError ? (
          <div className="px-3 py-6 text-center text-sm text-destructive" role="alert">
            {errorMessage(search.error)}
          </div>
        ) : searching && results.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Spinner /> Searching…
          </div>
        ) : (
          <>
            <CommandEmpty>No bookings match “{debounced.trim()}”.</CommandEmpty>
            {results.length > 0 ? (
              <CommandGroup heading={`${pluralise(search.data?.total ?? results.length, "booking")}${(search.data?.total ?? 0) > results.length ? " · refine to see more" : ""}`}>
                {results.map((booking) => (
                  <CommandItem key={booking.id} value={String(booking.id)} onSelect={() => onChange(booking)} className="items-start py-2">
                    <div className="min-w-0 flex-1">
                      <ResultLine booking={booking} />
                      {renderMeta ? <div className="mt-0.5 text-xs text-muted-foreground">{renderMeta(booking)}</div> : null}
                    </div>
                    <Check aria-hidden="true" className="mt-1 size-4 opacity-0" />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </>
        )}
      </CommandList>
    </Command>
  );
}

function ResultLine({ booking }: { booking: BookingListItem }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium tabular">{booking.reference}</span>
        <span className="min-w-0 truncate font-medium">{booking.group_name}</span>
        <StatusBadge status={booking.status} />
      </div>
      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular">
        <span>{visitDateLabel(booking.visit_date)}</span>
        <span>{pluralise(booking.people_booked, "person", "people")}</span>
        {booking.contact_name ? <span className="truncate">{booking.contact_name}</span> : null}
      </div>
    </div>
  );
}

/** "Deposit R 2 800.00 · Paid R 0.00 · Balance R 3 850.00" for payment matching. */
export function BookingFinanceMeta({ booking }: { booking: BookingListItem }) {
  return (
    <span className="flex flex-wrap gap-x-3 tabular">
      <span>Deposit {booking.deposit_waived ? "waived" : formatMoney(booking.deposit_due)}</span>
      <span>Paid {formatMoney(booking.paid_total)}</span>
      <span>Balance {formatMoney(booking.balance_due)}</span>
    </span>
  );
}
