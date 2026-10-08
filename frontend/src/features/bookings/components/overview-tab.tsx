/**
 * Overview tab: the booking's facts, contact, pricing with overrides, the
 * hold, reminders and quick notes.
 */

import { CalendarClock, FileSpreadsheet, Pencil, StickyNote } from "lucide-react";
import { useState } from "react";

import { KeyValue, type KeyValueItem } from "@/components/key-value";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/features/settings/api";
import { formatDate, formatDateLong, formatDateTime, formatMoney, formatNumber, formatPercent, formatPhone, humanise, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useAddNote } from "../api";
import { peopleSummary, relativeDayLabel, sourceLabel, useGroupTypeLabel } from "../lib";
import { ContactChips, HoldExpiryNotice } from "../shared";
import { REMINDER_KIND_LABELS, type BookingDetail } from "../types";
import { DepositOverrideDialog, HoldDialog, PriceOverrideDialog } from "./override-dialogs";

interface OverviewTabProps {
  booking: BookingDetail;
  onEdit: () => void;
}

export function OverviewTab({ booking, onEdit }: OverviewTabProps) {
  const groupType = useGroupTypeLabel();
  const settings = useSettings();
  const tier = settings.data?.price_tiers.find((t) => t.code === booking.price_tier_code);
  const [priceOpen, setPriceOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const f = booking.finance;

  const facts: KeyValueItem[] = [
    {
      label: "Visit date",
      value: (
        <span>
          {formatDateLong(booking.visit_date)}
          {relativeDayLabel(booking.visit_date) ? <span className="ml-1.5 text-muted-foreground">· {relativeDayLabel(booking.visit_date)}</span> : null}
        </span>
      ),
      wide: true,
    },
    { label: "Arrival time", value: booking.arrival_time ?? "—" },
    { label: "Alternative date", value: booking.alternative_date ? formatDate(booking.alternative_date) : "—" },
    {
      label: "People",
      value: (
        <span className="tabular">
          {formatNumber(booking.people_booked)}
          {peopleSummary(booking) ? <span className="ml-1.5 text-muted-foreground">({peopleSummary(booking)})</span> : null}
        </span>
      ),
    },
    { label: "Vehicles", value: formatNumber(booking.vehicles), numeric: false },
    { label: "Gazebos", value: formatNumber(booking.gazebos) },
    { label: "Group type", value: groupType(booking.group_type) },
    { label: "Area", value: booking.area ?? "—" },
    { label: "Enquiry date", value: booking.enquiry_date ? formatDate(booking.enquiry_date) : "—" },
    { label: "Barcode", value: booking.barcode ? <span className="font-mono">{booking.barcode}</span> : "—" },
    {
      label: "Source",
      value: (
        <span className="flex flex-wrap items-center gap-1.5">
          {sourceLabel(booking.source)}
          {booking.source === "import" && booking.legacy_sheet_row?._row ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <FileSpreadsheet aria-hidden="true" className="size-3" />
              sheet row {booking.legacy_sheet_row._row}
            </span>
          ) : null}
        </span>
      ),
    },
    { label: "Created", value: <span title={formatDateTime(booking.created_at)}>{formatDateTime(booking.created_at)}</span> },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,1fr)]">
      <div className="flex flex-col gap-6">
        <Section
          title="Booking"
          actions={
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil data-icon="inline-start" />
              Edit
            </Button>
          }
        >
          <KeyValue items={facts} columns={3} />
        </Section>

        <Section title="Contact">
          <div className="flex flex-col gap-4">
            <KeyValue
              columns={3}
              items={[
                { label: "Name", value: booking.contact_name },
                { label: "Email", value: booking.contact_email ? <a className="underline-offset-3 hover:underline" href={`mailto:${booking.contact_email}`}>{booking.contact_email}</a> : <span className="text-status-amber-fg">Missing — add one to send documents</span> },
                { label: "Mobile", value: booking.contact_mobile ? <a className="tabular underline-offset-3 hover:underline" href={`tel:+${booking.contact_mobile}`}>{formatPhone(booking.contact_mobile)}</a> : "—" },
              ]}
            />
            <ContactChips booking={booking} compact />
          </div>
        </Section>

        <Section title="Notes">
          <div className="grid gap-5 sm:grid-cols-2">
            <NoteBlock label="From the customer" text={booking.customer_notes} />
            <NoteBlock label="Internal" text={booking.internal_notes} />
          </div>
        </Section>

        <NotesComposer booking={booking} />
      </div>

      <div className="flex flex-col gap-6">
        <Section
          title="Pricing"
          description={
            <span className="flex flex-wrap items-center gap-1.5">
              {tier ? tier.label : booking.price_tier_code ? humanise(booking.price_tier_code) : "No tier"}
              <StatusBadge status={booking.day_type} label={booking.day_type === "weekend" ? "Weekend" : "Weekday"} tone="neutral" dot={false} />
              {booking.is_peak ? <StatusBadge status="peak" label="Peak" tone="amber" dot={false} /> : null}
              {booking.in_no_discount_window && !booking.is_peak ? <StatusBadge status="window" label="No-discount window" tone="amber" dot={false} /> : null}
            </span>
          }
        >
          <dl className="flex flex-col divide-y divide-border text-sm">
            <Line
              label="Price per person"
              value={formatMoney(booking.price_per_person)}
              note={booking.price_overridden ? `Override: ${booking.price_override_reason ?? "no reason recorded"}` : tier ? `Tier price ${formatMoney(tier.price)}` : undefined}
              flag={booking.price_overridden ? "Overridden" : undefined}
              action={
                <Button variant="ghost" size="xs" onClick={() => setPriceOpen(true)}>
                  {booking.price_overridden ? "Change" : "Override"}
                </Button>
              }
            />
            <Line label={`${formatNumber(f.people_booked)} people`} value={formatMoney(f.total_amount)} note={`incl. VAT ${formatMoney(f.vat_amount)} at ${formatPercent(f.vat_rate)}`} strong />
            <Line
              label="Deposit due"
              value={f.deposit_waived ? "Waived" : formatMoney(f.deposit_due)}
              note={
                booking.deposit_waived || booking.deposit_overridden
                  ? `${booking.deposit_waived ? "Waived" : "Override"}: ${booking.deposit_override_reason ?? "no reason recorded"}`
                  : settings.data
                    ? `max(${settings.data.settings.deposit.min_people} people, ${formatPercent(settings.data.settings.deposit.percent)}) × price`
                    : undefined
              }
              flag={booking.deposit_waived ? "Waived" : booking.deposit_overridden ? "Overridden" : undefined}
              action={
                <Button variant="ghost" size="xs" onClick={() => setDepositOpen(true)}>
                  {booking.deposit_overridden || booking.deposit_waived ? "Change" : "Override / waive"}
                </Button>
              }
            />
            <Line label="Paid" value={formatMoney(f.paid_total)} note={`${pluralise(booking.payments.length, "payment")}`} tone={f.paid_total > 0 ? "ok" : undefined} />
            {!f.deposit_waived ? (
              <Line
                label="Deposit outstanding"
                value={f.deposit_covered ? "Covered" : formatMoney(f.deposit_outstanding)}
                tone={f.deposit_covered ? "ok" : "warn"}
              />
            ) : null}
            <Line label="Balance due" value={formatMoney(f.balance_due)} strong tone={f.balance_due <= 0 ? "ok" : undefined} note={f.final_amount !== null ? `Final amount ${formatMoney(f.final_amount)} on ${formatNumber(f.arrived_count ?? 0)} arrivals` : "Against the booked total until arrivals are recorded"} />
          </dl>
        </Section>

        <Section
          title="Hold"
          actions={
            <Button variant="ghost" size="sm" onClick={() => setHoldOpen(true)}>
              <CalendarClock data-icon="inline-start" />
              Change
            </Button>
          }
        >
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-foreground">{booking.hold_expires_on ? formatDateLong(booking.hold_expires_on) : "No hold expiry set"}</span>
            <HoldExpiryNotice booking={booking} />
            {!["enquiry", "proforma_sent"].includes(booking.status) && booking.hold_expires_on ? (
              <span className="text-xs text-muted-foreground">Only tentative bookings lapse; this one is {booking.status_label.toLowerCase()}.</span>
            ) : null}
          </div>
        </Section>

        <Section title="Reminders" description="Scheduled by the queue from the settings.">
          {booking.reminders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reminders scheduled.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {booking.reminders.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="flex flex-col">
                    <span>{REMINDER_KIND_LABELS[r.kind] ?? humanise(r.kind)}</span>
                    <span className="text-xs text-muted-foreground tabular">Due {formatDate(r.due_on)}</span>
                  </span>
                  <StatusBadge status={r.status} tone={r.status === "sent" ? "green-muted" : r.status === "dismissed" ? "neutral" : "amber"} label={humanise(r.status)} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <PriceOverrideDialog booking={booking} open={priceOpen} onOpenChange={setPriceOpen} />
      <DepositOverrideDialog booking={booking} open={depositOpen} onOpenChange={setDepositOpen} />
      <HoldDialog booking={booking} open={holdOpen} onOpenChange={setHoldOpen} />
    </div>
  );
}

