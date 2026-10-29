/**
 * Contacts: everyone on the booking, several per booking, one marked as on
 * site and in charge on the day (owner's note, 26 Oct 2026). The primary
 * contact is the booking's own; the rest were cc'd or wrote in, or were added
 * here.
 */

import { Plus, Trash2, UserCheck, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Section } from "@/components/section";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useAddContact, useDeleteContact, useUpdateContact } from "../../api";
import type { BookingContact, BookingDetail } from "../../types";
import { useBookingActions } from "../../use-booking-actions";
import { CONTACT_ROLE_LABELS, primaryContact } from "../../contacts";

export function ContactsTab({ booking }: { booking: BookingDetail }) {
  const actions = useBookingActions();
  const update = useUpdateContact(booking.id);
  const remove = useDeleteContact(booking.id);
  const [adding, setAdding] = useState(false);
  const primary = primaryContact(booking);
  const rows: BookingContact[] = [primary, ...booking.contacts.filter((c) => c.role !== "primary")];

  async function markOnSite(contact: BookingContact) {
    if (contact.id === 0) {
      toast.info("Save the booking once (Edit) so its contact can be marked.");
      return;
    }
    try {
      await update.mutateAsync({ contactId: contact.id, on_site: !contact.on_site });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Users aria-hidden="true" className="size-4 text-muted-foreground" />
          Contacts
        </span>
      }
      description="Mail from any of these addresses lands on this booking. Mark the one who is on site and in charge on the day."
      actions={
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => actions.openEdit("contact")}>
            Edit primary
          </Button>
          <Button size="sm" variant={adding ? "secondary" : "outline"} onClick={() => setAdding((v) => !v)}>
            <Plus data-icon="inline-start" />
            Add contact
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {adding ? <AddContactForm booking={booking} onDone={() => setAdding(false)} /> : null}
        <ul className="divide-y divide-border">
          {rows.map((c) => (
            <li key={`${c.id}-${c.email}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-body font-medium text-foreground">{c.name || c.email}</span>
                  <span className="text-sm text-muted-foreground">{CONTACT_ROLE_LABELS[c.role]}</span>
                  {c.shared ? <StatusPill tone="blue" label="Also on other bookings" size="sm" dot={false} /> : null}
                </div>
                <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="truncate underline-offset-3 hover:underline">
                      {c.email}
                    </a>
                  ) : (
                    <span>no email</span>
                  )}
                  {c.mobile ? (
                    <a href={`tel:+${c.mobile}`} className="tabular underline-offset-3 hover:underline">
                      {formatPhone(c.mobile)}
                    </a>
                  ) : null}
                </div>
              </div>
              <Button
                variant={c.on_site ? "secondary" : "ghost"}
                size="sm"
                className={cn(c.on_site && "ring-1 ring-border")}
                aria-pressed={!!c.on_site}
                disabled={update.isPending}
                onClick={() => markOnSite(c)}
              >
                <UserCheck data-icon="inline-start" className={cn(c.on_site && "text-green-text")} />
                {c.on_site ? "On the day" : "Mark on the day"}
              </Button>
              {c.role === "primary" ? (
                <span className="w-9" aria-hidden="true" />
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${c.name || c.email}`}
                  disabled={remove.isPending}
                  onClick={async () => {
                    try {
                      await remove.mutateAsync(c.id);
                    } catch (err) {
                      toast.error(errorMessage(err));
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function AddContactForm({ booking, onDone }: { booking: BookingDetail; onDone: () => void }) {
  const add = useAddContact(booking.id);
  const [form, setForm] = useState({ email: "", name: "", mobile: "" });
  return (
    <form
      className="grid gap-3 rounded-lg bg-nested p-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await add.mutateAsync({ email: form.email.trim(), name: form.name.trim() || undefined, mobile: form.mobile.trim() || undefined });
          onDone();
        } catch (err) {
          toast.error(errorMessage(err, "Could not add the contact"));
        }
      }}
    >
      <div className="grid gap-1">
        <Label htmlFor="c-email">Email</Label>
        <Input id="c-email" type="email" required autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="c-name">Name</Label>
        <Input id="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="c-mobile">Mobile</Label>
        <Input id="c-mobile" inputMode="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={add.isPending}>
          {add.isPending ? <Spinner data-icon="inline-start" /> : null}
          Add
        </Button>
      </div>
    </form>
  );
}
