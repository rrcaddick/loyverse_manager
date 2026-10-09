/**
 * The right-hand context for a conversation (spec §7):
 *
 *   BookingContextPanel  attached: contact, date, status, visitors, balance,
 *                        documents with "Attach" buttons (into the composer)
 *   AttachPanel          unattached: the matcher's suggestions, a booking
 *                        search, "Not a booking" (v3: the learn dialog) and
 *                        "Send form link"
 *   ContextStrip         the one-line version for narrow layouts
 */

import { ExternalLink, Link2, Paperclip, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingPicker } from "@/features/queue/booking-picker";
import type { BookingListItem } from "@/features/queue/bookings";
import { API_BASE } from "@/lib/api";
import { formatMoney, formatPhone, pluralise } from "@/lib/format";
import { toastWithUndo } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { useAttachThread, useBookingContext, useBounceBack, useDetachThread, useThreadSuggestions } from "./api";
import { parseApiDate, visitDateShort } from "./lib";
import { NotBookingDialog } from "./not-booking-dialog";
import type { MessageItem, Thread, ThreadBooking } from "./types";

/** "in 44 days" / "today" / "12 days ago". */
function daysAway(date: Date): string {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

// ------------------------------------------------------------- attached

interface BookingContextPanelProps {
  booking: ThreadBooking;
  thread: Thread | null;
  onAttachDocument?: (documentId: number) => void;
  onDetach?: () => void;
  className?: string;
}

export function BookingContextPanel({ booking, thread, onAttachDocument, onDetach, className }: BookingContextPanelProps) {
  const detail = useBookingContext(booking.id);
  const [confirmDetach, setConfirmDetach] = useState(false);
  const detach = useDetachThread();
  const b = detail.data;
  const visit = parseApiDate(b?.visit_date ?? booking.visit_date);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <section className="rounded-xl bg-card p-4 ring-1 ring-border" aria-labelledby="ctx-booking">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={`/bookings/${booking.id}`} className="block truncate text-body font-semibold text-foreground underline-offset-4 hover:underline">
              <span className="tabular">{booking.reference}</span> · {booking.group_name}
            </Link>
            <div className="mt-1">
              <StatusPill status={b?.status ?? booking.status} />
            </div>
          </div>
          <Button asChild variant="ghost" size="icon-sm" aria-label="Open booking">
            <Link to={`/bookings/${booking.id}`}>
              <ExternalLink />
            </Link>
          </Button>
        </div>
        <h3 id="ctx-booking" className="sr-only">
          Booking
        </h3>
        {detail.isPending ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Contact</dt>
            <dd className="min-w-0 text-foreground">
              <div className="truncate">{b?.contact_name ?? booking.contact_name ?? "—"}</div>
              {b?.contact_email ? (
                <a href={`mailto:${b.contact_email}`} className="block truncate text-muted-foreground underline-offset-4 hover:underline">
                  {b.contact_email}
                </a>
              ) : null}
              {b?.contact_mobile ? <div className="text-muted-foreground tabular">{formatPhone(b.contact_mobile)}</div> : null}
            </dd>
            <dt className="text-muted-foreground">Date</dt>
            <dd className="text-foreground tabular">
              {visit ? `${visitDateShort(visit.toISOString())} ${visit.getFullYear()}` : "—"}
              {visit ? <span className="text-muted-foreground"> · {daysAway(visit)}</span> : null}
            </dd>
            <dt className="text-muted-foreground">Visitors</dt>
            <dd className="text-foreground tabular">{b ? pluralise(b.people_booked, "person", "people") : "—"}</dd>
            {b ? (
              <>
                <dt className="text-muted-foreground">Balance</dt>
                <dd className="text-foreground tabular">
                  <span className="font-medium">{formatMoney(b.finance.balance_due, { compact: true })}</span>
                  <span className="text-muted-foreground"> of {formatMoney(b.finance.total_amount, { compact: true })}</span>
                </dd>
                <dt className="text-muted-foreground">Deposit</dt>
                <dd className="tabular">
                  {b.finance.deposit_waived ? (
                    <span className="text-muted-foreground">Waived</span>
                  ) : b.finance.deposit_covered ? (
                    <span className="text-green-text">Paid</span>
                  ) : (
                    <span className="text-amber-text">{formatMoney(b.finance.deposit_due, { compact: true })} due</span>
                  )}
                </dd>
              </>
            ) : null}
          </dl>
        )}
      </section>

      <section className="rounded-xl bg-card p-4 ring-1 ring-border" aria-labelledby="ctx-docs">
        <h3 id="ctx-docs" className="mb-2 text-label text-muted-foreground uppercase">
          Documents
        </h3>
        {detail.isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : b && b.documents.length ? (
          <ul className="flex flex-col divide-y divide-border">
            {b.documents.map((d) => (
              <li key={d.id} className="flex min-h-10 items-center gap-2 py-1">
                <a href={`${API_BASE}/documents/${d.id}/pdf`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate text-sm text-foreground underline-offset-4 hover:underline">
                  {d.label} <span className="tabular">{d.number}</span>
                  {d.version > 1 ? <span className="text-muted-foreground"> v{d.version}</span> : null}
                </a>
                {onAttachDocument ? (
                  <Button variant="ghost" size="xs" onClick={() => onAttachDocument(d.id)} aria-label={`Attach ${d.label} ${d.number} to the reply`}>
                    <Paperclip data-icon="inline-start" />
                    Attach
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No documents issued yet.</p>
        )}
      </section>

      {thread && onDetach ? (
        <div>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirmDetach(true)}>
            Detach from {booking.reference}
          </Button>
          <ConfirmDialog
            open={confirmDetach}
            onOpenChange={setConfirmDetach}
            title={`Detach this conversation from ${booking.reference}?`}
            description="Every message in the thread is unlinked from the booking and the conversation goes back to Unmatched. Nothing is deleted or sent."
            confirmLabel="Detach"
            onConfirm={async () => {
              await detach.mutateAsync({ thrid: thread.thrid });
              onDetach();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------- unattached

interface AttachPanelProps {
  thread: Thread;
  /** The latest inbound message (bounce-back is per message). */
  latestInbound: MessageItem | null;
  onAttached?: (booking: { id: number; reference: string }) => void;
  /** After "Not a booking" succeeds (the page moves on). */
  onNotBooking?: () => void;
  /** The open party, so Undo reopens the whole person. */
  partyKey?: string | null;
  /** Focus the search when the panel mounts (the A key). */
  autoFocus?: boolean;
  className?: string;
}

export function AttachPanel({ thread, latestInbound, onAttached, onNotBooking, partyKey = null, autoFocus = false, className }: AttachPanelProps) {
  const suggestions = useThreadSuggestions(thread.thrid);
  const attach = useAttachThread();
  const detach = useDetachThread();
  const bounce = useBounceBack();
  const [picked, setPicked] = useState<BookingListItem | null>(null);
  const [confirmBounce, setConfirmBounce] = useState(false);
  const [notBookingOpen, setNotBookingOpen] = useState(false);
  const busy = attach.isPending;

  async function attachTo(booking: { id: number; reference: string }) {
    await attach.mutateAsync({ thrid: thread.thrid, body: { booking_id: booking.id } });
    toastWithUndo(`Attached to ${booking.reference}`, {
      description: `${pluralise(thread.message_count, "message")} now show on the booking`,
      onUndo: () => detach.mutateAsync({ thrid: thread.thrid }),
    });
    onAttached?.(booking);
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <section className="rounded-xl bg-card p-4 ring-1 ring-border" aria-labelledby="attach-title">
        <h3 id="attach-title" className="flex items-center gap-2 text-body font-semibold text-foreground">
          <Link2 aria-hidden="true" className="size-4 text-amber-solid" />
          Attach to a booking
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">The conversation then shows on the booking and leaves Unmatched.</p>

        <div className="mt-3 flex flex-col gap-2">
          <h4 className="text-label text-muted-foreground uppercase">Suggested</h4>
          {suggestions.isPending ? (
            <div className="space-y-1.5" aria-busy="true">
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
            </div>
          ) : suggestions.data && suggestions.data.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {suggestions.data.map((s) => (
                <li key={s.booking_id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 ring-1 ring-border">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        <span className="tabular">{s.reference}</span> · {s.group_name}
                      </span>
                      <StatusPill status={s.status} size="sm" />
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {visitDateShort(s.visit_date)}
                      {s.contact_name ? ` · ${s.contact_name}` : ""}
                      {s.reasons.length ? ` · ${s.reasons.join(", ")}` : ""}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void attachTo({ id: s.booking_id, reference: s.reference })}>
                    Attach
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No likely match from the sender, references or phone numbers in this mail.</p>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <h4 className="text-label text-muted-foreground uppercase">Or find it</h4>
          <BookingPicker
            value={picked}
            onChange={setPicked}
            autoFocus={autoFocus}
            placeholder="Reference, group or contact"
            renderMeta={(b) => (b.contact_email || b.contact_mobile ? [b.contact_email, b.contact_mobile].filter(Boolean).join(" · ") : null)}
          />
          {picked ? (
            <Button disabled={busy} onClick={() => void attachTo({ id: picked.id, reference: picked.reference })}>
              <Link2 data-icon="inline-start" />
              Attach to {picked.reference}
            </Button>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-border" aria-label="Other options">
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => setNotBookingOpen(true)}>
          Not a booking
        </Button>
        <NotBookingDialog open={notBookingOpen} onOpenChange={setNotBookingOpen} thread={thread} partyKey={partyKey} onDone={onNotBooking} />
        <Button variant="ghost" size="sm" className="justify-start" disabled={!latestInbound || bounce.isPending} onClick={() => setConfirmBounce(true)}>
          Send form link
        </Button>
        <p className="px-2 text-xs text-muted-foreground">The form link asks them to complete the booking request form so a quote can follow.</p>
        <ConfirmDialog
          open={confirmBounce}
          onOpenChange={setConfirmBounce}
          title="Send the booking form link?"
          description={latestInbound ? `Emails ${latestInbound.from_email} a short reply with the link to the public request form. Nothing else is sent.` : undefined}
          confirmLabel="Send form link"
          onConfirm={async () => {
            if (!latestInbound) return;
            await bounce.mutateAsync(latestInbound.id);
          }}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- strip

/** Narrow layouts: one line of booking context, or the attach prompt. */
export function ContextStrip({ booking, onAttach, className }: { booking: ThreadBooking | null; onAttach: () => void; className?: string }) {
  if (!booking) {
    return (
      <div className={cn("flex min-h-10 items-center gap-2 rounded-lg bg-amber-soft px-3 text-sm text-amber-text", className)}>
        <StatusPill tone="amber" label="Unmatched" size="sm" />
        <span className="min-w-0 flex-1 truncate">Not attached to a booking yet.</span>
        <Button size="sm" variant="outline" onClick={onAttach}>
          <Search data-icon="inline-start" />
          Attach
        </Button>
      </div>
    );
  }
  return (
    <div className={cn("flex min-h-10 items-center gap-2 rounded-lg bg-nested px-3 text-sm", className)}>
      <Link to={`/bookings/${booking.id}`} className="min-w-0 flex-1 truncate font-medium text-foreground underline-offset-4 hover:underline">
        <span className="tabular">{booking.reference}</span> · {booking.group_name}
      </Link>
      <span className="shrink-0 text-muted-foreground tabular whitespace-nowrap">{visitDateShort(booking.visit_date)}</span>
      <StatusPill status={booking.status} size="sm" className="shrink-0" />
    </div>
  );
}

export function PanelEmpty() {
  return <EmptyState variant="card" title="Open a conversation" hint="The booking it belongs to, or the attach panel, shows here." />;
}
