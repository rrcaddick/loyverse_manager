/**
 * Overview (owner's notes, 29 Oct 2026): the quick actions as one row across
 * the top, not a card; the contacts card top left; the details as the large
 * card on the right. Nothing about money beyond the price per visitor, which
 * is just a number here (the Payments tab has the rest). Questions, the
 * internal note, the hold and the collapsed record footer keep their places.
 */

import { CalendarDays, Mail, Pencil, RotateCcw, Users } from "lucide-react";
import { toast } from "sonner";
import { siWhatsapp } from "simple-icons";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { formatDate, formatDateLong, formatDateShort, formatMoney, formatNumber, pluralise, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ACTION_LABELS, availability, type ActionId } from "../../actions";
import { useSetGroup } from "../../api";
import { groupQuestion } from "../../attention";
import { isPastBooking, suggestionLabel, summaryLines, whyText } from "../../groups";
import { isTentative, relativeTo, sourceLabel, useGroupTypeLabel, useTierLabel } from "../../lib";
import { nextStep } from "../../next-step";
import type { BookingDetail } from "../../types";
import { useBookingActions } from "../../use-booking-actions";
import { QuestionsCard } from "../questions-card";
import { HoldCard, InternalNoteCard, RecordCard, RemindersCard } from "../rail";
import { Gated } from "../record-header";

export function OverviewTab({ booking, onHistory }: { booking: BookingDetail; onHistory: () => void }) {
  return (
    <div className="flex flex-col gap-card-gap">
      <QuickActionsRow booking={booking} />
      <div className="grid gap-card-gap xl:grid-cols-[minmax(18rem,1fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-card-gap">
          <GroupCard booking={booking} onHistory={onHistory} />
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
  const canRebook = isPastBooking(booking, todayIso());
  if (email.length === 0 && whatsapp.length === 0 && !canConfirm && !canCancel && !canRebook) return null;

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
      {canRebook ? (
        <Button variant="default" size="sm" onClick={() => actions.openRebook()}>
          <RotateCcw data-icon="inline-start" />
          Rebook
        </Button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------- group

/** The group this booking belongs to, what it did before in a few words, and the way to the group page. */
function GroupCard({ booking, onHistory }: { booking: BookingDetail; onHistory: () => void }) {
  const setGroup = useSetGroup(booking.id);
  const groupType = useGroupTypeLabel();
  const question = groupQuestion(booking);
  const lines = summaryLines(booking.history.summary);
  const upcoming = booking.history.visits.filter((v) => v.relation === "upcoming");
  const g = booking.group;
  async function answer(input: { group_id: number } | { new: true }) {
    try {
      await setGroup.mutateAsync(input);
      toast.success("new" in input ? "Started a new group" : "Linked to the group");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Users aria-hidden="true" className="size-4 text-muted-foreground" />
          Group
        </span>
      }
      actions={
        g ? (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/groups/${g.id}`}>Open group</Link>
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 text-body">
        {g ? (
          <p className="text-foreground">
            <span className="font-medium">{g.name}</span>
            <span className="text-muted-foreground">{[g.area, g.group_type ? groupType(g.group_type) : null, pluralise(g.bookings, "booking")].filter(Boolean).map((part) => ` · ${part}`)}</span>
          </p>
        ) : null}
        {question ? (
          <>
            <p className="text-foreground">
              Same group as <span className="font-medium">{suggestionLabel(question)}</span>?
            </p>
            <p className="text-sm text-muted-foreground">{whyText(question.why)}.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="min-w-24" disabled={setGroup.isPending} onClick={() => answer({ group_id: question.group_id })}>
                Yes
              </Button>
              <Button size="sm" variant="outline-primary" className="min-w-24" disabled={setGroup.isPending} onClick={() => answer({ new: true })}>
                New group
              </Button>
            </div>
          </>
        ) : !g ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground">Not linked to a group yet.</span>
            <Button size="sm" variant="outline" disabled={setGroup.isPending} onClick={() => answer({ new: true })}>
              New group
            </Button>
          </div>
        ) : lines.length > 0 ? (
          <button type="button" onClick={onHistory} className="text-left text-foreground underline-offset-3 hover:underline">
            {lines.slice(0, 3).join(" ")}
          </button>
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
