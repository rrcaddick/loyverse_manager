/**
 * Overview (owner's notes, 29 Oct 2026): the quick actions as one row across
 * the top, not a card; the contacts card top left; the details as the large
 * card on the right. Nothing about money beyond the price per visitor, which
 * is just a number here (the Payments tab has the rest). Questions, the
 * internal note, the hold and the collapsed record footer keep their places.
 */

import { CalendarDays, Mail, Pencil, UserCheck, Users } from "lucide-react";
import { siWhatsapp } from "simple-icons";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateLong, formatMoney, formatNumber, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ACTION_LABELS, availability, type ActionId } from "../../actions";
import { isTentative, relativeTo, sourceLabel, useGroupTypeLabel, useTierLabel } from "../../lib";
import { CONTACT_ROLE_LABELS, primaryContact } from "../../contacts";
import { nextStep } from "../../next-step";
import type { BookingContact, BookingDetail } from "../../types";
import { useBookingActions } from "../../use-booking-actions";
import { QuestionsCard } from "../questions-card";
import { HoldCard, InternalNoteCard, RecordCard, RemindersCard } from "../rail";
import { Gated } from "../record-header";

export function OverviewTab({ booking, onContacts }: { booking: BookingDetail; onContacts: () => void }) {
  return (
    <div className="flex flex-col gap-card-gap">
      <QuickActionsRow booking={booking} />
      <div className="grid gap-card-gap xl:grid-cols-[minmax(18rem,1fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-card-gap">
          <ContactsCard booking={booking} onManage={onContacts} />
          {isTentative(booking.status) ? <HoldCard booking={booking} /> : booking.reminders.length > 0 ? <RemindersCard booking={booking} /> : null}
          <RecordCard booking={booking} />
        </div>
        <div className="flex min-w-0 flex-col gap-card-gap">
          <DetailsCard booking={booking} />
          {booking.questions.length > 0 ? <QuestionsCard booking={booking} /> : null}
          <InternalNoteCard booking={booking} />
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- details

function Field({ label, children, wide = false, numeric = false }: { label: string; children: ReactNode; wide?: boolean; numeric?: boolean }) {
  return (
    <div className={cn("grid gap-0.5", wide && "sm:col-span-2")}>
      <dt className="text-label text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("min-w-0 text-body text-foreground", numeric && "tabular")}>{children}</dd>
    </div>
  );
}

function DetailsCard({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const groupType = useGroupTypeLabel();
  const tierLabel = useTierLabel();
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <CalendarDays aria-hidden="true" className="size-4 text-muted-foreground" />
          Details
        </span>
      }
      actions={
        <Button variant="ghost" size="sm" onClick={() => actions.openEdit()}>
          <Pencil data-icon="inline-start" />
          Edit
        </Button>
      }
    >
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Field label="Visit">
          <Link to={`/today/${booking.visit_date}`} className="font-medium underline-offset-3 hover:underline">
            {formatDateLong(booking.visit_date)}
          </Link>
          <span className="text-muted-foreground"> · {relativeTo(booking.visit_date)}</span>
          {booking.alternative_date ? <span className="block text-sm text-muted-foreground">or {formatDate(booking.alternative_date)}</span> : null}
        </Field>
        <Field label="Visitors" numeric>
          {formatNumber(booking.people_booked)}
          {booking.adults || booking.children ? (
            <span className="text-muted-foreground">
              {" "}
              · {formatNumber(booking.adults)} adults · {formatNumber(booking.children)} children
            </span>
          ) : null}
          {booking.arrived_count !== null ? <span className="text-green-text"> · {formatNumber(booking.arrived_count)} arrived</span> : null}
        </Field>
        <Field label="Kind of group">{groupType(booking.group_type)}</Field>
        <Field label="Rate">
          {tierLabel(booking.price_tier_code)}
          {booking.minimum_waived_by ? <span className="text-muted-foreground"> · minimum waived, another group that day</span> : null}
        </Field>
        <Field label="Price per visitor" numeric>
          {formatMoney(booking.price_per_person, { compact: true })}
          {booking.discount_per_person > 0 ? (
            <span className="text-muted-foreground">
              {" "}
              · {formatMoney(booking.tier_price ?? booking.price_per_person + booking.discount_per_person, { compact: true })} less {formatMoney(booking.discount_per_person, { compact: true })}
              {booking.discount_reason ? ` (${booking.discount_reason})` : ""}
            </span>
          ) : null}
        </Field>
        <Field label="Area">{booking.area ?? <span className="text-muted-foreground">—</span>}</Field>
        {booking.customer_notes ? (
          <Field label="From the customer" wide>
            <p className="whitespace-pre-wrap">{booking.customer_notes}</p>
          </Field>
        ) : null}
        <Field label="Source">
          {sourceLabel(booking.source)}
          {booking.enquiry_date ? <span className="text-muted-foreground"> · enquired {formatDate(booking.enquiry_date)}</span> : null}
        </Field>
        <Field label="Reference" numeric>
          <span className="font-mono">{booking.reference}</span>
          {booking.barcode ? <span className="text-muted-foreground"> · ticket {booking.barcode}</span> : null}
        </Field>
      </dl>
    </Section>
  );
}

// ----------------------------------------------------------- quick actions

const EMAIL_ACTIONS: ActionId[] = ["send-proforma", "reminder:still_interested", "reminder:deposit_reminder", "reminder:final_details", "send-payment-confirmation", "send-invoice", "send-final-invoice", "send-answers"];
const WHATSAPP_ACTIONS: ActionId[] = ["send-ticket"];

/** A plain mail glyph for email; the WhatsApp mark (simple-icons) for WhatsApp, both in the button's text colour. */
const CHANNEL = {
  email: { mark: <Mail aria-hidden="true" className="size-4 shrink-0" /> },
  whatsapp: {
    mark: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0 fill-current">
        <title>WhatsApp</title>
        <path d={siWhatsapp.path} />
      </svg>
    ),
  },
} as const;

