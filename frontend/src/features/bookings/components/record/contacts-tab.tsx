/**
 * Contacts (owner's notes, 29 Oct 2026): the bookings-style table. Several
 * contacts per booking; any number of them primary (every primary receives
 * the WhatsApp ticket); one on site and in charge on the day; an edit dialog
 * per row. Changing a primary contact's number sends the ticket to the new
 * number when one has gone out already.
 */

import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/api";
import { formatPhone } from "@/lib/format";

import { useAddContact, useDeleteContact, useUpdateContact } from "../../api";
import { primaryContact } from "../../contacts";
import type { BookingContact, BookingDetail } from "../../types";

export function ContactsTab({ booking }: { booking: BookingDetail }) {
  const update = useUpdateContact(booking.id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BookingContact | null>(null);
  // Every booking's own contact is mirrored into the rows (it is always primary);
  // the synthesised one only stands in while a booking has no rows at all.
  const rows: BookingContact[] = booking.contacts.length ? booking.contacts : [primaryContact(booking)];
  const isOwn = (c: BookingContact) => c.source === "booking" || (!!c.email && c.email === (booking.contact_email ?? "").toLowerCase());

  // The box ticks at once (the hook updates the cache first) and springs back with a loud toast on failure.
  async function change(contact: BookingContact, patch: { role?: "primary" | "cc"; on_site?: boolean }) {
    try {
      await update.mutateAsync({ contactId: contact.id, ...patch });
    } catch (err) {
      toast.error(`Could not update ${contact.name || contact.email || "the contact"}: ${errorMessage(err)}`, { duration: 8000 });
    }
  }

  const columns: ColumnDef<BookingContact>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => <span className="text-body font-medium text-foreground">{row.original.name || <span className="text-muted-foreground">No name</span>}</span>,
      meta: { className: "min-w-40" },
    },
    {
      accessorKey: "email",
      header: "Email",
      cell: ({ row }) =>
        row.original.email ? (
          <a href={`mailto:${row.original.email}`} className="text-body text-foreground underline-offset-3 hover:underline">
            {row.original.email}
          </a>
        ) : (
          <span className="text-muted-foreground">No email</span>
        ),
      meta: { className: "min-w-48" },
    },
    {
      accessorKey: "mobile",
      header: "Mobile",
      cell: ({ row }) =>
        row.original.mobile ? (
          <a href={`tel:+${row.original.mobile}`} className="text-body tabular text-foreground underline-offset-3 hover:underline">
            {formatPhone(row.original.mobile)}
          </a>
        ) : (
          <span className="text-muted-foreground">No mobile</span>
        ),
      meta: { className: "whitespace-nowrap" },
    },
    {
      id: "primary",
      header: () => <div className="w-full text-center">Primary</div>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-center">
          <Checkbox
            aria-label={`${row.original.name || row.original.email} is a primary contact`}
            checked={row.original.role === "primary"}
            disabled={row.original.id === 0 || isOwn(row.original)}
            title={isOwn(row.original) ? "The booking's own contact is always primary" : undefined}
            onCheckedChange={(v) => change(row.original, { role: v === true ? "primary" : "cc" })}
          />
        </div>
      ),
      meta: { align: "center", className: "w-24" },
    },
    {
      id: "on_site",
      header: () => <div className="w-full text-center">On site</div>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-center">
          <Checkbox aria-label={`${row.original.name || row.original.email} is on site on the day`} checked={!!row.original.on_site} disabled={row.original.id === 0} onCheckedChange={(v) => change(row.original, { on_site: v === true })} />
        </div>
      ),
      meta: { align: "center", className: "w-24" },
    },
    {
      id: "source",
      header: "Added",
      enableSorting: false,
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.source === "booking" ? "With the booking" : row.original.role === "learned" ? "Wrote in" : row.original.source === "manual" ? "By hand" : "Cc'd"}</span>,
      meta: { className: "whitespace-nowrap" },
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${row.original.name || row.original.email}`} disabled={row.original.id === 0} onClick={() => setEditing(row.original)}>
            <Pencil />
          </Button>
        </div>
      ),
      meta: { align: "right", className: "w-16" },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-section flex items-center gap-2 text-foreground">
          <Users aria-hidden="true" className="size-4 text-muted-foreground" />
          Contacts
        </h2>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus data-icon="inline-start" />
          Add contact
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
        <DataTable columns={columns} data={rows} getRowId={(c) => `${c.id}-${c.email}`} pagination={false} maxHeight="60dvh" className="[&_td:first-child]:pl-5 [&_td:last-child]:pr-4 [&_th:first-child]:pl-5 [&_th:last-child]:pr-4" />
      </div>
      <ContactDialog booking={booking} contact={editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
      <ContactDialog booking={booking} contact={null} open={adding} onOpenChange={setAdding} />
    </div>
  );
}

/** Add (contact null) or edit a contact. Removing is here too, for all but the primary with the booking. */
function ContactDialog({ booking, contact, open, onOpenChange }: { booking: BookingDetail; contact: BookingContact | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open ? <ContactForm key={contact?.id ?? "new"} booking={booking} contact={contact} onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function ContactForm({ booking, contact, onDone }: { booking: BookingDetail; contact: BookingContact | null; onDone: () => void }) {
  const add = useAddContact(booking.id);
  const update = useUpdateContact(booking.id);
  const remove = useDeleteContact(booking.id);
  const [form, setForm] = useState({ name: contact?.name ?? "", email: contact?.email ?? "", mobile: contact?.mobile ?? "" });
  const busy = add.isPending || update.isPending || remove.isPending;
  const isBookingContact = !!contact && contact.email === (booking.contact_email ?? "").toLowerCase();

  async function save() {
    try {
      if (contact) {
        const patch: { name?: string; email?: string; mobile?: string } = {};
        if (form.name.trim() !== (contact.name ?? "")) patch.name = form.name.trim();
        if (form.email.trim().toLowerCase() !== contact.email) patch.email = form.email.trim().toLowerCase();
        if (form.mobile.trim() !== (contact.mobile ?? "")) patch.mobile = form.mobile.trim();
        if (Object.keys(patch).length === 0) {
          onDone();
          return;
        }
        const result = await update.mutateAsync({ contactId: contact.id, ...patch });
        if (result.whatsapp) {
          if (result.whatsapp.success === false) toast.error(`Saved, but the ticket could not be sent to the new number: ${result.whatsapp.error ?? "unknown error"}`);
          else toast.success(`Saved · ticket sent to ${formatPhone(result.whatsapp.to ?? patch.mobile ?? "")}`);
        } else {
          toast.success("Contact saved");
        }
      } else {
        await add.mutateAsync({ email: form.email.trim().toLowerCase(), name: form.name.trim() || undefined, mobile: form.mobile.trim() || undefined });
      }
      onDone();
    } catch (err) {
      toast.error(errorMessage(err, "Could not save the contact"));
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <DialogHeader>
        <DialogTitle className="text-section">{contact ? "Edit contact" : "Add contact"}</DialogTitle>
        <DialogDescription>{contact?.role === "primary" && booking.ticket_sent_at ? "A new mobile number receives the vehicle ticket straight away." : "Mail from this address lands on the booking."}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1">
          <Label htmlFor="ct-name">Name</Label>
          <Input id="ct-name" value={form.name} autoFocus={!contact} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ct-email">Email</Label>
          <Input id="ct-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ct-mobile">Mobile</Label>
          <Input id="ct-mobile" inputMode="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="082 123 4567" />
        </div>
      </div>
      <DialogFooter className="flex-row items-center justify-between sm:justify-between">
        {contact && !isBookingContact ? (
          <Button
            type="button"
            variant="ghost"
            className="text-red-text"
            disabled={busy}
            onClick={async () => {
              try {
                await remove.mutateAsync(contact.id);
                onDone();
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          >
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {contact ? "Save" : "Add"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
