import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { visitDateLabel } from "@/features/queue/bookings";
import type { QueueSection } from "@/features/queue/types";
import { formatMoney, formatNumber, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

import { QueueSectionCard, groupTypeLabel } from "../shared";

type Section = Extract<QueueSection, { key: "visits_this_week" }>;

export function VisitsThisWeekSection({ section }: { section: Section }) {
  const totals = section.items.reduce(
    (acc, item) => ({ people: acc.people + item.booking.people_booked, balance: acc.balance + item.finance.balance_due }),
    { people: 0, balance: 0 },
  );
  return (
    <QueueSectionCard
      sectionKey={section.key}
      title={section.title}
      count={section.count}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to="/calendar">
            Calendar
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
      }
    >
      <div className="overflow-x-auto scrollbar-thin">
        <Table className="[&_td]:align-middle">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-10 text-xs font-medium tracking-wide text-muted-foreground uppercase">Day</TableHead>
              <TableHead className="h-10 text-xs font-medium tracking-wide text-muted-foreground uppercase">Group</TableHead>
              <TableHead className="h-10 text-xs font-medium tracking-wide text-muted-foreground uppercase">Arrival</TableHead>
              <TableHead className="h-10 text-right text-xs font-medium tracking-wide text-muted-foreground uppercase">People</TableHead>
              <TableHead className="h-10 text-xs font-medium tracking-wide text-muted-foreground uppercase">Status</TableHead>
              <TableHead className="h-10 text-xs font-medium tracking-wide text-muted-foreground uppercase">Ticket</TableHead>
              <TableHead className="h-10 text-right text-xs font-medium tracking-wide text-muted-foreground uppercase">Balance due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.items.map((item) => (
              <TableRow key={item.booking.id}>
                <TableCell className="py-2.5 whitespace-nowrap tabular">
                  <Link to={`/day/${item.booking.visit_date}`} className="font-medium underline-offset-4 hover:underline">
                    {visitDateLabel(item.booking.visit_date)}
                  </Link>
                </TableCell>
                <TableCell className="py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      <Link to={`/bookings/${item.booking.id}`} className="tabular underline-offset-4 hover:underline">
                        {item.booking.reference}
                      </Link>{" "}
                      {item.booking.group_name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {groupTypeLabel(item.group_type)}
                      {item.booking.contact_name ? ` · ${item.booking.contact_name}` : ""}
                      {item.contact_mobile ? ` · ${formatPhone(item.contact_mobile)}` : ""}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="py-2.5 whitespace-nowrap text-muted-foreground tabular">
                  {item.arrival_time ?? "—"}
                  {item.vehicles > 0 || item.gazebos > 0 ? (
                    <span className="block text-xs">
                      {item.vehicles > 0 ? `${item.vehicles} veh.` : ""}
                      {item.vehicles > 0 && item.gazebos > 0 ? " · " : ""}
                      {item.gazebos > 0 ? `${item.gazebos} gazebo${item.gazebos === 1 ? "" : "s"}` : ""}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="py-2.5 text-right tabular">{formatNumber(item.booking.people_booked)}</TableCell>
                <TableCell className="py-2.5">
                  <StatusBadge status={item.booking.status} />
                </TableCell>
                <TableCell className="py-2.5">
                  {item.booking.status === "confirmed" || item.booking.status === "completed" ? (
                    <StatusBadge status={item.ticket_sent ? "sent" : "not_sent"} label={item.ticket_sent ? "Sent" : "Not sent"} tone={item.ticket_sent ? "green" : "amber"} />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className={cn("py-2.5 text-right tabular", item.finance.balance_due > 0 ? "font-medium" : "text-muted-foreground")}>
                  {formatMoney(item.finance.balance_due)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={3} className="py-2 text-xs text-muted-foreground">
                {formatNumber(section.items.length)} {section.items.length === 1 ? "visit" : "visits"}
              </TableCell>
              <TableCell className="py-2 text-right tabular">{formatNumber(totals.people)}</TableCell>
              <TableCell colSpan={2} />
              <TableCell className="py-2 text-right tabular">{formatMoney(totals.balance)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </QueueSectionCard>
  );
}