/** Amber while nothing has gone out, green once it has (and the verb becomes Re-send). */
const SENT_STYLE = "border-transparent bg-[#16a34a] text-white hover:bg-[#15803d]";
const UNSENT_STYLE = "border-transparent bg-[#f59e0b] text-[#1f1a0a] hover:bg-[#d97706]";

const EMAIL_KIND: Partial<Record<ActionId, string>> = {
  "send-proforma": "proforma",
  "send-invoice": "invoice",
  "send-final-invoice": "final_invoice",
  "send-payment-confirmation": "payment_confirmation",
  "send-answers": "answers",
  "reminder:still_interested": "still_interested",
  "reminder:deposit_reminder": "deposit_reminder",
  "reminder:final_details": "final_details",
};

function sentBefore(b: BookingDetail, id: ActionId): boolean {
  if (id === "send-ticket") return !!(b.ticket_sent_at || b.ticket_emailed_at);
  if (id === "send-proforma" && b.proforma_sent_at) return true;
  if (id === "send-invoice" && b.invoice_sent_at) return true;
  if (id === "send-final-invoice" && b.final_invoice_sent_at) return true;
  const kind = EMAIL_KIND[id];
  return !!kind && b.emails.some((m) => m.direction === "outbound" && m.kind === kind && m.send_status !== "failed");
}

/** One row across the top, grouped by channel: email, then WhatsApp, then our own actions. */
function QuickActionsRow({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const step = nextStep(booking);
  const primary = step.primary?.kind === "send" ? step.primary.action : null;
  const email = EMAIL_ACTIONS.filter((id) => !availability(booking, id).hidden);
  const whatsapp = WHATSAPP_ACTIONS.filter((id) => !availability(booking, id).hidden);
  const canConfirm = !availability(booking, "confirm").hidden;
  const canCancel = booking.allowed_transitions.includes("cancelled");
  if (email.length === 0 && whatsapp.length === 0 && !canConfirm && !canCancel) return null;

  const channelButton = (id: ActionId, channel: keyof typeof CHANNEL) => {
    const av = availability(booking, id);
    const sent = sentBefore(booking, id);
    const label = sent ? ACTION_LABELS[id].replace(/^Send /, "Re-send ") : ACTION_LABELS[id];
    return (
      <Gated key={id} availability={av}>
        <Button variant="outline" size="sm" className={cn("gap-2 font-medium", sent ? SENT_STYLE : UNSENT_STYLE)} disabled={!av.enabled} onClick={() => actions.send(id)}>
          {CHANNEL[channel].mark}
          {label}
        </Button>
      </Gated>
    );
  };

  return (
    <div role="group" aria-label="Quick actions" className="flex flex-wrap items-center gap-2">
      {email.map((id) => channelButton(id, "email"))}
      {email.length && whatsapp.length ? <span aria-hidden="true" className="mx-1 h-6 w-px bg-border" /> : null}
      {whatsapp.map((id) => channelButton(id, "whatsapp"))}
      {(email.length || whatsapp.length) && (canConfirm || canCancel) ? <span aria-hidden="true" className="mx-1 h-6 w-px bg-border" /> : null}
      {canConfirm ? (
        <Gated availability={availability(booking, "confirm")}>
          <Button variant={primary === "confirm" ? "default" : "outline"} size="sm" disabled={!availability(booking, "confirm").enabled} onClick={() => actions.send("confirm")}>
            {ACTION_LABELS.confirm}
          </Button>
        </Gated>
      ) : null}
      {canCancel ? (
        <Button variant="outline" size="sm" className="text-red-text" onClick={() => actions.changeStatus("cancelled")}>
          Cancel booking
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- contacts


function ContactsCard({ booking, onManage }: { booking: BookingDetail; onManage: () => void }) {
  const primary = primaryContact(booking);
  const others = booking.contacts.filter((c) => c.role !== "primary");
  const onSite = booking.contacts.find((c) => c.on_site);
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Users aria-hidden="true" className="size-4 text-muted-foreground" />
          Contacts
        </span>
      }
      actions={
        <Button variant="ghost" size="sm" onClick={onManage}>
          Manage
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-body">
        <ContactLine contact={primary} />
        {others.slice(0, 4).map((c) => (
          <ContactLine key={c.id} contact={c} />
        ))}
        {others.length > 4 ? <span className="text-sm text-muted-foreground">+ {others.length - 4} more</span> : null}
        {!onSite ? <span className="text-sm text-muted-foreground">Nobody marked as on site on the day yet.</span> : null}
      </div>
    </Section>
  );
}

function ContactLine({ contact }: { contact: BookingContact }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="truncate font-medium text-foreground">{contact.name || contact.email}</span>
        <span className="text-sm text-muted-foreground">{CONTACT_ROLE_LABELS[contact.role]}</span>
        {contact.on_site ? <StatusPill tone="green" label="On the day" size="sm" icon={UserCheck} /> : null}
      </span>
      <span className="flex min-w-0 flex-wrap gap-x-3 text-sm text-muted-foreground">
        {contact.email ? (
          <a href={`mailto:${contact.email}`} className="truncate underline-offset-3 hover:underline">
            {contact.email}
          </a>
        ) : null}
        {contact.mobile ? (
          <a href={`tel:+${contact.mobile}`} className="tabular underline-offset-3 hover:underline">
            {formatPhone(contact.mobile)}
          </a>
        ) : null}
      </span>
    </div>
  );
}
