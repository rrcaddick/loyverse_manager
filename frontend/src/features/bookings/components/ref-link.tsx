/** The booking reference as the row's link, in the list's own type role. */

import { Link } from "react-router";

import { cn } from "@/lib/utils";

import type { BookingListItem } from "../types";

export function RefLink({ booking, className }: { booking: Pick<BookingListItem, "id" | "reference">; className?: string }) {
  return (
    <Link
      to={`/bookings/${booking.id}`}
      className={cn(
        "rounded-sm text-body font-semibold tabular text-foreground underline-offset-3 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-selection-ring",
        className,
      )}
    >
      {booking.reference}
    </Link>
  );
}
