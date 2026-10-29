/**
 * Find payment: the search tool on the booking (owner's model, 26 Oct 2026).
 * Bank credits by reference, amount or date, each with why it matched; one
 * click records the credit as this booking's payment. With no filters the
 * backend searches on the booking's own reference, group words and expected
 * amounts. Opened from a proof of payment it allocates that proof too.
 */

import { Landmark, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useAllocateCredit, usePaymentSearch, usePopAllocate } from "../api";
import type { BankCredit, BookingDetail, PaymentSearchParams } from "../types";

export interface FindPaymentPrefill {
  reference?: string;
  amount?: number | null;
  from?: string;
  to?: string;
  /** Allocating from a proof of payment resolves that proof as well. */
  popId?: number;
}

const money = (n: number) => formatMoney(n, { compact: true });

export function FindPaymentDialog({ booking, open, onOpenChange, prefill }: { booking: BookingDetail; open: boolean; onOpenChange: (open: boolean) => void; prefill?: FindPaymentPrefill }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-section">Find payment · {booking.reference}</DialogTitle>
          <DialogDescription>Bank credits that could be this booking's. Leave the fields empty to search on the reference, the group's name and the expected amounts.</DialogDescription>
        </DialogHeader>
        {open ? <Body key={JSON.stringify(prefill ?? {})} booking={booking} prefill={prefill} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function toParams(form: { reference: string; amount: string; from: string; to: string }): PaymentSearchParams {
  const p: PaymentSearchParams = {};
  if (form.reference.trim()) p.reference = form.reference.trim();
  if (form.amount.trim()) p.amount = form.amount.trim();
  if (form.from) p.from = form.from;
  if (form.to) p.to = form.to;
  return p;
}

function Body({ booking, prefill, onDone }: { booking: BookingDetail; prefill?: FindPaymentPrefill; onDone: () => void }) {
  const [form, setForm] = useState({ reference: prefill?.reference ?? "", amount: prefill?.amount != null ? String(prefill.amount) : "", from: prefill?.from ?? "", to: prefill?.to ?? "" });
  const [query, setQuery] = useState<PaymentSearchParams>(() => toParams(form));
  const search = usePaymentSearch(booking.id, query, true);
  const allocate = useAllocateCredit(booking.id);
  const popAllocate = usePopAllocate(booking.id);
  const busy = allocate.isPending || popAllocate.isPending;

  async function use(credit: BankCredit) {
    try {
      if (prefill?.popId) await popAllocate.mutateAsync({ popId: prefill.popId, tx_id: credit.id });
      else await allocate.mutateAsync({ tx_id: credit.id });
      toast.success(`${money(credit.amount)} recorded on ${booking.reference}`);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, "Could not record the payment"));
    }
  }

  const expected = search.data?.expected ?? {};
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <form
        className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_8rem_9rem_9rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(toParams(form));
        }}
      >
        <div className="col-span-2 grid gap-1 sm:col-span-1">
          <Label htmlFor="fp-ref">Reference or words</Label>
          <Input id="fp-ref" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder={booking.reference} autoFocus />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="fp-amount">Amount</Label>
          <Input id="fp-amount" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="R" className="tabular" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="fp-from">From</Label>
          <Input id="fp-from" type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="fp-to">To</Label>
          <Input id="fp-to" type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
        </div>
        <Button type="submit" className="col-span-2 sm:col-span-1">
          <Search data-icon="inline-start" />
          Search
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {Object.keys(expected).length ? (
          <span>
            Expected:{" "}
            {Object.entries(expected).map(([label, amount], i) => (
              <span key={label} className="tabular">
                {i > 0 ? " · " : ""}
                {label} {money(amount)}
              </span>
            ))}
          </span>
        ) : null}
        {search.data ? (
          <span className="tabular">
            {formatDate(search.data.window.from)} – {formatDate(search.data.window.to)} · {search.data.total} {search.data.total === 1 ? "credit" : "credits"}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg ring-1 ring-border scrollbar-thin">
        {search.isPending ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Spinner /> Searching the bank feed…
          </p>
        ) : search.isError ? (
          <p className="p-4 text-sm text-red-text">{errorMessage(search.error)}</p>
        ) : !search.data || search.data.items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No credits match. Widen the dates or search on the amount alone; a payment made today may not have reached the feed yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {search.data.items.map((credit) => {
              const mine = credit.booking_id === booking.id;
              const elsewhere = credit.booking_id !== null && !mine;
              return (
                <li key={credit.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2", mine && "bg-green-soft/40")}>
                  <Landmark aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="w-24 shrink-0 text-sm tabular text-muted-foreground">{formatDate(credit.booking_date)}</span>
                  <span className="w-24 shrink-0 text-body font-medium tabular text-foreground">{money(credit.amount)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={credit.description ?? undefined}>
                    {credit.description ?? "—"}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {credit.why.map((w) => (
                      <StatusPill key={w} tone="blue" label={w} size="sm" dot={false} />
                    ))}
                  </span>
                  {mine ? (
                    <StatusPill tone="green" label="On this booking" size="sm" />
                  ) : elsewhere ? (
                    <StatusPill tone="neutral" label="On another booking" size="sm" />
                  ) : (
                    <Button size="sm" disabled={busy} onClick={() => use(credit)}>
                      {busy ? <Spinner data-icon="inline-start" /> : null}
                      Use this payment
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
