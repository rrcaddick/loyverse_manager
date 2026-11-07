/**
 * /groups/:id — the group's own page (6 Nov 2026). A group is the thing
 * that comes back; this is where its name is managed and its years read.
 * Header, the numbers across the top, Aliases (a radio picks the one that
 * is the name; Add alias top right), every booking, everyone seen on them.
 */

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Navigate, useParams } from "react-router";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSkeleton } from "@/components/page-skeleton";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAddGroupAlias, useDeleteGroupAlias, useGroup, useUseGroupAlias } from "@/features/bookings/api";
import { SummaryNumbers, VisitsTable } from "@/features/bookings/components/record/history-parts";
import { summaryLines } from "@/features/bookings/groups";
import { useGroupTypeLabel } from "@/features/bookings/lib";
import type { GroupAlias, GroupPage as GroupPageData } from "@/features/bookings/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { errorMessage } from "@/lib/api";
import { formatDateShort, formatPhone, pluralise } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function GroupPage() {
  const { id: raw } = useParams<{ id: string }>();
  const id = Number(raw);
  const valid = Number.isInteger(id) && id > 0;
  const group = useGroup(valid ? id : null);
  useDocumentTitle(group.data ? `${group.data.name} · Group` : "Group");
  if (!valid) return <Navigate to="/bookings" replace />;
  if (group.isPending) return <PageSkeleton rows={8} />;
  if (group.isError || !group.data) return <EmptyState variant="card" title="Group not found" hint={group.error ? errorMessage(group.error) : undefined} />;
  return <GroupBody group={group.data} />;
}

function GroupBody({ group }: { group: GroupPageData }) {
  const groupType = useGroupTypeLabel();
  const lines = summaryLines(group.summary);
  const years = group.visits.map((v) => v.visit_date?.slice(0, 4)).filter(Boolean) as string[];
  const since = years.length ? Math.min(...years.map(Number)) : null;
  return (
    <div className="flex flex-col gap-card-gap">
      <PageHeader
        eyebrow="Group"
        title={group.name}
        description={[group.area, group.group_type ? groupType(group.group_type) : null, `${pluralise(group.bookings, "booking")}${since ? ` since ${since}` : ""}`].filter(Boolean).join(" · ")}
      />
      {group.summary ? <SummaryNumbers summary={group.summary} /> : null}
      {lines.length > 0 ? <p className="text-body text-foreground">{lines.join(" ")}</p> : null}
      <Aliases group={group} />
      <VisitsTable visits={group.visits} title="Bookings" emptyText="No bookings yet." />
      <People group={group} />
    </div>
  );
}

// ---------------------------------------------------------------- aliases

function aliasOrigin(a: GroupAlias): string {
  if (a.source === "typed") return "Added by hand";
  if (a.source === "import") return "Booking sheet";
  if (a.booking_reference) return `${a.booking_reference}${a.booking_visit_date ? `, ${formatDateShort(a.booking_visit_date)} ${a.booking_visit_date.slice(0, 4)}` : ""}`;
  return "Booked under";
}

function Aliases({ group }: { group: GroupPageData }) {
  const add = useAddGroupAlias(group.id);
  const use = useUseGroupAlias(group.id);
  const remove = useDeleteGroupAlias(group.id);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const busy = add.isPending || use.isPending || remove.isPending;
  const th = "h-thead text-label text-table-head-foreground uppercase";

  async function run(work: () => Promise<unknown>, done: string) {
    try {
      await work();
      toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Section
      title="Aliases"
      description="Every name the group has been booked under. The selected one is the group's name; bookings keep their own."
      flush
      actions={
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus data-icon="inline-start" />
          Add alias
        </Button>
      }
    >
      <Table>
        <TableHeader className="bg-table-head text-table-head-foreground">
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(th, "w-12 pl-5")}>
              <span className="sr-only">Name</span>
            </TableHead>
            <TableHead className={th}>Alias</TableHead>
            <TableHead className={th}>From</TableHead>
            <TableHead className={cn(th, "text-right")}>Bookings</TableHead>
            <TableHead className={cn(th, "w-14 pr-5")}>
              <span className="sr-only">Remove</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.aliases.map((a) => (
            <TableRow key={a.id} className={cn(a.selected && "bg-nested/60")}>
              <TableCell className="pl-5">
                <input
                  type="radio"
                  name="group-name"
                  className="size-4 cursor-pointer accent-primary"
                  checked={a.selected}
                  disabled={busy}
                  aria-label={`Use ${a.name} as the name`}
                  onChange={() => void run(() => use.mutateAsync(a.id), `Now called ${a.name}`)}
                />
              </TableCell>
              <TableCell className={cn("text-body", a.selected ? "font-medium text-foreground" : "text-foreground")}>{a.name}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{aliasOrigin(a)}</TableCell>
              <TableCell className="text-right tabular">{a.bookings}</TableCell>
              <TableCell className="pr-5 text-right">
                {a.selected ? null : (
                  <Button variant="ghost" size="icon-xs" aria-label={`Remove the alias ${a.name}`} disabled={busy} onClick={() => void run(() => remove.mutateAsync(a.id), "Alias removed")}>
                    <X />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-section">Add alias</DialogTitle>
            <DialogDescription>A name this group is booked under or writes in. It counts for matching at once.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const name = draft.trim();
              if (!name) return;
              void run(async () => {
                await add.mutateAsync(name);
                setDraft("");
                setAddOpen(false);
              }, `Added ${name}`);
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="alias-name">Alias</Label>
              <Input id="alias-name" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="NAC Blue Downs" maxLength={255} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !draft.trim()}>
                Add alias
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

// ----------------------------------------------------------------- people

function People({ group }: { group: GroupPageData }) {
  const th = "h-thead text-label text-table-head-foreground uppercase";
  if (group.contacts.length === 0) return null;
  return (
    <Section title="People" description="Everyone seen on this group's bookings, most recent first." flush>
      <Table>
        <TableHeader className="bg-table-head text-table-head-foreground">
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(th, "pl-5")}>Name</TableHead>
            <TableHead className={th}>Email</TableHead>
            <TableHead className={th}>Mobile</TableHead>
            <TableHead className={cn(th, "text-right")}>Bookings</TableHead>
            <TableHead className={cn(th, "pr-5")}>Last</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.contacts.map((c, i) => (
            <TableRow key={`${c.email ?? ""}-${c.mobile ?? ""}-${i}`} className="hover:bg-transparent">
              <TableCell className="pl-5 text-body">{c.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="text-sm">{c.email ? <a href={`mailto:${c.email}`} className="underline-offset-3 hover:underline">{c.email}</a> : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="text-sm tabular">{c.mobile ? formatPhone(c.mobile) : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="text-right tabular">{c.bookings}</TableCell>
              <TableCell className="pr-5 text-sm whitespace-nowrap text-muted-foreground">{c.last_visit_date ? `${formatDateShort(c.last_visit_date)} ${c.last_visit_date.slice(0, 4)}` : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}
