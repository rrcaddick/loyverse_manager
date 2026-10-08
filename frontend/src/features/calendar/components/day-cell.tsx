/**
 * One day of the grid (docs/research/02-calendar-day-view.md, "Cell anatomy").
 *
 *   row 1  day number 14/600 (today: 22 px accent disc) · at most one tag
 *   row 2  interest = confirmed + pending, 30/700 (36 at 1920) · "9 grps"
 *   row 3  the 6 px split bar · `550 confirmed · 250 pending` (or `550 · 250`)
 *
 * Fill = heat band of the interest against capacity; all text is full ink.
 * Closed = hatch, peak = 2 px amber top rule, avoid = dashed border, over
 * capacity = 3 px red top rule + OVER. No names: they live in the panel.
 */

import { CapacityBar } from "@/components/capacity-bar";
import type { CalendarDay } from "@/features/bookings/types";
import { formatDateLong, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { heatLevel } from "../heat";
import { dayNumberLabel } from "../month";
import { SplitCaption } from "./split-caption";

const HEAT_CLASS = ["", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-heat-5"] as const;

export interface DayCellProps {
  ref: (el: HTMLDivElement | null) => void;
  date: string;
  day: CalendarDay | undefined;
  isToday: boolean;
  capacity: number;
  isFocused: boolean;
  isSelected: boolean;
  onFocus: () => void;
  onOpen: () => void;
}

type Tag = { kind: "over" | "closed" | "peak" | "avoid" | "label"; text: string };

/** One tag at most: over capacity beats the day type, which beats a holiday name. */
function tagFor(day: CalendarDay | undefined): Tag | null {
  if (!day) return null;
  if (day.capacity_warning) return { kind: "over", text: "Over" };
  if (day.is_closed) return { kind: "closed", text: "Closed" };
  if (day.is_peak) return { kind: "peak", text: "Peak" };
  if (day.is_avoid) return { kind: "avoid", text: "Avoid" };
  if (day.label) return { kind: "label", text: day.label };
  return null;
}

function describe(date: string, day: CalendarDay | undefined, isToday: boolean): string {
  const parts = [formatDateLong(date)];
  if (isToday) parts.push("today");
  if (!day) return parts.join(", ");
  if (day.is_closed) parts.push(day.label ? `closed, ${day.label}` : "closed");
  else if (day.label) parts.push(day.label);
  if (day.is_peak) parts.push("peak day");
  if (day.is_avoid) parts.push("avoid day");
  if (day.booking_count === 0) parts.push("no bookings");
  else {
    parts.push(`${formatNumber(day.total_people)} people`);
    parts.push(`${formatNumber(day.confirmed_people)} confirmed, ${formatNumber(day.tentative_people)} pending`);
    parts.push(`${formatNumber(day.booking_count)} ${day.booking_count === 1 ? "group" : "groups"}`);
  }
  if (day.capacity_warning) parts.push("over capacity");
  return parts.join(", ");
}

export function DayCell({ ref, date, day, isToday, capacity, isFocused, isSelected, onFocus, onOpen }: DayCellProps) {
  const total = day?.total_people ?? 0;
  const confirmed = day?.confirmed_people ?? 0;
  const pending = day?.tentative_people ?? 0;
  const groups = day?.booking_count ?? 0;
  const level = heatLevel(total, capacity);
  const tag = tagFor(day);
  const over = tag?.kind === "over";
  // "1 Dec" plus a tag does not fit a narrow cell; the hatch, rule or dashes
  // still carry the day type there, and the panel names the holiday.
  const firstOfMonth = date.endsWith("-01");

  return (
    <div
      ref={ref}
      role="gridcell"
      tabIndex={isFocused ? 0 : -1}
      data-date={date}
      data-heat={level}
      aria-selected={isSelected || undefined}
      aria-label={describe(date, day, isToday)}
      onFocus={onFocus}
      onClick={onOpen}
      className={cn(
        // Narrow mode (@max-[125px] of content, i.e. the panel open at 1440):
        // the group count stacks under a 24 px number instead of clipping.
        "fy-cell @container relative flex min-h-0 cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-card p-2 text-left text-heat-text outline-hidden select-none",
        "hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring",
        HEAT_CLASS[level],
        day?.is_closed && "hatched",
        day?.is_avoid && "border-dashed border-border-strong",
        day?.is_peak && !over && "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-amber-solid before:content-['']",
        over && "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-red-solid before:content-['']",
        isSelected && "border-primary ring-2 ring-selection-ring",
      )}
    >
      <div className="flex h-[1.375rem] shrink-0 items-center justify-between gap-1">
        <span
          className={cn(
            "shrink-0 text-sm leading-none font-semibold tabular",
            isToday && "-ml-0.5 inline-flex h-[1.375rem] min-w-[1.375rem] items-center justify-center rounded-full bg-primary px-1.5 text-primary-foreground",
          )}
        >
          {dayNumberLabel(date)}
        </span>
        {tag ? (
          tag.kind === "over" ? (
            <span className="text-label shrink-0 rounded-sm bg-red-solid px-1 leading-4 font-semibold text-on-solid uppercase">{tag.text}</span>
          ) : (
            // Spelled out rather than `text-label`: tailwind-merge would treat
            // `text-label` + `text-muted-foreground` as two colours and drop one.
            <span
              className={cn("min-w-0 truncate text-xs leading-4 font-medium tracking-[0.04em]", tag.kind !== "label" && "uppercase", level === 0 && "text-muted-foreground", firstOfMonth && "@max-[125px]:hidden")}
              title={tag.kind === "label" ? tag.text : undefined}
            >
              {tag.text}
            </span>
          )
        ) : null}
      </div>

      {groups > 0 || total > 0 ? (
        <div className="mt-auto flex shrink-0 items-baseline gap-1.5 overflow-hidden whitespace-nowrap @max-[125px]:flex-col @max-[125px]:items-start @max-[125px]:gap-0">
          <span className="text-(length:--fy-interest) leading-none font-bold tracking-tight tabular @max-[125px]:text-[1.5rem]">{formatNumber(total)}</span>
          <span className={cn("text-xs leading-4 font-medium", level === 0 && "text-muted-foreground")}>
            {groups} {groups === 1 ? "grp" : "grps"}
          </span>
        </div>
      ) : null}

      {total > 0 ? (
        <div className="mt-1 flex flex-col gap-1">
          <CapacityBar confirmed={confirmed} pending={pending} caption="none" height={6} label={`${formatNumber(confirmed)} confirmed of ${formatNumber(total)}`} />
          <SplitCaption confirmed={confirmed} pending={pending} />
        </div>
      ) : null}
    </div>
  );
}
