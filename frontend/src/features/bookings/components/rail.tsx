/**
 * The record's rail (one third): collapsible cards — Details, Contact,
 * Documents, Hold & reminders (tentative only), Internal note, and the
 * collapsed Record footer (barcode, source, created).
 */

import { CalendarClock, CalendarDays, ChevronDown, ExternalLink, Eye, FileSpreadsheet, FileText, Mail, MapPin, Pencil, Phone, Send, StickyNote, User, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { CopyButton } from "@/components/copy-button";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { formatDate, formatDateLong, formatDateTime, formatNumber, formatPhone, humanise, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { availability, latestDocument, type ActionId } from "../actions";
import { documentPdfUrl, fetchDocumentPreview, openBlobInNewTab, useBookingAction, useUpdateBooking } from "../api";
import { holdState, isTentative, relativeTo, sourceLabel, useGroupTypeLabel } from "../lib";
import { DOCUMENT_KIND_LABELS, REMINDER_KIND_LABELS, type BookingDetail, type DocumentKind } from "../types";
import { useBookingActions } from "../use-booking-actions";

export function Rail({ booking }: { booking: BookingDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <DetailsCard booking={booking} />
      <ContactCard booking={booking} />
      <DocumentsCard booking={booking} />
      {isTentative(booking.status) ? <HoldCard booking={booking} /> : booking.reminders.length > 0 ? <RemindersCard booking={booking} /> : null}
      <InternalNoteCard booking={booking} />
      <RecordCard booking={booking} />
    </div>
  );
}

// -------------------------------------------------------------------- card

function RailCard({ title, icon: Icon, actions, defaultOpen = true, children }: { title: string; icon: LucideIcon; actions?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl bg-card ring-1 ring-border">
      <div className="flex min-h-row items-center gap-2 pr-2 pl-4">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-selection-ring">
            <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-body font-semibold text-foreground">{title}</span>
            <ChevronDown aria-hidden="true" className={cn("ml-auto size-4 shrink-0 text-faint-foreground transition-transform", !open && "-rotate-90")} />
          </button>
        </CollapsibleTrigger>
        {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
      </div>
      <CollapsibleContent className="border-t border-border px-4 pt-3 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Lines({ items }: { items: { label: string; value: ReactNode; numeric?: boolean }[] }) {
  return (
    <dl className="flex flex-col gap-1.5">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[6.5rem_1fr] gap-3 text-body">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className={cn("min-w-0 text-foreground", item.numeric && "tabular")}>{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// ----------------------------------------------------------------- details

function DetailsCard({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const groupType = useGroupTypeLabel();
  return (
    <RailCard
      title="Details"
      icon={CalendarDays}
      actions={
        <Button variant="ghost" size="icon-sm" aria-label="Edit details" onClick={() => actions.openEdit()}>
          <Pencil />
        </Button>
      }
    >
      <Lines
        items={[
          {
            label: "Visit",
            value: (
              <span>
                <Link to={`/today/${booking.visit_date}`} className="font-medium underline-offset-3 hover:underline">
                  {formatDateLong(booking.visit_date)}
                </Link>
                <span className="text-muted-foreground"> · {relativeTo(booking.visit_date)}</span>
                {booking.alternative_date ? <span className="block text-sm text-muted-foreground">or {formatDate(booking.alternative_date)}</span> : null}
              </span>
            ),
          },
          { label: "Arrival", value: booking.arrival_time ?? <span className="text-muted-foreground">not given</span> },
          { label: "Visitors", value: formatNumber(booking.people_booked), numeric: true },
          {
            label: "Vehicles",
            value: (
              <span className="tabular">
                {formatNumber(booking.vehicles)}
                <span className="text-muted-foreground"> · {pluralise(booking.gazebos, "gazebo")}</span>
              </span>
            ),
          },
          { label: "Area", value: booking.area ?? <span className="text-muted-foreground">—</span> },
          { label: "Kind", value: groupType(booking.group_type) },
        ]}
      />
    </RailCard>
  );
}

// ----------------------------------------------------------------- contact

function ContactCard({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  return (
    <RailCard
      title="Contact"
      icon={User}
      actions={
        <Button variant="ghost" size="icon-sm" aria-label="Edit contact" onClick={() => actions.openEdit("contact")}>
          <Pencil />
        </Button>
      }
    >
      <div className="flex flex-col gap-2 text-body">
        <div className="flex items-center gap-2">
          <User aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">{booking.contact_name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Mail aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {booking.contact_email ? (
            <a href={`mailto:${booking.contact_email}`} className="truncate text-foreground underline-offset-3 hover:underline">
              {booking.contact_email}
            </a>
          ) : (
            <button type="button" onClick={() => actions.openEdit("contact")} className="text-amber-text underline-offset-3 hover:underline">
              No email — add one
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Phone aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {booking.contact_mobile ? (
            <a href={`tel:+${booking.contact_mobile}`} className="tabular text-foreground underline-offset-3 hover:underline">
              {formatPhone(booking.contact_mobile)}
            </a>
          ) : (
            <span className="text-muted-foreground">No mobile</span>
          )}
        </div>
        {booking.billing_address ? (
          <div className="flex items-start gap-2">
            <MapPin aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-label text-muted-foreground uppercase">Billing address</div>
              <p className="whitespace-pre-line text-foreground">{booking.billing_address}</p>
            </div>
          </div>
        ) : null}
        {booking.customer_vat_number ? (
          <div className="grid grid-cols-[6.5rem_1fr] gap-3">
            <span className="text-muted-foreground">VAT number</span>
            <span className="font-mono text-foreground">{booking.customer_vat_number}</span>
          </div>
        ) : null}
      </div>
    </RailCard>
  );
}

// --------------------------------------------------------------- documents

const DOC_SEND: Record<DocumentKind, ActionId> = { proforma: "send-proforma", invoice: "send-invoice", final_invoice: "send-final-invoice" };

function DocumentsCard({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const [previewing, setPreviewing] = useState<DocumentKind | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const issue = useBookingAction(booking.id);

  async function preview(kind: DocumentKind) {
    setPreviewing(kind);
    try {
      await openBlobInNewTab(() => fetchDocumentPreview(booking.id, kind));
    } catch (err) {
      toast.error(errorMessage(err, "Could not render the preview"));
    } finally {
      setPreviewing(null);
    }
  }

  const kinds: DocumentKind[] = ["proforma", "invoice", "final_invoice"];
  const ended = booking.status === "cancelled" || booking.status === "lapsed" || booking.status === "no_show";

  return (
    <RailCard title="Documents" icon={FileText}>
      <ul className="flex flex-col divide-y divide-border">
        {kinds.map((kind) => {
          const latest = latestDocument(booking, kind);
          const send = availability(booking, DOC_SEND[kind]);
          if (!latest && (send.hidden || ended)) return null;
          return (
            <li key={kind} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-body">
                  <span className="font-medium text-foreground">{DOCUMENT_KIND_LABELS[kind]}</span>
                  {latest ? <span className="font-mono text-sm text-muted-foreground">{latest.number}</span> : null}
                  {latest && latest.version > 1 ? <StatusPill tone="neutral" label={`v${latest.version}`} size="sm" dot={false} /> : null}
                </div>
                <div className="text-sm text-muted-foreground">{latest ? `${formatDate(latest.issued_at)}${latest.email_message_id ? " · emailed" : " · not emailed"}` : "Not issued yet"}</div>
              </div>
              {latest ? (
                <Button asChild variant="ghost" size="sm" aria-label={`Preview ${DOCUMENT_KIND_LABELS[kind]} ${latest.number}`}>
                  <a href={documentPdfUrl(latest.id)} target="_blank" rel="noopener">
                    <ExternalLink data-icon="inline-start" />
                    Preview
                  </a>
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => preview(kind)} disabled={previewing !== null} aria-label={`Preview the ${DOCUMENT_KIND_LABELS[kind].toLowerCase()} as it would be issued now`}>
                  {previewing === kind ? <Spinner data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
                  Preview
                </Button>
              )}
              <Button variant="ghost" size="sm" disabled={!send.enabled} title={send.enabled ? undefined : send.reason} onClick={() => actions.send(DOC_SEND[kind])}>
                <Send data-icon="inline-start" />
                Send
              </Button>
            </li>
          );
        })}
      </ul>
      {booking.documents.length > 0 ? (
        <Collapsible open={allOpen} onOpenChange={setAllOpen} className="mt-3">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex items-center gap-1 text-sm text-muted-foreground underline-offset-3 hover:underline">
              <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform", !allOpen && "-rotate-90")} />
              All versions ({booking.documents.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {booking.documents.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <a href={documentPdfUrl(d.id)} target="_blank" rel="noopener" className="font-mono text-foreground underline-offset-3 hover:underline">
                    {d.number}
                  </a>
                  <span className="text-muted-foreground">
                    v{d.version} · {formatDateTime(d.issued_at)} · {d.label}
                  </span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {!ended && !latestDocument(booking, "proforma") && isTentative(booking.status) ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          disabled={issue.isPending}
          onClick={async () => {
            try {
              const detail = await issue.mutateAsync({ action: "issue-proforma" });
              const doc = detail.action_result?.document;
              toast.success(doc ? `${doc.label} ${doc.number} issued (version ${doc.version})` : "Proforma issued");
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          {issue.isPending ? <Spinner data-icon="inline-start" /> : <FileText data-icon="inline-start" />}
          Issue proforma without sending
        </Button>
      ) : null}
    </RailCard>
  );
}

// -------------------------------------------------------------------- hold

function HoldCard({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const hold = holdState(booking);
  return (
    <RailCard
      title="Hold & reminders"
      icon={CalendarClock}
      actions={
        <Button variant="ghost" size="icon-sm" aria-label="Change the hold expiry" onClick={actions.openHold}>
          <Pencil />
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-body">
        <div>
          <div className="text-foreground">{booking.hold_expires_on ? `Hold until ${formatDateLong(booking.hold_expires_on)}` : "No hold expiry set"}</div>
          {hold && hold.tone !== "neutral" ? <div className={cn("text-sm font-medium", hold.tone === "red" ? "text-red-text" : "text-amber-text")}>{hold.text}</div> : null}
        </div>
        <ReminderList booking={booking} />
      </div>
    </RailCard>
  );
}

function ReminderList({ booking }: { booking: BookingDetail }) {
  if (booking.reminders.length === 0) return <p className="text-sm text-muted-foreground">No reminders scheduled. Work schedules them from the Settings.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {booking.reminders.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
          <span className="flex flex-col">
            <span>{REMINDER_KIND_LABELS[r.kind] ?? humanise(r.kind)}</span>
            <span className="text-sm tabular text-muted-foreground">
              Due {formatDate(r.due_on)} · {relativeTo(r.due_on)}
            </span>
          </span>
          <StatusPill tone={r.status === "sent" ? "green-muted" : r.status === "dismissed" ? "neutral" : "amber"} label={humanise(r.status)} size="sm" />
        </li>
      ))}
    </ul>
  );
}

/** Firm and ended bookings have no hold, but may still carry reminders (final details). */
function RemindersCard({ booking }: { booking: BookingDetail }) {
  return (
    <RailCard title="Reminders" icon={CalendarClock}>
      <div className="text-body">
        <ReminderList booking={booking} />
      </div>
    </RailCard>
  );
}

// ---------------------------------------------------------- internal note

function InternalNoteCard({ booking }: { booking: BookingDetail }) {
  const update = useUpdateBooking(booking.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(booking.internal_notes ?? "");

  async function save() {
    const value = draft.trim() || null;
    if (value === (booking.internal_notes ?? null)) {
      setEditing(false);
      return;
    }
    await update.mutateAsync({ internal_notes: value });
    toast.success("Internal note saved");
    setEditing(false);
  }

  return (
    <RailCard
      title="Internal note"
      icon={StickyNote}
      defaultOpen={!!booking.internal_notes || !!booking.customer_notes}
      actions={
        !editing ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit the internal note"
            onClick={() => {
              setDraft(booking.internal_notes ?? "");
              setEditing(true);
            }}
          >
            <Pencil />
          </Button>
        ) : null
      }
    >
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus placeholder="Standing information about this group — only the office sees it." />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={update.isPending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={update.isPending}>
              {update.isPending ? <Spinner data-icon="inline-start" /> : null}
              Save
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3 text-body">
          {booking.internal_notes ? <p className="whitespace-pre-wrap text-foreground">{booking.internal_notes}</p> : <p className="text-muted-foreground">Nothing yet. Standing information about the group — only the office sees it.</p>}
          {booking.customer_notes ? (
            <div>
              <div className="text-label text-muted-foreground uppercase">From the customer</div>
              <p className="mt-1 whitespace-pre-wrap text-foreground">{booking.customer_notes}</p>
            </div>
          ) : null}
        </div>
      )}
    </RailCard>
  );
}

// ------------------------------------------------------------------ record

function RecordCard({ booking }: { booking: BookingDetail }) {
  const sheetRow = booking.legacy_sheet_row?._row;
  return (
    <RailCard title="Record" icon={FileSpreadsheet} defaultOpen={false}>
      <Lines
        items={[
          { label: "Reference", value: <span className="font-mono">{booking.reference}</span> },
          {
            label: "Barcode",
            value: booking.barcode ? (
              <span className="inline-flex items-center gap-1">
                <span className="font-mono">{booking.barcode}</span>
                <CopyButton value={booking.barcode} size="icon-xs" variant="ghost" />
              </span>
            ) : (
              "—"
            ),
          },
          {
            label: "Source",
            value: booking.source === "import" ? `Imported from the booking sheet${sheetRow ? ` (row ${sheetRow})` : ""}` : sourceLabel(booking.source),
          },
          { label: "Enquiry", value: booking.enquiry_date ? formatDate(booking.enquiry_date) : "—" },
          { label: "Created", value: formatDateTime(booking.created_at) },
          { label: "Updated", value: formatDateTime(booking.updated_at) },
          { label: "Tier", value: booking.price_tier_code ? humanise(booking.price_tier_code) : "—" },
        ]}
      />
    </RailCard>
  );
}
