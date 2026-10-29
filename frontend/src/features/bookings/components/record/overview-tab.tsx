/**
 * Overview (owner's plan, 29 Oct 2026): the details as the large card, the
 * contacts card and the quick actions on the right, nothing about money
 * (that is the Payments tab). Questions, the internal note, the hold and
 * the collapsed record footer keep their places.
 */

import { CalendarDays, Pencil, UserCheck, Users, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateLong, formatNumber, formatPhone, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ACTION_LABELS, availability, type ActionId } from "../../actions";
import { isTentative, relativeTo, sourceLabel, useGroupTypeLabel } from "../../lib";
import { CONTACT_ROLE_LABELS, primaryContact } from "../../contacts";
import { nextStep } from "../../next-step";
import type { BookingContact, BookingDetail } from "../../types";
import { useBookingActions } from "../../use-booking-actions";
import { QuestionsCard } from "../questions-card";
import { HoldCard, InternalNoteCard, RecordCard, RemindersCard } from "../rail";
import { Gated } from "../record-header";

export function OverviewTab({ booking, onContacts }: { booking: BookingDetail; onContacts: () => void }) {
  return (
    <div className="grid gap-card-gap xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <div className="flex min-w-0 flex-col gap-card-gap">
        <DetailsCard booking={booking} />
        {booking.questions.length > 0 ? <QuestionsCard booking={booking} /> : null}
        <InternalNoteCard booking={booking} />
      </div>
      <div className="flex min-w-0 flex-col gap-card-gap">
        <QuickActionsCard booking={booking} />
        <ContactsCard booking={booking} onManage={onContacts} />
        {isTentative(booking.status) ? <HoldCard booking={booking} /> : booking.reminders.length > 0 ? <RemindersCard booking={booking} /> : null}
        <RecordCard booking={booking} />
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
        <Field label="Arrival">{booking.arrival_time ?? <span className="text-muted-foreground">not given</span>}</Field>
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
        <Field label="Vehicles" numeric>
          {formatNumber(booking.vehicles)}
          <span className="text-muted-foreground"> · {pluralise(booking.gazebos, "gazebo")}</span>
        </Field>
        <Field label="Kind of group">{groupType(booking.group_type)}</Field>
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

const QUICK: ActionId[] = ["send-proforma", "send-ticket-email", "send-ticket-whatsapp", "reminder:still_interested", "reminder:deposit_reminder", "reminder:final_details", "send-payment-confirmation", "send-invoice", "send-final-invoice", "send-answers", "confirm"];

function QuickActionsCard({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const step = nextStep(booking);
  const primary = step.primary?.kind === "send" ? step.primary.action : step.primary?.kind === "record-payment" ? "find-payment" : null;
  const ids = QUICK.filter((id) => !availability(booking, id).hidden);
  const canCancel = booking.allowed_transitions.includes("cancelled");
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Zap aria-hidden="true" className="size-4 text-muted-foreground" />
          Quick actions
        </span>
      }
      description="Every send is a click here until sending rules take over."
    >
      <div className="grid grid-cols-2 gap-2">
        <Button variant={primary === "find-payment" ? "default" : "outline"} size="sm" className="h-auto min-h-9 justify-start whitespace-normal text-left" onClick={() => actions.openFindPayment()}>
          Find payment
        </Button>
        {ids.map((id) => {
          const av = availability(booking, id);
          return (
            <Gated key={id} availability={av}>
              <Button variant={primary === id ? "default" : "outline"} size="sm" className="h-auto min-h-9 w-full justify-start whitespace-normal text-left" disabled={!av.enabled} onClick={() => actions.send(id)}>
                {ACTION_LABELS[id]}
              </Button>
            </Gated>
          );
        })}
        {canCancel ? (
          <Button variant="outline" size="sm" className="h-auto min-h-9 justify-start whitespace-normal text-left text-red-text" onClick={() => actions.changeStatus("cancelled")}>
            Cancel booking
          </Button>
        ) : null}
      </div>
    </Section>
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