function Line({ label, value, note, flag, action, strong, tone }: { label: string; value: string; note?: string; flag?: string; action?: React.ReactNode; strong?: boolean; tone?: "ok" | "warn" }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("flex items-center gap-1.5", strong ? "font-medium text-foreground" : "text-muted-foreground")}>
          {label}
          {flag ? <StatusBadge status={flag} label={flag} tone="blue" dot={false} /> : null}
        </span>
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </dt>
      <dd className="flex shrink-0 items-center gap-2">
        <span className={cn("tabular", strong && "text-base font-semibold", tone === "ok" && "text-success", tone === "warn" && "text-status-amber-fg font-medium")}>{value}</span>
        {action}
      </dd>
    </div>
  );
}

function NoteBlock({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      {text ? <p className="mt-1 text-sm whitespace-pre-wrap">{text}</p> : <p className="mt-1 text-sm text-muted-foreground">—</p>}
    </div>
  );
}

function NotesComposer({ booking }: { booking: BookingDetail }) {
  const addNote = useAddNote(booking.id);
  const [text, setText] = useState("");
  const notes = booking.events.filter((e) => e.kind === "note").slice(-3).reverse();

  async function submit() {
    const value = text.trim();
    if (!value) return;
    await addNote.mutateAsync({ text: value });
    setText("");
  }

  return (
    <Section title="Add a note" description="Notes go on the timeline with your name and the time.">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="new-note" className="sr-only">
          Note
        </label>
        <Textarea
          id="new-note"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. phoned, they will pay the deposit on Friday"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">Ctrl/⌘ + Enter to add</span>
          <Button type="submit" size="sm" disabled={!text.trim() || addNote.isPending}>
            {addNote.isPending ? <Spinner data-icon="inline-start" /> : <StickyNote data-icon="inline-start" />}
            Add note
          </Button>
        </div>
      </form>
      {notes.length > 0 ? (
        <ul className="mt-4 flex flex-col divide-y divide-border border-t border-border pt-1 text-sm">
          {notes.map((n) => (
            <li key={n.id} className="py-2">
              <p className="whitespace-pre-wrap">{typeof n.data?.text === "string" ? n.data.text : n.summary}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {n.actor_name ?? "System"} · {formatDateTime(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
