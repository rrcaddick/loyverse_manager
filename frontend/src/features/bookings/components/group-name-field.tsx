/**
 * The Add booking group name with our records behind it (3 Nov 2026): typing
 * two letters lists the groups we know (name, area, kind, last booking), a
 * pick fills the name and, when empty, the kind, the area and last time's
 * contact details, and the booking is created linked to that group. The text
 * stays editable: it is what goes on the proforma, and editing it lets the
 * pick go.
 */

import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";

import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { formatDateShort, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useGroupSearch } from "../api";
import { useGroupTypeLabel } from "../lib";
import type { GroupSearchRow } from "../types";

interface GroupNameFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  /** The picked group, or null while the text is the office's own. */
  pickedId: number | null;
  onPick: (group: GroupSearchRow) => void;
  onClear: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}

export function GroupNameField<T extends FieldValues>({ control, name, pickedId, onPick, onClear, autoFocus, placeholder }: GroupNameFieldProps<T>) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(typed), 200);
    return () => window.clearTimeout(timer);
  }, [typed]);
  const search = useGroupSearch(debounced.trim(), debounced.trim().length >= 2 && pickedId === null);
  const rows = pickedId === null && debounced.trim().length >= 2 ? (search.data?.items ?? []) : [];
  const groupType = useGroupTypeLabel();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="relative">
          <FormLabel>
            Group name<span aria-hidden="true" className="text-muted-foreground">*</span>
          </FormLabel>
          <FormControl>
            <Input
              {...field}
              value={field.value ?? ""}
              autoFocus={autoFocus}
              placeholder={placeholder}
              autoComplete="off"
              role="combobox"
              aria-expanded={open && rows.length > 0}
              aria-autocomplete="list"
              onChange={(e) => {
                field.onChange(e);
                setTyped(e.target.value);
                setOpen(true);
                if (pickedId !== null) onClear();
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => {
                field.onBlur();
                window.setTimeout(() => setOpen(false), 150);
              }}
            />
          </FormControl>
          {open && rows.length > 0 ? (
            <ul role="listbox" aria-label="Groups we know" className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md">
              {rows.map((g) => (
                <li key={g.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onPick(g);
                      setOpen(false);
                    }}
                    className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-nested focus-visible:bg-nested focus-visible:outline-none")}
                  >
                    <Users aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-foreground">{g.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {[g.area, g.group_type ? groupType(g.group_type) : null, pluralise(g.bookings, "booking"), g.last_contact_name].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {g.last_visit_date ? <span className="shrink-0 text-sm text-muted-foreground">{formatDateShort(g.last_visit_date)} {g.last_visit_date.slice(0, 4)}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {pickedId !== null ? <p className="text-sm text-muted-foreground">Linked to the group we know. Edit the name freely; it goes on the proforma as typed.</p> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
