/**
 * History (2 Nov 2026): what this group did before, so we know what to expect
 * this time. Four numbers across the top (visits, turnout, how long the
 * deposit took, reliability), the group with its other spellings and the
 * summary in words, then one row per other booking: booked against arrived,
 * how long the proforma and the deposit took, what was paid, how it ended.
 * The questions they asked before close the page. Nothing here is typed:
 * Change group and the Same group / New group answers are the only verbs.
 */

import { History, MessageCircleQuestion, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { BigNumber, BigNumberRow } from "@/components/big-number";
import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { formatDateShort, formatMoney, formatNumber, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useSetGroup } from "../../api";
import { suggestionLabel, summaryLines, whyText } from "../../groups";
import { useGroupTypeLabel } from "../../lib";
import type { BookingDetail, HistoryVisit } from "../../types";
import { GroupPickerDialog } from "./group-picker-dialog";

export function HistoryTab({ booking }: { booking: BookingDetail }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  if (!booking.group) return <Unlinked booking={booking} />;
  const { visits, summary } = booking.history;
  const questions = visits.flatMap((v) => v.questions.map((q) => ({ ref: v.reference, q }))).slice(0, 8);
  return (
    <div className="flex flex-col gap-card-gap">
      {summary ? <SummaryNumbers booking={booking} /> : null}
      <GroupSection booking={booking} onChange={() => setPickerOpen(true)} />
      <VisitsTable visits={visits} />
      {questions.length > 0 ? (
        <Section
          title={
            <span className="inline-flex items-center gap-2">
              <MessageCircleQuestion aria-hidden="true" className="size-4 text-muted-foreground" />
              Questions they asked before
            </span>
          }
        >
          <ul className="flex flex-col gap-2 text-body">
            {questions.map((item, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 font-mono text-sm text-muted-foreground">{item.ref}</span>
                <span className="text-foreground">{item.q}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <GroupPickerDialog booking={booking} open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  );
}

// ---------------------------------------------------------------- numbers

function SummaryNumbers({ booking }: { booking: BookingDetail }) {
  const s = booking.history.summary!;
  const last = s.last;
  const onTime = s.deposit_on_time;
  const reliability = s.cancellations === 0 ? { label: "Never cancelled", tone: "green" as const } : { label: `${pluralise(s.cancellations, "time")} out of ${s.visits + s.cancellations}`, tone: s.cancellations > s.visits ? ("red" as const) : ("amber" as const) };
  return (
    <BigNumberRow columns={4}>
      <BigNumber label="Visits" value={formatNumber(s.visits)} badge={s.first_year ? <StatusPill tone="neutral" label={`Since ${s.first_year}`} size="sm" dot={false} /> : undefined} />
      <BigNumber
        label="Turnout"
        value={s.turnout_avg_pct !== null ? `${s.turnout_avg_pct}%` : "—"}
        badge={last && last.arrived !== null && last.booked ? <StatusPill tone="neutral" label={`Last ${last.arrived} of ${last.booked}`} size="sm" dot={false} /> : undefined}
        tone={s.turnout_avg_pct === null ? "neutral" : s.turnout_avg_pct >= 90 ? "green" : s.turnout_avg_pct >= 70 ? "amber" : "red"}
      />
      <BigNumber
        label="Deposit"
        value={s.deposit_days_avg !== null ? `${s.deposit_days_avg} d` : "—"}
        badge={onTime ? <StatusPill tone={onTime.on_time === onTime.of ? "green" : onTime.on_time === 0 ? "red" : "amber"} label={onTime.on_time === onTime.of ? "On time" : `${onTime.on_time} of ${onTime.of} on time`} size="sm" dot={false} /> : undefined}
        tone={onTime ? (onTime.on_time === onTime.of ? "green" : onTime.on_time === 0 ? "red" : "amber") : "neutral"}
      />
      <BigNumber label="Cancellations" value={formatNumber(s.cancellations)} badge={<StatusPill tone={reliability.tone} label={reliability.label} size="sm" dot={false} />} tone={s.cancellations === 0 ? "green" : reliability.tone} />
    </BigNumberRow>
  );
}

// ------------------------------------------------------------------ group

function GroupSection({ booking, onChange }: { booking: BookingDetail; onChange: () => void }) {
  const g = booking.group!;
  const groupType = useGroupTypeLabel();
  const lines = summaryLines(booking.history.summary);
  const upcoming = booking.history.visits.filter((v) => v.relation === "upcoming");
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Users aria-hidden="true" className="size-4 text-muted-foreground" />
          Group
        </span>
      }
      actions={
        <Button variant="outline" size="sm" onClick={onChange}>
          Change group
        </Button>
      }
    >
      <div className="flex flex-col gap-2 text-body">
        <p className="text-foreground">
          <span className="font-medium">{g.name}</span>
          <span className="text-muted-foreground">{[g.area, g.group_type ? groupType(g.group_type) : null, pluralise(g.bookings, "booking")].filter(Boolean).map((part) => ` · ${part}`)}</span>
        </p>
        {g.aliases.length > 0 ? <p className="text-sm text-muted-foreground">Also booked as {g.aliases.join(", ")}.</p> : null}
        {lines.length > 0 ? (
          <p className="text-foreground">{lines.join(" ")}</p>
        ) : (
          <p className="text-muted-foreground">
            First booking for this group.
            {upcoming.length > 0 ? ` Also booked: ${upcoming.map((v) => `${v.reference} on ${formatDateShort(v.visit_date ?? "")}`).join(", ")}.` : ""}
          </p>
        )}
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------- visits

function days(n: number | null): string {
  return n === null ? "—" : `${n} d`;
}

function VisitsTable({ visits }: { visits: HistoryVisit[] }) {
  const navigate = useNavigate();
  const th = "h-thead text-label text-table-head-foreground uppercase";
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-section flex items-center gap-2 text-foreground">
        <History aria-hidden="true" className="size-4 text-muted-foreground" />
        Other bookings
        {visits.length ? <span className="text-sm font-normal tabular text-muted-foreground">({visits.length})</span> : null}
      </h2>
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
        <Table>
          <TableHeader className="bg-table-head text-table-head-foreground">
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(th, "pl-5")}>Date</TableHead>
              <TableHead className={th}>Reference</TableHead>
              <TableHead className={th}>Booked as</TableHead>
              <TableHead className={cn(th, "text-right")}>Booked</TableHead>
              <TableHead className={cn(th, "text-right")}>Arrived</TableHead>
              <TableHead className={cn(th, "text-right")}>Proforma</TableHead>
              <TableHead className={cn(th, "text-right")}>Deposit</TableHead>
              <TableHead className={cn(th, "text-right")}>Paid</TableHead>
              <TableHead className={cn(th, "pr-5")}>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visits.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={9} className="py-6 pl-5 text-sm text-muted-foreground">
                  No other bookings for this group yet.
                </TableCell>
              </TableRow>
            ) : (
              visits.map((v) => (
                <TableRow key={v.id} tabIndex={0} onClick={() => navigate(`/bookings/${v.id}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/bookings/${v.id}`)} className="cursor-pointer">
                  <TableCell className="pl-5 whitespace-nowrap tabular">
                    {v.visit_date ? `${formatDateShort(v.visit_date)} ${v.visit_date.slice(0, 4)}` : "—"}
                    {v.relation === "upcoming" ? <span className="ml-2 text-xs text-muted-foreground uppercase">Upcoming</span> : null}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{v.reference}</TableCell>
                  <TableCell className="max-w-56">
                    <span className="block truncate">{v.group_name}</span>
                    {v.contact_name ? (
                      <span className="block truncate text-sm text-muted-foreground">
                        {v.contact_name}
                        {v.same_contact ? " · same person" : ""}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular">{v.booked !== null ? formatNumber(v.booked) : "—"}</TableCell>
                  <TableCell className="text-right tabular">
                    {v.arrived !== null ? formatNumber(v.arrived) : "—"}
                    {v.turnout_pct !== null ? <span className="ml-1 text-sm text-muted-foreground">({v.turnout_pct}%)</span> : null}
                  </TableCell>
                  <TableCell className="text-right tabular">{days(v.proforma_days)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular">
                    {days(v.deposit_days)}
                    {v.deposit_on_time !== null ? <StatusPill tone={v.deposit_on_time ? "green" : "amber"} label={v.deposit_on_time ? "On time" : "Late"} size="sm" dot={false} className="ml-2" /> : null}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular">
                    {formatMoney(v.paid_total, { compact: true })}
                    {v.refunded > 0 ? <span className="ml-1 text-sm text-red-text">−{formatMoney(v.refunded, { compact: true })}</span> : null}
                    {v.settled && v.relation === "past" ? <span className="block text-xs text-muted-foreground">{v.settled === "short" ? "not in full" : `settled ${v.settled}`}</span> : null}
                  </TableCell>
                  <TableCell className="pr-5 whitespace-nowrap">
                    <StatusPill status={v.status} size="sm" />
                    {v.exit?.days_before_visit !== null && v.exit?.days_before_visit !== undefined ? <span className="ml-2 text-sm text-muted-foreground">{v.exit.days_before_visit} d before</span> : null}
                    {v.reminders_sent > 0 ? <span className="block text-xs text-muted-foreground">{pluralise(v.reminders_sent, "reminder")}</span> : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- unlinked

function Unlinked({ booking }: { booking: BookingDetail }) {
  const setGroup = useSetGroup(booking.id);
  const [pickerOpen, setPickerOpen] = useState(false);
  async function choose(input: { group_id: number } | { new: true }) {
    try {
      await setGroup.mutateAsync(input);
      toast.success("new" in input ? "Started a new group" : "Linked to the group");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <div className="flex flex-col gap-card-gap">
      {booking.group_suggestions.length > 0 ? (
        <Section
          title={
            <span className="inline-flex items-center gap-2">
              <Users aria-hidden="true" className="size-4 text-muted-foreground" />
              Same group as one of these?
            </span>
          }
          description="Yes links this booking to that group's history. New group starts one for it."
          actions={
            <Button variant="outline" size="sm" disabled={setGroup.isPending} onClick={() => choose({ new: true })}>
              New group
            </Button>
          }
        >
          <ul className="flex flex-col divide-y divide-border">
            {booking.group_suggestions.map((s) => (
              <li key={s.group_id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-foreground">{suggestionLabel(s)}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {whyText(s.why)}
                    {s.bookings > 1 ? ` · ${pluralise(s.bookings, "booking")}` : ""}
                    {s.last ? ` · ${s.last.people_booked} booked` : ""}
                  </div>
                </div>
                <Button size="sm" className="min-w-32" disabled={setGroup.isPending} onClick={() => choose({ group_id: s.group_id })}>
                  Same group
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      ) : (
        <EmptyState
          variant="card"
          icon={History}
          title="Not linked to a group yet"
          hint="Link it to the group it belongs to, or start a new one."
          action={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                Find group
              </Button>
              <Button size="sm" disabled={setGroup.isPending} onClick={() => choose({ new: true })}>
                New group
              </Button>
            </div>
          }
        />
      )}
      <GroupPickerDialog booking={booking} open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  );
}
