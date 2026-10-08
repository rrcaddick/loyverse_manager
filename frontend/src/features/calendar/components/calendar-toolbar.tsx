/**
 * The 44 px toolbar: `Today` · ‹ › (month) · "November 2026" (click = month
 * and year picker) · ▲ ▼ (week) · totals for the visible weeks on the right.
 */

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MONTHS, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { anchorMonth, todayMonth, type CalendarWindow } from "../month";

export interface WindowTotals {
  people: number;
  confirmed: number;
  groups: number;
}

interface CalendarToolbarProps {
  window: CalendarWindow;
  title: string;
  totals: WindowTotals | null;
  onToday: () => void;
  onMonth: (delta: 1 | -1) => void;
  onWeek: (delta: 1 | -1) => void;
  onPickMonth: (month: string) => void;
}

export function CalendarToolbar({ window: view, title, totals, onToday, onMonth, onWeek, onPickMonth }: CalendarToolbarProps) {
  const month = anchorMonth(view.from);
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
      <Button variant="outline" onClick={onToday} title="T">
        Today
      </Button>
      <div className="ml-1 flex items-center">
        <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => onMonth(-1)}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => onMonth(1)}>
          <ChevronRight />
        </Button>
      </div>
      <MonthPicker month={month} title={title} onPick={onPickMonth} />
      <div className="flex items-center">
        <Button variant="ghost" size="icon" aria-label="Previous week" onClick={() => onWeek(-1)}>
          <ChevronUp />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Next week" onClick={() => onWeek(1)}>
          <ChevronDown />
        </Button>
      </div>

      <dl className="ml-auto hidden items-baseline gap-x-5 text-sm whitespace-nowrap text-muted-foreground tabular sm:flex" aria-label="Totals for the visible weeks">
        <Total label="people" value={totals?.people} />
        <Total label="confirmed" value={totals?.confirmed} />
        <Total label="groups" value={totals?.groups} />
      </dl>
    </div>
  );
}

function Total({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex items-baseline gap-1">
      <dd className="order-1 text-base leading-none font-semibold text-foreground">{value === undefined ? "—" : formatNumber(value)}</dd>
      <dt className="order-2">{label}</dt>
    </div>
  );
}

function MonthPicker({ month, title, onPick }: { month: string; title: string; onPick: (month: string) => void }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));
  const current = todayMonth();

  function onOpenChange(next: boolean) {
    if (next) setYear(Number(month.slice(0, 4)));
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="h-9 px-2" aria-label={`Choose a month, showing ${title}`}>
          <h1 className="text-section leading-none">{title}</h1>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-3">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon-sm" aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>
            <ChevronLeft />
          </Button>
          <span className="text-sm font-semibold tabular" aria-live="polite">
            {year}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Next year" onClick={() => setYear((y) => y + 1)}>
            <ChevronRight />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1" role="listbox" aria-label={`Months of ${year}`}>
          {MONTHS.map((name, index) => {
            const key = `${year}-${String(index + 1).padStart(2, "0")}`;
            const selected = key === month;
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onPick(key);
                  setOpen(false);
                }}
                className={cn(
                  "h-9 rounded-md text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                  selected && "bg-primary text-primary-foreground hover:bg-primary-hover",
                  key === current && !selected && "font-semibold text-primary",
                )}
              >
                {name.slice(0, 3)}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
