/**
 * Next steps (6 Nov 2026): the pipeline as a short dated list, Proforma →
 * Deposit → Ticket → Visit → Final invoice, each line with its date and the
 * verb that belongs to it, the step that is next in the filled style. It
 * replaces the quick-actions row, the Expiry card and the Reminders card:
 * expiry is the deposit line's date, reminders are its Remind verb.
 */

import { Check, Circle, CircleDot } from "lucide-react";
import type { ReactNode } from "react";

import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateShort, formatMoney, formatNumber, pluralise, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ACTION_LABELS, availability, type ActionId } from "../../actions";
import { isPastBooking } from "../../groups";
import { daysFromToday, holdState, lastStatusReason, relativeTo } from "../../lib";
import { nextStep } from "../../next-step";
import type { BookingDetail } from "../../types";
import { useBookingActions } from "../../use-booking-actions";
import { Gated } from "../record-header";

type State = "done" | "current" | "later" | "off";

interface Row {
  key: string;
  state: State;
  label: string;
  detail: ReactNode;
  verbs: ReactNode[];
}

const money = (n: number) => formatMoney(n, { compact: true });

export function NextStepsCard({ booking: b }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const f = b.finance;
  const step = nextStep(b);
  const primaryAction = step.primary?.kind === "send" ? step.primary.action : null;
  const toVisit = daysFromToday(b.visit_date);

  const sendButton = (id: ActionId, label?: string, filled = false) => {
    const av = availability(b, id);
    if (av.hidden) return null;
    return (
      <Gated key={id} availability={av}>
        <Button variant={filled ? "default" : "outline"} size="sm" disabled={!av.enabled} onClick={() => actions.send(id)}>
          {label ?? ACTION_LABELS[id]}
        </Button>
      </Gated>
    );
  };
  const button = (key: string, label: string, onClick: () => void, filled = false, className?: string) => (
    <Button key={key} variant={filled ? "default" : "outline"} size="sm" onClick={onClick} className={className}>
      {label}
    </Button>
  );

  const rows: Row[] = [];
  const ended = b.status === "cancelled" || b.status === "lapsed" || b.status === "no_show" || b.status === "declined";

  if (ended) {
    const stamp = b.status === "cancelled" ? b.cancelled_at : b.status === "lapsed" ? b.lapsed_at : b.status === "declined" ? b.declined_at : b.updated_at;
    const reason = lastStatusReason(b);
    rows.push({
      key: "ended",
      state: "off",
      label: b.status_label,
      detail: `${stamp ? formatDate(stamp) : ""}${reason ? ` · ${reason}` : ""}${f.paid_total > 0 ? ` · ${money(f.paid_total)} paid` : ""}`,
      verbs: [
        b.status === "lapsed" ? sendButton("send-expiry", undefined, false) : null,
        b.allowed_transitions.includes("requested") ? button("reopen", "Back to request", () => actions.changeStatus("requested")) : null,
      ].filter(Boolean) as ReactNode[],
    });
  } else {
    // ---- proforma
    const proformaDone = !!b.proforma_sent_at;
    rows.push({
      key: "proforma",
      state: proformaDone ? "done" : b.status === "requested" ? "current" : "later",
      label: "Proforma",
      detail: proformaDone ? `Sent ${formatDate(b.proforma_sent_at!)}` : b.status === "requested" ? "Sending it accepts the request" : "Not sent",
      verbs: [sendButton("send-proforma", proformaDone ? "Re-send proforma" : undefined, primaryAction === "send-proforma"), b.status === "requested" ? sendButton("send-form") : null].filter(Boolean) as ReactNode[],
    });

    // ---- deposit
    const depositPaid = f.deposit_waived || (f.deposit_covered && f.paid_total > 0);
    const firstPayment = [...b.payments].filter((p) => p.amount > 0).sort((a, c) => (a.paid_on ?? a.created_at) < (c.paid_on ?? c.created_at) ? -1 : 1)[0];
    const hold = holdState(b);
    const sentReminders = b.reminders.filter((r) => r.status === "sent").sort((a, c) => (a.due_on < c.due_on ? 1 : -1));
    const dueReminder = b.reminders.find((r) => r.status === "due");
    const depositDetail = f.deposit_waived
      ? "Waived"
      : depositPaid
        ? `Paid${firstPayment?.paid_on ? ` ${formatDate(firstPayment.paid_on)}` : b.confirmed_at ? ` ${formatDate(b.confirmed_at)}` : ""}${f.deposit_due > 0 ? ` · ${money(f.deposit_due)}` : ""}`
        : [
            `${money(f.deposit_due)} due`,
            b.hold_expires_on ? (hold ? `by ${formatDate(b.hold_expires_on)} (${hold.relative})` : `by ${formatDate(b.hold_expires_on)}`) : null,
            f.paid_total > 0 ? `${money(f.paid_total)} received` : null,
            sentReminders.length ? `${pluralise(sentReminders.length, "reminder")} sent, last ${formatDateShort(sentReminders[0]?.due_on ?? "")}` : dueReminder ? `reminder due ${formatDateShort(dueReminder.due_on)}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
    rows.push({
      key: "deposit",
      state: depositPaid ? "done" : b.status === "proforma_sent" ? "current" : "later",
      label: "Deposit",
      detail: <span className={cn(hold && !depositPaid && hold.tone === "red" && "text-red-text", hold && !depositPaid && hold.tone === "amber" && "text-amber-text")}>{depositDetail}</span>,
      verbs:
        depositPaid || b.status === "requested"
          ? []
          : ([
              button("record", ACTION_LABELS["record-payment"], () => actions.openFindPayment(), step.primary?.kind === "record-payment"),
              sendButton("reminder:deposit_reminder", "Remind"),
              button("extend", "Extend expiry", () => actions.openHold()),
            ].filter(Boolean) as ReactNode[]),
    });

    // ---- ticket
    const ticketSent = !!(b.ticket_sent_at || b.ticket_emailed_at);
    rows.push({
      key: "ticket",
      state: ticketSent ? "done" : b.status === "confirmed" && toVisit >= 0 ? "current" : "later",
      label: "Vehicle ticket",
      detail: ticketSent ? `Sent ${formatDate((b.ticket_sent_at ?? b.ticket_emailed_at)!)}${b.ticket_sent_at ? " by WhatsApp" : " by email"}` : b.status === "confirmed" ? "Not sent yet" : "After the deposit",
      verbs: b.status === "confirmed" || b.status === "completed" ? ([sendButton("send-ticket", ticketSent ? "Re-send ticket" : "Send ticket", primaryAction === "send-ticket")].filter(Boolean) as ReactNode[]) : [],
    });

    // ---- visit
    const visited = b.status === "completed" || toVisit < 0;
    const arrived = b.arrived_count;
    rows.push({
      key: "visit",
      state: visited ? "done" : toVisit === 0 ? "current" : "later",
      label: "Visit",
      detail: `${formatDateShort(b.visit_date)} ${b.visit_date.slice(0, 4)} · ${relativeTo(b.visit_date)} · ${formatNumber(b.people_booked)} booked${arrived !== null ? ` · ${formatNumber(arrived)} arrived` : visited ? " · no arrivals counted" : ""}`,
      verbs: [visited && arrived === null && b.allowed_transitions.includes("no_show") ? button("noshow", "No show", () => actions.changeStatus("no_show"), false, "text-red-text") : null].filter(Boolean) as ReactNode[],
    });

    // ---- final invoice
    if (b.status === "completed" || visited) {
      const finalSent = !!b.final_invoice_sent_at;
      rows.push({
        key: "final",
        state: finalSent ? (f.balance_due > 0.005 ? "current" : "done") : "current",
        label: "Final invoice",
        detail: finalSent
          ? `Sent ${formatDate(b.final_invoice_sent_at!)} · ${f.balance_due > 0.005 ? `${money(f.balance_due)} owed` : f.balance_due < -0.005 ? `credit ${money(-f.balance_due)}` : "paid in full"}`
          : `${f.final_amount !== null ? `Final ${money(f.final_amount)} · ` : ""}paid ${money(f.paid_total)}`,
        verbs: [
          sendButton("send-final-invoice", finalSent ? "Re-send final invoice" : undefined, primaryAction === "send-final-invoice"),
          f.balance_due > 0.005 ? button("record-final", ACTION_LABELS["record-payment"], () => actions.openFindPayment(), step.primary?.kind === "record-payment") : null,
        ].filter(Boolean) as ReactNode[],
      });
    }
  }

  const canCancel = b.allowed_transitions.includes("cancelled");
  const canRebook = isPastBooking(b, todayIso());

  return (
    <Section
      title="Next steps"
      description={step.title}
      actions={
        <div className="flex items-center gap-2">
          {canRebook ? (
            <Button size="sm" onClick={() => actions.openRebook()}>
              Rebook
            </Button>
          ) : null}
          {canCancel ? (
            <Button variant="ghost" size="sm" className="text-red-text" onClick={() => actions.changeStatus("cancelled")}>
              Cancel booking
            </Button>
          ) : null}
        </div>
      }
    >
      <ol className="flex flex-col divide-y divide-border">
        {rows.map((r) => (
          <li key={r.key} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0", r.state === "later" && "text-muted-foreground")}>
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <StateMark state={r.state} />
              <span className="min-w-0">
                <span className={cn("block text-body", r.state === "current" ? "font-semibold text-foreground" : r.state === "done" ? "text-foreground" : "")}>{r.label}</span>
                <span className="block truncate text-sm text-muted-foreground">{r.detail}</span>
              </span>
            </span>
            {r.verbs.length ? <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">{r.verbs}</span> : null}
          </li>
        ))}
      </ol>
    </Section>
  );
}

function StateMark({ state }: { state: State }) {
  if (state === "done") {
    return (
      <span aria-label="Done" className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-green-solid text-white">
        <Check aria-hidden="true" className="size-3.5" />
      </span>
    );
  }
  if (state === "current") return <CircleDot aria-label="Next" className="size-5 shrink-0 text-primary" />;
  return <Circle aria-label={state === "off" ? "Ended" : "Later"} className="size-5 shrink-0 text-faint-foreground" />;
}
