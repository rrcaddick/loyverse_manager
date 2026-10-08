/**
 * Small presentational pieces shared by the calendar, day, list and detail
 * pages: contact chips, the provenance badge and the hold-expiry notice.
 * Non-visual helpers live in ./lib.ts.
 */

import { AlertTriangle, FileSpreadsheet, Mail, MapPin, Phone, User } from "lucide-react";
import type { ReactNode } from "react";

import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

import { holdState } from "./lib";
import type { BookingRow, BookingSource } from "./types";

// ------------------------------------------------------------ contact chips

interface ChipProps {
  icon: typeof Mail;
  children: ReactNode;
  href?: string;
  label: string;
  className?: string;
}

function Chip({ icon: Icon, children, href, label, className }: ChipProps) {
  const inner = (
    <>
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{children}</span>
    </>
  );
  const base =
    "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md bg-muted/60 px-2 text-sm text-foreground ring-1 ring-inset ring-foreground/8";
  if (href) {
    return (
      <a
        href={href}
        aria-label={label}
        className={cn(base, "transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50", className)}
      >
        {inner}
      </a>
    );
  }
  return (
    <span className={cn(base, className)} aria-label={label}>
      {inner}
    </span>
  );
}

export function ContactChips({
  booking,
  compact = false,
  className,
}: {
  booking: Pick<BookingRow, "contact_name" | "contact_email" | "contact_mobile" | "area">;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {!compact ? <Chip icon={User} label={`Contact ${booking.contact_name}`}>{booking.contact_name}</Chip> : null}
      {booking.contact_email ? (
        <Chip icon={Mail} href={`mailto:${booking.contact_email}`} label={`Email ${booking.contact_email}`}>
          {booking.contact_email}
        </Chip>
      ) : null}
      {booking.contact_mobile ? (
        <Chip icon={Phone} href={`tel:+${booking.contact_mobile}`} label={`Call ${formatPhone(booking.contact_mobile)}`}>
          {formatPhone(booking.contact_mobile)}
        </Chip>
      ) : null}
      {booking.area && !compact ? (
        <Chip icon={MapPin} label={`Area ${booking.area}`}>
          {booking.area}
        </Chip>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------- provenance

export function ProvenanceBadge({ source, className, iconOnly = false }: { source: BookingSource; className?: string; iconOnly?: boolean }) {
  if (source !== "import") return null;
  if (iconOnly) {
    return (
      <span className={cn("inline-flex shrink-0 text-status-blue-fg", className)} title="Imported from the booking sheet" aria-label="Imported from the booking sheet">
        <FileSpreadsheet aria-hidden="true" className="size-3" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-status-blue-bg px-1.5 text-xs font-medium text-status-blue-fg ring-1 ring-inset ring-foreground/8",
        className,
      )}
      title="Imported from the 2026/27 booking sheet"
    >
      <FileSpreadsheet aria-hidden="true" className="size-3" />
      Imported from booking sheet
    </span>
  );
}

// ------------------------------------------------------------- hold expiry

export function HoldExpiryNotice({
  booking,
  className,
  urgentOnly = false,
}: {
  booking: Pick<BookingRow, "status" | "hold_expires_on">;
  className?: string;
  /** Only show when the hold is about to lapse or has lapsed. */
  urgentOnly?: boolean;
}) {
  const state = holdState(booking);
  if (!state || (urgentOnly && state.tone === "neutral")) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        state.tone === "red" && "font-medium text-destructive",
        state.tone === "amber" && "font-medium text-status-amber-fg",
        state.tone === "neutral" && "text-muted-foreground",
        className,
      )}
    >
      {state.tone !== "neutral" ? <AlertTriangle aria-hidden="true" className="size-3.5" /> : null}
      {state.text}
    </span>
  );
}

