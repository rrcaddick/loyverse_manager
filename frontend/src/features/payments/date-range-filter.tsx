/** Booking-date range filter: a popover calendar in range mode. */

import { CalendarRange, X } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatDate, formatDayMonth, parseDate, toIsoDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface DateRangeFilterProps {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  className?: string;
}

export function DateRangeFilter({ from, to, onChange, className }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const selected: DateRange | undefined = from || to ? { from: parseDate(from) ?? undefined, to: parseDate(to) ?? undefined } : undefined;
  const active = !!(from || to);

  const label = !active
    ? "Any date"
    : from && to
      ? `${formatDayMonth(from)} – ${formatDate(to)}`
      : from
        ? `From ${formatDate(from)}`
        : `Until ${formatDate(to)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("tabular", active && "border-primary/40 bg-primary/5", className)} aria-label={`Date range: ${label}`}>
          <CalendarRange data-icon="inline-start" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          numberOfMonths={isMobile ? 1 : 2}
          selected={selected}
          defaultMonth={selected?.from ?? new Date()}
          weekStartsOn={1}
          onSelect={(range) => {
            onChange({ from: range?.from ? toIsoDate(range.from) : "", to: range?.to ? toIsoDate(range.to) : "" });
            if (range?.from && range?.to) setOpen(false);
          }}
        />
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">Pick a start and an end day.</span>
          <Button
            variant="ghost"
            size="xs"
            disabled={!active}
            onClick={() => {
              onChange({ from: "", to: "" });
              setOpen(false);
            }}
          >
            <X data-icon="inline-start" />
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
