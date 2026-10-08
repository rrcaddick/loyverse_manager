/**
 * "Extend hold": pick a new hold_expires_on in a popover and PATCH it.
 * Confirms inside the popover so a stray click on a day does nothing.
 */

import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { formatDate, parseDate, todayIso, toIsoDate } from "@/lib/format";

import { useUpdateBooking, type BookingSummary } from "./bookings";

interface ExtendHoldProps {
  booking: BookingSummary;
  currentHold: string | null;
}

export function ExtendHoldButton({ booking, currentHold }: ExtendHoldProps) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Date | undefined>(undefined);
  const update = useUpdateBooking();
  const today = parseDate(todayIso())!;
  const visit = parseDate(booking.visit_date);
  const latest = visit ?? undefined;

  async function save() {
    if (!picked) return;
    const iso = toIsoDate(picked);
    await update.mutateAsync({ id: booking.id, hold_expires_on: iso });
    toast.success(`Hold on ${booking.reference} extended to ${formatDate(iso)}`);
    setOpen(false);
    setPicked(undefined);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPicked(undefined);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Extend hold for ${booking.reference}`}>
          <CalendarPlus data-icon="inline-start" />
          Extend hold
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <div className="border-b border-border px-3 py-2 text-sm">
          <div className="font-medium">New hold expiry</div>
          <div className="text-xs text-muted-foreground tabular">
            {currentHold ? `Currently ${formatDate(currentHold)}` : "No hold date set"} · visit {formatDate(booking.visit_date)}
          </div>
        </div>
        <Calendar
          mode="single"
          selected={picked}
          onSelect={setPicked}
          defaultMonth={picked ?? (currentHold ? parseDate(currentHold) ?? today : today)}
          disabled={[{ before: today }, ...(latest ? [{ after: latest }] : [])]}
          weekStartsOn={1}
        />
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="text-xs text-muted-foreground tabular">{picked ? formatDate(picked) : "Pick a day"}</span>
          <Button size="sm" disabled={!picked || update.isPending} onClick={() => void save()}>
            {update.isPending ? <Spinner data-icon="inline-start" /> : null}
            Extend
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
