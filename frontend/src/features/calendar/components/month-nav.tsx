/**
 * Month navigation: previous / next / today plus a month + year picker.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MONTHS, formatMonthYear } from "@/lib/format";
import { cn } from "@/lib/utils";

import { shiftMonth, todayMonth } from "../month";

interface MonthNavProps {
  month: string;
  onChange: (month: string) => void;
  className?: string;
}

export function MonthNav({ month, onChange, className }: MonthNavProps) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));
  const current = todayMonth();

  function openPicker(next: boolean) {
    if (next) setYear(Number(month.slice(0, 4)));
    setOpen(next);
  }

  return (
    <nav aria-label="Month" className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => onChange(shiftMonth(month, 1))}>
          <ChevronRight />
        </Button>
      </div>
      <Button variant="outline" size="sm" onClick={() => onChange(current)} disabled={month === current}>
        Today
      </Button>
      <Popover open={open} onOpenChange={openPicker}>
        <PopoverTrigger asChild>
          <Button variant="ghost" className="h-8 px-2 text-lg font-semibold tracking-tight" aria-label={`Choose a month, currently ${formatMonthYear(`${month}-01`)}`}>
            <h2 className="text-xl font-semibold tracking-tight">{formatMonthYear(`${month}-01`)}</h2>
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
                    onChange(key);
                    setOpen(false);
                  }}
                  className={cn(
                    "h-8 rounded-md text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                    selected && "bg-primary text-primary-foreground hover:bg-primary/90",
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
    </nav>
  );
}
