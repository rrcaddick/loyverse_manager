/**
 * Global search (admin). "/" anywhere opens this small dialog; Enter goes
 * to /bookings?q=… (the list filters on `q`). On the Bookings list itself
 * "/" focuses the list's own box instead (AppLayout). This replaced the box
 * in the app header when the header went (owner's note, 29 Oct 2026).
 */

import { Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";

export function GlobalSearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const q = value.trim();
    onOpenChange(false);
    setValue("");
    navigate(q ? `/bookings?q=${encodeURIComponent(q)}` : "/bookings");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] translate-y-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-section">Search bookings</DialogTitle>
          <DialogDescription>Reference, group, contact, phone or area. Enter opens the list filtered on it.</DialogDescription>
        </DialogHeader>
        <form role="search" onSubmit={onSubmit}>
          <InputGroup className="h-11">
            <InputGroupAddon>
              <Search aria-hidden="true" className="size-4 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              type="search"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="FY1703, Vissershok, 082 …"
              aria-label="Search bookings by reference, group, contact, phone or area"
              autoComplete="off"
              className="text-body"
            />
            <InputGroupAddon align="inline-end">
              <Kbd aria-hidden="true">↵</Kbd>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
