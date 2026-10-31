/**
 * /work — one list of everything that needs a person (UI round two, agreed
 * 26 and 29 Oct 2026). The views live in the sidebar's Work accordion with
 * their counts; this page shows one of them: one line per item with a single
 * verb, and the row itself opens the booking or enquiry where the work is
 * done. `?view=` and `?page=` live in the URL; with no view the first one in
 * pipeline order that has something in it opens. Keys: J/K move, Enter opens
 * the row, 1 fires its verb. Reminders older than 30 days are Stale, with
 * Dismiss all.
 */

import { AlertCircle, Archive, Bell, Hourglass, Inbox, Mail, MessageSquareText, Receipt, RefreshCw, Split, Ticket, type LucideIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { CountBadge } from "@/components/count-badge";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/section-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WORK_PAGE_SIZE, useDismissReminders, useWorkCounts, useWorkList } from "@/features/work/api";
import { WorkRow } from "@/features/work/components/work-row";
import { WORK_VIEWS, isWorkView, type WorkCounts, type WorkRow as WorkRowData, type WorkView } from "@/features/work/types";
import { useWorkActions } from "@/features/work/use-work-actions";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useShortcut } from "@/hooks/use-keyboard";
import { useSubjectDialog } from "@/hooks/use-subject-dialog";
import { errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { toast } from "@/lib/toast";

interface ViewMeta {
  label: string;
  icon: LucideIcon;
  /** What one row is, for the heading: "28 bookings waiting for a reply". */
  what: string;
  empty: { title: string; hint: string; link?: { to: string; label: string } };
}

const VIEWS: Record<WorkView, ViewMeta> = {
  reply: {
    label: "Reply",
    icon: Mail,
    what: "The customer wrote last",
    empty: { title: "Nothing to reply to.", hint: "Mail is checked every minute; a customer's message on a booking lands here." },
  },
  new_requests: {
    label: "Requests",
    icon: Inbox,
    what: "Requests to review",
    empty: { title: "No requests to review.", hint: "Requests from the public form wait here until they are accepted or declined.", link: { to: "/bookings?tab=requests", label: "Open requests" } },
  },
  enquiries: {
    label: "Enquiries",
    icon: MessageSquareText,
    what: "Enquiries to answer",
    empty: { title: "No enquiries waiting.", hint: "Mail that matches no booking and got no answer becomes an enquiry.", link: { to: "/enquiries", label: "Open Enquiries" } },
  },
  allocate: {
    label: "Assign mail",
    icon: Split,
    what: "Mail to assign between two bookings",
    empty: { title: "Nothing to assign.", hint: "Mail from someone with more than one open booking waits here for a click." },
  },
  pops: {
    label: "Verify payments",
    icon: Receipt,
    what: "Proofs of payment to verify",
    empty: { title: "No proof of payment to verify.", hint: "Attachments and messages that say a payment was made wait here until matched to a credit.", link: { to: "/bookings?tab=pending", label: "Pending bookings" } },
  },
  send_tickets: {
    label: "Send tickets",
    icon: Ticket,
    what: "Tickets to send",
    empty: { title: "Every ticket has been sent.", hint: "Confirmed bookings without a vehicle ticket appear here.", link: { to: "/bookings?tab=confirmed", label: "Confirmed bookings" } },
  },
  reminders: {
    label: "Reminders",
    icon: Bell,
    what: "Reminders due",
    empty: { title: "No reminders due.", hint: "Reminders are worked out every morning from the booking dates.", link: { to: "/settings/reminders", label: "Reminder settings" } },
  },
  holds: {
    label: "Expiring",
    icon: Hourglass,
    what: "Unpaid bookings about to expire",
    empty: { title: "Nothing expiring.", hint: "Unpaid bookings that expire within three days appear here.", link: { to: "/bookings?tab=pending", label: "Pending bookings" } },
  },
  stale: {
    label: "Stale",
    icon: Archive,
    what: "Reminders more than 30 days overdue",
    empty: { title: "No stale reminders.", hint: "Reminders more than 30 days overdue move here so the live counts stay honest." },
  },
};

type ListEntry = { type: "header"; group: string | null; count: number } | { type: "row"; row: WorkRowData };

/** Rows arrive contiguous by `group`; the reminder views get a heading where it changes. */
function sectioned(items: WorkRowData[], grouped: boolean): ListEntry[] {
  if (!grouped) return items.map((row) => ({ type: "row", row }));
  const counts = new Map<string | null, number>();
  for (const item of items) counts.set(item.group, (counts.get(item.group) ?? 0) + 1);
  const out: ListEntry[] = [];
  let last: string | null | undefined;
  for (const row of items) {
    if (row.group !== last) {
      last = row.group;
      out.push({ type: "header", group: row.group, count: counts.get(row.group) ?? 0 });
    }
    out.push({ type: "row", row });
  }
  return out;
}

/** With no view in the URL: the first live view with something in it. */
function defaultView(counts: WorkCounts | undefined): WorkView {
  if (!counts) return "reply";
  return WORK_VIEWS.find((v) => v !== "stale" && (counts[v] ?? 0) > 0) ?? "reply";
}

export default function WorkPage() {
  useDocumentTitle("Work");
  const [params, setParams] = useSearchParams();
  const counts = useWorkCounts();
  const viewParam = params.get("view");
  const view: WorkView = isWorkView(viewParam) ? viewParam : defaultView(counts.data?.counts);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const list = useWorkList(view, page, isWorkView(viewParam) || !counts.isPending);
  const work = useWorkActions();
  const dismissAll = useDismissReminders();
  const dismissAllDialog = useSubjectDialog<true>();
  const listRef = useRef<HTMLUListElement>(null);

  const c: WorkCounts | undefined = list.data?.counts ?? counts.data?.counts;
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const grouped = view === "reminders" || view === "stale";

  function setPage(next: number) {
    const query: Record<string, string> = { view };
    if (next > 1) query.page = String(next);
    setParams(query);
  }

  function moveFocus(delta: 1 | -1) {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-work-row]") ?? []);
    if (rows.length === 0) return;
    const active = document.activeElement;
    const index = rows.findIndex((row) => row === active || row.contains(active));
    const next = index === -1 ? (delta === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, index + delta));
    const target = rows[next];
    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  }

  useShortcut("j", () => moveFocus(1));
  useShortcut("k", () => moveFocus(-1));

  const meta = VIEWS[view];
  const from = total === 0 ? 0 : (page - 1) * WORK_PAGE_SIZE + 1;
  const to = Math.min(total, page * WORK_PAGE_SIZE);

  let rowsOut: ReactNode;
  if (list.isPending || (!isWorkView(viewParam) && counts.isPending)) {
    rowsOut = (
      <div className="divide-y divide-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex min-h-row-queue items-center gap-3 px-4">
            <Skeleton className="size-2 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
            <Skeleton className="h-9 w-32" />
          </div>
        ))}
      </div>
    );
  } else if (items.length === 0) {
    rowsOut = <EmptyState variant="card" icon={meta.icon} title={meta.empty.title} hint={meta.empty.hint} link={meta.empty.link} />;
  } else {
    rowsOut = (
      <ul ref={listRef} className="divide-y divide-border" aria-label={`${meta.label} list`}>
        {sectioned(items, grouped).map((entry) =>
          entry.type === "header" ? (
            <li key={`group-${entry.group ?? "other"}`} className="bg-nested/60 px-4 pt-2 pb-1">
              <SectionHeader as="h3" title={entry.group ?? "Other"} count={entry.count} rule={false} className="[&_h3]:text-body [&_h3]:font-medium" />
            </li>
          ) : (
            <WorkRow key={entry.row.id} row={entry.row} busy={work.busyRow === entry.row.id} quiet={view === "stale"} onOpen={work.open} onAction={work.run} />
          ),
        )}
      </ul>
    );
  }

  const Icon = meta.icon;
  return (
    <>
      <PageHeader
        title="Work"
        actions={
          view === "stale" && (c?.stale ?? 0) > 0 ? (
            <Button variant="outline" onClick={() => dismissAllDialog.show(true)}>
              <Archive data-icon="inline-start" />
              Dismiss all stale
            </Button>
          ) : undefined
        }
      />

      <div className="flex min-w-0 flex-col gap-3">
        {list.isError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Could not load this view</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>{errorMessage(list.error)}</span>
              <Button variant="outline" size="sm" onClick={() => list.refetch()}>
                <RefreshCw data-icon="inline-start" />
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <h2 className="text-section">{meta.what}</h2>
            {c ? <CountBadge count={c[view] ?? 0} /> : null}
            {total > WORK_PAGE_SIZE ? (
              <span className="ml-auto text-sm text-muted-foreground tabular">
                {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
              </span>
            ) : null}
          </div>
          {rowsOut}
        </div>

        {total > WORK_PAGE_SIZE ? (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={to >= total} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        ) : null}
      </div>

      {work.dialogs}
      <ConfirmDialog
        open={dismissAllDialog.open}
        onOpenChange={dismissAllDialog.onOpenChange}
        title="Dismiss every stale reminder?"
        description={`${formatNumber(c?.stale ?? 0)} reminders more than 30 days overdue will be dismissed. Each dismissal is recorded on its booking; a payment or a moved date brings a reminder back.`}
        confirmLabel="Dismiss all"
        destructive
        onConfirm={async () => {
          const result = await dismissAll.mutateAsync({ all_stale: true });
          toast.success(`${formatNumber(result.dismissed)} reminders dismissed`);
        }}
      />
    </>
  );
}
