/**
 * One payment, in full: everything we hold for it, the bank transaction's
 * fields included, with what can be done about a mistake at the bottom —
 * Release (the credit goes back to unallocated) or Move to another booking.
 * A payment without a bank transaction (an import, cash at the gate) can only
 * be removed.
 */

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Landmark, Search, Unlink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney, humanise } from "@/lib/format";
import type { Paginated } from "@/types/api";

import { useBookings, useDeletePayment, useMovePayment, useReleasePayment } from "../../api";
import { PAYMENT_KIND_LABELS, type BookingDetail, type BookingListItem, type Payment } from "../../types";

const money = (n: number) => formatMoney(n, { compact: true });

export function PaymentDialog({ booking, payment, open, onOpenChange }: { booking: BookingDetail; payment: Payment | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">{open && payment ? <Body key={payment.id} booking={booking} payment={payment} onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

type Mode = "view" | "move";

function Body({ booking, payment, onDone }: { booking: BookingDetail; payment: Payment; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("view");
  const tx = useQuery({
    queryKey: ["payments", "bank-transaction", payment.bank_transaction_id] as const,
    queryFn: () => api.get<Record<string, unknown>>(`/payments/bank-transactions/${payment.bank_transaction_id}`),
    enabled: payment.bank_transaction_id !== null,
    staleTime: 60_000,
  });
  const release = useReleasePayment(booking.id);
  const remove = useDeletePayment(booking.id);
  const busy = release.isPending || remove.isPending;

  const own: [string, unknown][] = [
    ["Amount", money(payment.amount)],
    ["Kind", PAYMENT_KIND_LABELS[payment.kind] ?? payment.kind],
    ["Paid on", payment.paid_on ? formatDate(payment.paid_on) : null],
    ["Reference", payment.reference],
    ["Note", payment.note],
    ["Recorded by", payment.recorded_by_name ?? (payment.bank_transaction_id ? "Bank feed" : "System")],
    ["Recorded", formatDateTime(payment.created_at)],
  ];
  const bank: [string, unknown][] = tx.data ? bankFields(tx.data) : [];

  async function doRelease() {
    try {
      if (payment.bank_transaction_id) await release.mutateAsync(payment.bank_transaction_id);
      else await remove.mutateAsync(payment.id);
      toast.success(payment.bank_transaction_id ? `${money(payment.amount)} released from ${booking.reference}` : `${money(payment.amount)} removed`);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-section">
          {money(payment.amount)} · {PAYMENT_KIND_LABELS[payment.kind] ?? payment.kind}
        </DialogTitle>
        <DialogDescription>{payment.bank_transaction_id ? `Bank credit #${payment.bank_transaction_id} on ${booking.reference}` : `On ${booking.reference}`}</DialogDescription>
      </DialogHeader>
      {mode === "view" ? (
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <Fields title="Payment" rows={own} />
          {payment.bank_transaction_id ? (
            tx.isPending ? (
              <p className="flex items-center gap-2 pt-3 text-sm text-muted-foreground">
                <Spinner /> Loading the bank transaction…
              </p>
            ) : tx.isError ? (
              <p className="pt-3 text-sm text-red-text">{errorMessage(tx.error)}</p>
            ) : (
              <Fields title="Bank transaction" rows={bank} />
            )
          ) : null}
        </div>
      ) : (
        <MovePicker booking={booking} payment={payment} onDone={onDone} onBack={() => setMode("view")} />
      )}
      {mode === "view" ? (
        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <Button variant="ghost" className="text-red-text" disabled={busy} onClick={doRelease}>
            {busy ? <Spinner data-icon="inline-start" /> : <Unlink data-icon="inline-start" />}
            {payment.bank_transaction_id ? "Release from this booking" : "Remove payment"}
          </Button>
          <div className="flex gap-2">
            {payment.bank_transaction_id ? (
              <Button variant="outline" onClick={() => setMode("move")}>
                <ArrowRight data-icon="inline-start" />
                Move to another booking
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      ) : null}
    </>
  );
}

const SKIP = new Set(["id", "raw", "raw_json", "booking_id", "created_at", "updated_at"]);

/** Every field the bank gave us, the raw payload's included, skipping ids and empties. */
function bankFields(data: Record<string, unknown>): [string, unknown][] {
  const out: [string, unknown][] = [];
  const seen = new Set<string>();
  const push = (key: string, value: unknown) => {
    if (SKIP.has(key) || value === null || value === undefined || value === "" || seen.has(key)) return;
    if (typeof value === "object") return;
    seen.add(key);
    const label = humanise(key.replace(/_/g, " "));
    const text = /date$|_at$|^date/.test(key) && typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? (value.length > 10 ? formatDateTime(value) : formatDate(value)) : String(value);
    out.push([label, text]);
  };
  for (const [k, v] of Object.entries(data)) push(k, v);
  const raw = (data.raw ?? data.raw_json) as Record<string, unknown> | string | undefined;
  const rawObj = typeof raw === "string" ? safeParse(raw) : raw;
  if (rawObj && typeof rawObj === "object") for (const [k, v] of Object.entries(rawObj)) push(k, v);
  return out;
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function Fields({ title, rows }: { title: string; rows: [string, unknown][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (shown.length === 0) return null;
  return (
    <section className="pt-3 first:pt-0">
      <h3 className="text-label mb-2 flex items-center gap-2 text-muted-foreground uppercase">
        {title === "Bank transaction" ? <Landmark aria-hidden="true" className="size-3.5" /> : null}
        {title}
      </h3>
      <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5 text-body">
        {shown.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words text-foreground">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function MovePicker({ booking, payment, onDone, onBack }: { booking: BookingDetail; payment: Payment; onDone: () => void; onBack: () => void }) {
  const [q, setQ] = useState("");
  const results = useBookings({ q: q.trim(), page: 1, page_size: 8, status: "active" }, q.trim().length >= 2);
  const move = useMovePayment(booking.id);
  const items = ((results.data as Paginated<BookingListItem> | undefined)?.items ?? []).filter((b) => b.id !== booking.id);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Move {money(payment.amount)} from {booking.reference} to the booking it belongs to.
      </p>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference or group name" className="pl-9" />
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-lg ring-1 ring-border scrollbar-thin">
        {q.trim().length < 2 ? (
          <li className="p-3 text-sm text-muted-foreground">Type a reference or a group name.</li>
        ) : results.isPending ? (
          <li className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <Spinner /> Searching…
          </li>
        ) : items.length === 0 ? (
          <li className="p-3 text-sm text-muted-foreground">No other booking matches.</li>
        ) : (
          items.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-20 shrink-0 font-semibold tabular text-foreground">{b.reference}</span>
              <span className="min-w-0 flex-1 truncate text-body text-foreground">{b.group_name}</span>
              <span className="text-sm tabular text-muted-foreground">{formatDate(b.visit_date)}</span>
              <Button
                size="sm"
                disabled={move.isPending}
                onClick={async () => {
                  try {
                    await move.mutateAsync({ tx_id: payment.bank_transaction_id!, to_booking_id: b.id });
                    toast.success(`${money(payment.amount)} moved to ${b.reference}`);
                    onDone();
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}
              >
                Move here
              </Button>
            </li>
          ))
        )}
      </ul>
      <DialogFooter className="flex-row items-center justify-end">
        <Button variant="ghost" onClick={onBack} disabled={move.isPending}>
          Back
        </Button>
      </DialogFooter>
    </div>
  );
}
